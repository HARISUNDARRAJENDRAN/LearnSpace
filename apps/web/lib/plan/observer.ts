import { withUserTransaction, type Transaction } from "@learnspace/db";
import { scheduleItems } from "@learnspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { openAiConfigured, structuredCompletion } from "../ai/openai";
import { AuthError } from "../auth/errors";
import { loadRelatedVideos, loadTimezone } from "../home/service";
import { kindForResource, PLAN_KINDS, type PlanKind } from "./kinds";

const evaluationWindowDays = 14;
const defaultPlannedSeconds = 30 * 60;
const replanAfterEvidenceMs = 20 * 60_000;
const replanWhenEmptyMs = 6 * 3_600_000;
// Study only counts toward an item if it happened after the item was planned, give or take this much.
// Planning a session and pressing play within a few minutes is normal; planning yesterday's study is not.
export const evidenceGraceMs = 15 * 60_000;

type OpenItem = { id: string; title: string; description: string | null; kind: PlanKind; resourceId: string | null; startsAt: Date; endsAt: Date | null; allDay: boolean; progressPct: number; observerNote: string | null; evaluatedAt: Date | null; createdAt: Date; updatedAt: string; day: string };
// One focus session (seconds > 0) or one finished material (finished, seconds 0); `at` is when it happened.
export type Evidence = { resourceId: string; title: string; type: string; seconds: number; finished: boolean; at?: Date };
type Lesson = { resourceId: string; title: string; type: string; progressPct: number; completed: boolean; concepts: string[] };
type Candidate = { id: string; title: string; type: string; why: string };
type Action = { title: string; reason: string; kind: PlanKind; minutes: number; when: "today" | "tomorrow" | "later"; resourceId: string | null; searchQuery: string };
type Verdict = { id: string; progressPct: number; done: boolean; note: string };

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

function plannedSeconds(item: Pick<OpenItem, "startsAt" | "endsAt" | "allDay">): number {
  return item.endsAt && !item.allDay ? Math.max(60, (item.endsAt.getTime() - item.startsAt.getTime()) / 1000) : defaultPlannedSeconds;
}

// A plan item is judged by what the learner studied on its own calendar day.
export function reconcileStudyItem(item: Pick<OpenItem, "startsAt" | "endsAt" | "allDay">, evidence: Evidence | undefined): { progressPct: number; done: boolean; note: string | null } {
  const planned = plannedSeconds(item);
  const seconds = evidence?.seconds ?? 0;
  const done = Boolean(evidence?.finished) || seconds >= planned;
  if (evidence?.finished) return { progressPct: 100, done, note: `Finished ${evidence.title}.` };
  return {
    progressPct: done ? 100 : Math.min(99, Math.round(seconds / planned * 100)),
    done,
    note: seconds > 0 ? `Studied ${minutes(seconds)} of ${minutes(planned)} planned min.` : null,
  };
}

type DayItem = Pick<OpenItem, "id" | "kind" | "resourceId" | "startsAt" | "endsAt" | "allDay"> & { createdAt?: Date };

// Study that happened before the item was planned never counts for it.
const countsFor = (item: { createdAt?: Date }, entry: Evidence) => !item.createdAt || !entry.at || entry.at.getTime() >= item.createdAt.getTime() - evidenceGraceMs;

// Which study minutes can count toward each kind; practice and review take whatever study is left.
const readingTypes = new Set(["paper", "pdf", "webpage", "note"]);
const pool = (type: string) => type === "video" ? "video" : readingTypes.has(type) ? "reading" : "other";
const kindPools: Record<PlanKind, ("video" | "reading" | "other")[]> = { watch: ["video"], read: ["reading"], practice: ["other", "video", "reading"], review: ["other", "video", "reading"] };

// Shares one day's study among that day's items in start order, so the same minutes never count twice.
// An item tied to a material draws on that material's time; any other item draws on what its kind allows.
export function reconcileDay(items: DayItem[], evidence: Evidence[]): Map<string, { progressPct: number; done: boolean; note: string | null }> {
  // Minutes are tracked per evidence entry, so each focus session is spent once across the day's items.
  const left = evidence.map((entry) => entry.seconds);
  const verdicts = new Map<string, { progressPct: number; done: boolean; note: string | null }>();
  for (const item of items.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const planned = plannedSeconds(item);
    const indexes = evidence.map((_, index) => index).filter((index) => countsFor(item, evidence[index]!));
    const sources = item.resourceId
      ? indexes.filter((index) => evidence[index]!.resourceId === item.resourceId)
      : kindPools[item.kind].flatMap((name) => indexes.filter((index) => pool(evidence[index]!.type) === name));
    let seconds = 0;
    for (const index of sources) {
      const take = Math.max(0, Math.min(left[index]!, planned - seconds));
      left[index] = left[index]! - take;
      seconds += take;
    }
    // Finishing the material completes its item even when earlier items used the minutes.
    const finished = item.resourceId ? sources.map((index) => evidence[index]!).find((source) => source.finished) : undefined;
    verdicts.set(item.id, reconcileStudyItem(item, finished ?? (seconds > 0 ? { resourceId: "", title: "", type: "", seconds, finished: false } : undefined)));
  }
  return verdicts;
}

async function loadOpenItems(tx: Transaction, userId: string, timezone: string, onlyId?: string): Promise<OpenItem[]> {
  const rows = await tx.execute<{ id: string; title: string; description: string | null; kind: PlanKind; resource_id: string | null; starts_at: string; ends_at: string | null; all_day: boolean; progress_pct: number; observer_note: string | null; evaluated_at: string | null; created_at: string; updated_at: string; day: string }>(sql`
    SELECT id, title, description, kind, resource_id, starts_at, ends_at, all_day, progress_pct, observer_note, evaluated_at, created_at,
      -- Text keeps the microseconds the edit guard compares; a JS Date would drop them.
      updated_at::text AS updated_at,
      to_char(starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day
    FROM study.schedule_items
    WHERE user_id = ${userId} AND status = 'planned'
      AND starts_at >= now() - make_interval(days => ${evaluationWindowDays})
      AND date_trunc('day', starts_at AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone} <= now()
      ${onlyId ? sql`AND to_char(starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') = (SELECT to_char(starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') FROM study.schedule_items WHERE id = ${onlyId} AND user_id = ${userId})` : sql``}
  `);
  const date = (value: string | null) => value ? new Date(value) : null;
  return [...rows].map((row) => ({ id: row.id, title: row.title, description: row.description, kind: row.kind, resourceId: row.resource_id, startsAt: new Date(row.starts_at), endsAt: date(row.ends_at), allDay: row.all_day, progressPct: Number(row.progress_pct), observerNote: row.observer_note, evaluatedAt: date(row.evaluated_at), createdAt: new Date(row.created_at), updatedAt: row.updated_at, day: row.day }));
}

async function loadEvidence(tx: Transaction, userId: string, timezone: string): Promise<{ byDay: Map<string, Evidence[]>; latestAt: Date | null }> {
  // One row per focus session and per finished material, with its time, so each item can ignore study from before it was planned.
  const rows = await tx.execute<{ day: string; resource_id: string; title: string; type: string; seconds: number; finished: boolean; at: string }>(sql`
    WITH studied AS (
      SELECT to_char(f.started_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, f.resource_id, f.duration_sec AS seconds, false AS finished, f.started_at AS at
      FROM study.focus_sessions f
      WHERE f.user_id = ${userId} AND f.resource_id IS NOT NULL AND f.duration_sec > 0 AND f.ended_at <= now()
        AND f.started_at >= now() - make_interval(days => ${evaluationWindowDays + 1})
      UNION ALL
      SELECT to_char(p.completed_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD'), p.resource_id, 0, true, p.completed_at
      FROM study.user_resource_progress p
      WHERE p.user_id = ${userId} AND p.completed_at >= now() - make_interval(days => ${evaluationWindowDays + 1})
    )
    SELECT s.day, s.resource_id, r.title, r.type::text AS type, s.seconds::int AS seconds, s.finished, s.at
    FROM studied s JOIN catalog.resources r ON r.id = s.resource_id
    ORDER BY s.at
  `);
  const [latest] = await tx.execute<{ at: string | null }>(sql`
    SELECT greatest(
      (SELECT max(ended_at) FROM study.focus_sessions WHERE user_id = ${userId} AND ended_at <= now()),
      (SELECT max(updated_at) FROM study.user_resource_progress WHERE user_id = ${userId})
    ) AS at
  `);
  const byDay = new Map<string, Evidence[]>();
  for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), { resourceId: row.resource_id, title: row.title, type: row.type, seconds: Number(row.seconds), finished: row.finished, at: new Date(row.at) }]);
  return { byDay, latestAt: latest?.at ? new Date(latest.at) : null };
}

async function loadRecentLessons(tx: Transaction, userId: string): Promise<Lesson[]> {
  const rows = await tx.execute<{ resource_id: string; title: string; type: string; progress_pct: number | null; completed: boolean; concepts: string[] }>(sql`
    SELECT p.resource_id, r.title, r.type::text AS type, p.progress_pct, p.completed_at IS NOT NULL AS completed,
      coalesce((SELECT array_agg(c.name ORDER BY rc.relevance DESC) FROM catalog.resource_concepts rc JOIN knowledge.concepts c ON c.id = rc.concept_id WHERE rc.resource_id = r.id), '{}') AS concepts
    FROM study.user_resource_progress p JOIN catalog.resources r ON r.id = p.resource_id
    WHERE p.user_id = ${userId} AND p.last_opened_at IS NOT NULL AND r.deleted_at IS NULL
    ORDER BY p.last_opened_at DESC LIMIT 6
  `);
  return [...rows].map((row) => ({ resourceId: row.resource_id, title: row.title, type: row.type, progressPct: Math.round(Number(row.progress_pct ?? 0)), completed: row.completed, concepts: row.concepts.slice(0, 5) }));
}

// Agent items land straight on the calendar. Until the learner edits, studies or ticks one, a replan may swap it for a fresher one.
// All-day agent items come from the onboarding goal and are never replaced.
const replaceableAgentItem = sql`source = 'agent' AND (status = 'suggested' OR (status = 'planned' AND NOT all_day AND progress_pct = 0 AND updated_at = created_at AND starts_at > now()))`;

async function loadPlannerState(tx: Transaction, userId: string, timezone: string) {
  const [state] = await tx.execute<{ last_planned_at: string | null; pending: number; today: string; tomorrow: string; later: string }>(sql`
    SELECT
      (SELECT max(created_at) FROM study.schedule_items WHERE user_id = ${userId} AND source = 'agent' AND NOT all_day) AS last_planned_at,
      -- The agent's own upcoming items the learner has not touched yet; it may replace these when it replans.
      (SELECT count(*)::int FROM study.schedule_items WHERE user_id = ${userId} AND ${replaceableAgentItem}) AS pending,
      CASE
        WHEN (now() AT TIME ZONE ${timezone})::time < time '17:00' THEN ((now() AT TIME ZONE ${timezone})::date + time '18:00') AT TIME ZONE ${timezone}
        WHEN (now() AT TIME ZONE ${timezone})::time < time '21:00' THEN date_trunc('hour', now()) + interval '1 hour'
        ELSE ((now() AT TIME ZONE ${timezone})::date + 1 + time '18:00') AT TIME ZONE ${timezone}
      END AS today,
      ((now() AT TIME ZONE ${timezone})::date + 1 + time '18:00') AT TIME ZONE ${timezone} AS tomorrow,
      ((now() AT TIME ZONE ${timezone})::date + 3 + time '18:00') AT TIME ZONE ${timezone} AS later
  `);
  const titles = await tx.execute<{ title: string; status: string }>(sql`
    SELECT title, status FROM study.schedule_items
    WHERE user_id = ${userId} AND ((status = 'planned' AND starts_at >= now() - interval '1 day') OR (status = 'dismissed' AND source = 'agent'))
    ORDER BY updated_at DESC LIMIT 40
  `);
  return {
    lastPlannedAt: state?.last_planned_at ? new Date(state.last_planned_at) : null,
    pending: Number(state?.pending ?? 0),
    slots: { today: new Date(state!.today), tomorrow: new Date(state!.tomorrow), later: new Date(state!.later) },
    planned: [...titles].filter((row) => row.status === "planned").map((row) => row.title),
    dismissed: [...titles].filter((row) => row.status === "dismissed").map((row) => row.title),
  };
}

export function shouldReplan(state: { lastPlannedAt: Date | null; pending: number }, latestEvidenceAt: Date | null, now: Date): boolean {
  if (!state.lastPlannedAt) return true;
  const since = now.getTime() - state.lastPlannedAt.getTime();
  if (state.pending === 0) return since > replanWhenEmptyMs;
  return Boolean(latestEvidenceAt && latestEvidenceAt > state.lastPlannedAt && since > replanAfterEvidenceMs);
}

export function fallbackActions(lessons: Lesson[], related: Candidate[]): Action[] {
  const unfinished = lessons.filter((lesson) => !lesson.completed).slice(0, 2).map((lesson): Action => ({
    title: `Finish ${lesson.title}`.slice(0, 160),
    reason: lesson.progressPct > 0 ? `You are ${lesson.progressPct}% through it; pick up where you left off.` : "You opened it recently; give it a focused session.",
    kind: kindForResource(lesson.type),
    minutes: 30, when: "today", resourceId: lesson.resourceId, searchQuery: lesson.title,
  }));
  const next = related.map((item): Action => ({ title: `${item.type === "video" ? "Watch" : "Read"} ${item.title}`.slice(0, 160), reason: `${item.why}.`, kind: kindForResource(item.type), minutes: 30, when: "tomorrow", resourceId: item.id, searchQuery: item.title }));
  return [...unfinished, ...next].slice(0, 3);
}

const verdictSchema = z.object({ items: z.array(z.object({ id: z.string(), progressPct: z.number().transform((value) => Math.max(0, Math.min(100, Math.round(value)))), done: z.boolean(), note: z.string().max(240) })) });
const verdictJsonSchema = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "progressPct", "done", "note"], properties: { id: { type: "string" }, progressPct: { type: "integer" }, done: { type: "boolean" }, note: { type: "string" } } } } },
};

// The model sees one line per material: total minutes and whether it was finished.
function summarise(entries: Evidence[]): { title: string; type: string; minutes: number; finished: boolean }[] {
  const byResource = new Map<string, { title: string; type: string; seconds: number; finished: boolean }>();
  for (const entry of entries) {
    const current = byResource.get(entry.resourceId) ?? { title: entry.title, type: entry.type, seconds: 0, finished: false };
    byResource.set(entry.resourceId, { ...current, seconds: current.seconds + entry.seconds, finished: current.finished || entry.finished });
  }
  return [...byResource.values()].map((entry) => ({ title: entry.title, type: entry.type, minutes: entry.seconds > 0 ? minutes(entry.seconds) : 0, finished: entry.finished }));
}

async function judgeTasks(items: OpenItem[], evidence: Map<string, Evidence[]>): Promise<Verdict[]> {
  const result = await structuredCompletion({
    name: "plan_verdicts",
    system: "You are the LearnSpace observer. You check a learner's study plan against what they actually studied, so they never tick boxes themselves. Judge each plan item only from the evidence listed for its own day. The kind says what counts: watch needs videos, read needs papers or articles, practice and review need study of the item's topic. Evidence counts only when its material is about the item's topic: study of something unrelated (for example a cooking video for a Java item) never counts, however long it was. Mark done only when the evidence clearly covers the item; partial coverage gets a progressPct below 100. The note is one short sentence to the learner that cites the evidence, for example \"Watched 32 min of Java Inheritance Explained.\"",
    user: JSON.stringify({ items: items.map((item) => ({ id: item.id, title: item.title, kind: item.kind, description: item.description, day: item.day, plannedMinutes: minutes(plannedSeconds(item)), evidence: summarise((evidence.get(item.day) ?? []).filter((entry) => countsFor(item, entry))) })) }),
    jsonSchema: verdictJsonSchema,
    parser: verdictSchema,
  });
  const ids = new Set(items.map((item) => item.id));
  return result.items.filter((verdict) => ids.has(verdict.id));
}

const actionSchema = z.object({ actions: z.array(z.object({
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().max(400),
  kind: z.enum(PLAN_KINDS),
  minutes: z.number().transform((value) => Math.max(10, Math.min(120, Math.round(value)))),
  when: z.enum(["today", "tomorrow", "later"]),
  resourceId: z.string().nullable(),
  searchQuery: z.string().trim().max(120),
})).max(3) });
const actionJsonSchema = {
  type: "object", additionalProperties: false, required: ["actions"],
  properties: { actions: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "reason", "kind", "minutes", "when", "resourceId", "searchQuery"], properties: {
    title: { type: "string" }, reason: { type: "string" }, kind: { type: "string", enum: PLAN_KINDS }, minutes: { type: "integer" },
    when: { type: "string", enum: ["today", "tomorrow", "later"] },
    resourceId: { type: ["string", "null"] }, searchQuery: { type: "string" },
  } } } },
};

async function planActions(lessons: Lesson[], candidates: Candidate[], planned: string[], dismissed: string[]): Promise<Action[]> {
  const result = await structuredCompletion({
    name: "next_actions",
    system: "You are the LearnSpace planning agent. Propose exactly three next study actions that maximise the learner's progress. Build on what they studied: finish what is nearly done, then move to the natural next concept (for example, after inheritance in Java comes polymorphism, then abstract classes and interfaces). When a candidate resource fits, use its id as resourceId; otherwise resourceId is null and searchQuery names the material to look for. Never repeat an item that is already planned or that the learner dismissed. The kind is watch for videos, read for papers and articles, practice for exercises and coding, and review for revising what they already studied. The title is an imperative under 60 characters; the reason is one sentence tied to their recent study.",
    user: JSON.stringify({ recentStudy: lessons, candidates, alreadyPlanned: planned, dismissed }),
    jsonSchema: actionJsonSchema,
    parser: actionSchema,
  });
  const ids = new Set(candidates.map((candidate) => candidate.id));
  return result.actions.map((action) => ({ ...action, resourceId: action.resourceId && ids.has(action.resourceId) ? action.resourceId : null }));
}

// Ground a free-form suggestion in a real catalogue resource when one matches its search phrase.
async function resolveResource(tx: Transaction, userId: string, query: string): Promise<string | null> {
  const words = query.split(/\s+/).filter((word) => word.length > 2).slice(0, 6).map((word) => `%${word.replaceAll(/[%_\\]/g, "")}%`);
  if (words.length === 0) return null;
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM catalog.resources
    WHERE type IN ('video', 'paper', 'pdf') AND status = 'ready' AND deleted_at IS NULL
      AND (owner_user_id = ${userId} OR visibility IN ('public', 'unlisted'))
      AND title ILIKE ALL (ARRAY[${sql.join(words.map((word) => sql`${word}`), sql`, `)}]::text[])
    ORDER BY quality_score DESC NULLS LAST LIMIT 1
  `);
  return row?.id ?? null;
}

async function nextActions(observed: { lessons: Lesson[]; candidates: Candidate[]; planner: { planned: string[]; dismissed: string[] } }, useAi: boolean): Promise<Action[]> {
  const fallback = () => fallbackActions(observed.lessons, observed.candidates.filter((candidate) => !observed.lessons.some((lesson) => lesson.resourceId === candidate.id)));
  if (!useAi) return fallback();
  try {
    return await planActions(observed.lessons, observed.candidates, observed.planner.planned, observed.planner.dismissed);
  } catch (error) {
    console.error("[plan-observer] planning failed", error);
    return fallback();
  }
}

// The first start at or after `from` where `length` fits without overlapping a busy interval.
export function freeSlot(from: number, length: number, busy: { start: number; end: number }[]): number {
  let start = from;
  for (let moved = true; moved;) {
    moved = false;
    for (const interval of busy) {
      if (interval.start < start + length && interval.end > start) {
        start = interval.end;
        moved = true;
      }
    }
  }
  return start;
}

export async function observePlan(userId: string, now = new Date()): Promise<{ changed: boolean }> {
  const observed = await withUserTransaction(userId, async (tx) => {
    const timezone = await loadTimezone(tx, userId);
    const [items, evidence, lessons, planner] = await Promise.all([
      loadOpenItems(tx, userId, timezone),
      loadEvidence(tx, userId, timezone),
      loadRecentLessons(tx, userId),
      loadPlannerState(tx, userId, timezone),
    ]);
    const useAi = openAiConfigured();
    // With a model, free-text items are judged on topic below; without one they are matched by kind and time.
    const matched = items.filter((item) => item.resourceId || !useAi);
    const matches = new Map([...new Set(matched.map((item) => item.day))].flatMap((day) => [...reconcileDay(matched.filter((item) => item.day === day), evidence.byDay.get(day) ?? [])]));
    let changed = false;
    for (const item of matched) {
      const verdict = matches.get(item.id);
      if (!verdict) continue;
      if (verdict.progressPct === Math.round(item.progressPct) && !verdict.done && verdict.note === item.observerNote) continue;
      await tx.update(scheduleItems).set({ progressPct: verdict.progressPct, observerNote: verdict.note, evaluatedAt: now, ...(verdict.done ? { status: "done", completedAt: now } : {}) })
        .where(and(eq(scheduleItems.id, item.id), eq(scheduleItems.status, "planned")));
      changed = true;
    }
    // Free-text items need judgment; only send them when that day has evidence the observer has not seen.
    const tasks = items.filter((item) => useAi && !item.resourceId && evidence.byDay.has(item.day) && evidence.latestAt && (!item.evaluatedAt || item.evaluatedAt < evidence.latestAt));
    const replan = lessons.length > 0 && shouldReplan(planner, evidence.latestAt, now);
    const latest = lessons[0];
    const related = replan && latest ? await loadRelatedVideos(tx, userId, latest.resourceId) : [];
    const candidates: Candidate[] = [
      ...lessons.filter((lesson) => !lesson.completed).map((lesson) => ({ id: lesson.resourceId, title: lesson.title, type: lesson.type, why: `Unfinished, ${lesson.progressPct}% done` })),
      ...related.map((video) => ({ id: video.resourceId, title: video.title, type: "video", why: video.reason })),
    ];
    return { changed, tasks, evidence: evidence.byDay, replan, lessons, candidates, planner, useAi };
  });

  const { useAi } = observed;
  const [verdicts, actions] = await Promise.all([
    observed.tasks.length > 0
      ? judgeTasks(observed.tasks, observed.evidence).catch((error: unknown) => { console.error("[plan-observer] evaluation failed", error); return []; })
      : Promise.resolve([]),
    observed.replan ? nextActions(observed, useAi) : Promise.resolve(null),
  ]);
  if (verdicts.length === 0 && !actions) return { changed: observed.changed };

  await withUserTransaction(userId, async (tx) => {
    for (const verdict of verdicts) {
      const item = observed.tasks.find((task) => task.id === verdict.id)!;
      // Skip items the learner edited while the model was thinking.
      await tx.update(scheduleItems).set({ progressPct: verdict.done ? 100 : Math.min(99, verdict.progressPct), observerNote: verdict.note, evaluatedAt: now, ...(verdict.done ? { status: "done", completedAt: now } : {}) })
        .where(and(eq(scheduleItems.id, item.id), eq(scheduleItems.status, "planned"), sql`${scheduleItems.updatedAt} = ${item.updatedAt}::timestamptz`));
    }
    if (!actions) return;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-agent:${userId}`}, 0))`);
    const [current] = await tx.execute<{ at: string | null }>(sql`SELECT max(created_at) AS at FROM study.schedule_items WHERE user_id = ${userId} AND source = 'agent' AND NOT all_day`);
    // Another tick planned first; keep its suggestions.
    if ((current?.at ? new Date(current.at).getTime() : null) !== (observed.planner.lastPlannedAt?.getTime() ?? null)) return;
    await tx.delete(scheduleItems).where(and(eq(scheduleItems.userId, userId), replaceableAgentItem));
    // Agent items go straight onto the calendar, so they must not land on top of what is already planned.
    const busy = [...await tx.execute<{ starts_at: string; ends_at: string }>(sql`
      SELECT starts_at, coalesce(ends_at, starts_at + interval '30 minutes') AS ends_at FROM study.schedule_items
      WHERE user_id = ${userId} AND status IN ('planned', 'done') AND NOT all_day AND starts_at < now() + interval '5 days' AND coalesce(ends_at, starts_at) > now()
    `)].map((row) => ({ start: new Date(row.starts_at).getTime(), end: new Date(row.ends_at).getTime() }));
    const cursors = { ...observed.planner.slots };
    for (const action of actions) {
      const resourceId = action.resourceId ?? await resolveResource(tx, userId, action.searchQuery);
      const length = action.minutes * 60_000;
      const start = freeSlot(cursors[action.when].getTime(), length, busy);
      const startsAt = new Date(start);
      const endsAt = new Date(start + length);
      busy.push({ start, end: start + length });
      cursors[action.when] = endsAt;
      await tx.insert(scheduleItems).values({ userId, kind: action.kind, status: "planned", source: "agent", title: action.title, description: action.reason, startsAt, endsAt, resourceId, createdAt: now, updatedAt: now });
    }
  });
  return { changed: true };
}

export type TickResult = { verified: boolean; note: string };

// A learner's tick is a request to check now: the item completes, and earns its XP, only when recorded study backs it.
// Unticking reopens the item; the observer will complete it again on its own if the evidence is there.
export async function tickPlanItem(userId: string, itemId: string, done: boolean, now = new Date()): Promise<TickResult> {
  const id = z.uuid().parse(itemId);
  const [current] = await withUserTransaction(userId, (tx) => tx.select({ status: scheduleItems.status, startsAt: scheduleItems.startsAt }).from(scheduleItems)
    .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id))));
  if (!current) throw new AuthError("PLAN_ITEM_NOT_FOUND", "That plan item no longer exists.", 404);
  if (current.status !== "planned" && current.status !== "done") throw new AuthError("PLAN_ITEM_NOT_PLANNED", "Only planned items can be ticked off.", 409);
  if (!done) {
    await withUserTransaction(userId, (tx) => tx.update(scheduleItems).set({ status: "planned", completedAt: null, progressPct: 0, observerNote: null, evaluatedAt: null, updatedAt: now })
      .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id))));
    return { verified: false, note: "Reopened." };
  }
  if (current.status === "done") return { verified: true, note: "Already done." };

  const observed = await withUserTransaction(userId, async (tx) => {
    const timezone = await loadTimezone(tx, userId);
    const [items, evidence] = await Promise.all([loadOpenItems(tx, userId, timezone, id), loadEvidence(tx, userId, timezone)]);
    return { items, evidence: evidence.byDay };
  });
  const item = observed.items.find((entry) => entry.id === id);
  if (!item) {
    const note = current.startsAt > now ? "This is planned for later. It can be checked once its day comes." : "This is too old to check against your study.";
    return { verified: false, note };
  }
  const dayEvidence = observed.evidence.get(item.day) ?? [];
  let verdict: { progressPct: number; done: boolean; note: string | null };
  if (item.resourceId || !openAiConfigured()) {
    // The day's other open items take their share first, so the same minutes never complete two items.
    verdict = reconcileDay(observed.items, dayEvidence).get(id) ?? { progressPct: 0, done: false, note: null };
  } else if (!dayEvidence.some((entry) => countsFor(item, entry))) {
    verdict = { progressPct: 0, done: false, note: null };
  } else {
    const [judged] = await judgeTasks([item], observed.evidence).catch((error: unknown) => { console.error("[plan-observer] tick check failed", error); return []; });
    if (!judged) return { verified: false, note: "We could not check this right now. Try again in a moment." };
    verdict = judged;
  }
  const note = verdict.done
    ? verdict.note ?? "Checked against your study."
    : verdict.note ? `Not yet: ${verdict.note}` : `No study on ${item.allDay ? "this day" : "this item"} matches it yet. Study it first, then tick it.`;
  await withUserTransaction(userId, (tx) => tx.update(scheduleItems).set({
    progressPct: verdict.done ? 100 : Math.min(99, verdict.progressPct), observerNote: verdict.note ?? item.observerNote, evaluatedAt: now,
    ...(verdict.done ? { status: "done", completedAt: now } : {}),
  }).where(and(eq(scheduleItems.id, id), eq(scheduleItems.status, "planned"), sql`${scheduleItems.updatedAt} = ${item.updatedAt}::timestamptz`)));
  return { verified: verdict.done, note };
}

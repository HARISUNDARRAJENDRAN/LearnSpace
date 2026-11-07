import { withUserTransaction, type Transaction } from "@learnspace/db";
import { scheduleItems } from "@learnspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { openAiConfigured, structuredCompletion } from "../ai/openai";
import { loadRelatedVideos, loadTimezone } from "../home/service";
import { kindForResource, PLAN_KINDS, type PlanKind } from "./kinds";

const evaluationWindowDays = 14;
const defaultPlannedSeconds = 30 * 60;
const replanAfterEvidenceMs = 20 * 60_000;
const replanWhenEmptyMs = 6 * 3_600_000;

type OpenItem = { id: string; title: string; description: string | null; kind: PlanKind; resourceId: string | null; startsAt: Date; endsAt: Date | null; allDay: boolean; progressPct: number; observerNote: string | null; evaluatedAt: Date | null; updatedAt: string; day: string };
type Evidence = { resourceId: string; title: string; type: string; seconds: number; finished: boolean };
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

type DayItem = Pick<OpenItem, "id" | "kind" | "resourceId" | "startsAt" | "endsAt" | "allDay">;

// Which study minutes can count toward each kind; practice and review take whatever study is left.
const readingTypes = new Set(["paper", "pdf", "webpage", "note"]);
const pool = (type: string) => type === "video" ? "video" : readingTypes.has(type) ? "reading" : "other";
const kindPools: Record<PlanKind, ("video" | "reading" | "other")[]> = { watch: ["video"], read: ["reading"], practice: ["other", "video", "reading"], review: ["other", "video", "reading"] };

// Shares one day's study among that day's items in start order, so the same minutes never complete two items.
export function reconcileDay(items: DayItem[], evidence: Evidence[]): Map<string, { progressPct: number; done: boolean; note: string | null }> {
  const left = { video: 0, reading: 0, other: 0 };
  for (const entry of evidence) left[pool(entry.type)] += entry.seconds;
  const verdicts = new Map<string, { progressPct: number; done: boolean; note: string | null }>();
  // Items tied to a material claim that material's time first.
  for (const item of items.filter((entry) => entry.resourceId)) {
    const match = evidence.find((entry) => entry.resourceId === item.resourceId);
    verdicts.set(item.id, reconcileStudyItem(item, match));
    if (match) left[pool(match.type)] -= Math.min(match.seconds, plannedSeconds(item));
  }
  for (const item of items.filter((entry) => !entry.resourceId).toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const planned = plannedSeconds(item);
    let seconds = 0;
    for (const source of kindPools[item.kind]) {
      const take = Math.max(0, Math.min(left[source], planned - seconds));
      left[source] -= take;
      seconds += take;
    }
    verdicts.set(item.id, reconcileStudyItem(item, seconds > 0 ? { resourceId: "", title: "", type: "", seconds, finished: false } : undefined));
  }
  return verdicts;
}

async function loadOpenItems(tx: Transaction, userId: string, timezone: string): Promise<OpenItem[]> {
  const rows = await tx.execute<{ id: string; title: string; description: string | null; kind: PlanKind; resource_id: string | null; starts_at: string; ends_at: string | null; all_day: boolean; progress_pct: number; observer_note: string | null; evaluated_at: string | null; updated_at: string; day: string }>(sql`
    SELECT id, title, description, kind, resource_id, starts_at, ends_at, all_day, progress_pct, observer_note, evaluated_at,
      -- Text keeps the microseconds the edit guard compares; a JS Date would drop them.
      updated_at::text AS updated_at,
      to_char(starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day
    FROM study.schedule_items
    WHERE user_id = ${userId} AND status = 'planned'
      AND starts_at >= now() - make_interval(days => ${evaluationWindowDays})
      AND date_trunc('day', starts_at AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone} <= now()
  `);
  const date = (value: string | null) => value ? new Date(value) : null;
  return [...rows].map((row) => ({ id: row.id, title: row.title, description: row.description, kind: row.kind, resourceId: row.resource_id, startsAt: new Date(row.starts_at), endsAt: date(row.ends_at), allDay: row.all_day, progressPct: Number(row.progress_pct), observerNote: row.observer_note, evaluatedAt: date(row.evaluated_at), updatedAt: row.updated_at, day: row.day }));
}

async function loadEvidence(tx: Transaction, userId: string, timezone: string): Promise<{ byDay: Map<string, Evidence[]>; latestAt: Date | null }> {
  const rows = await tx.execute<{ day: string; resource_id: string; title: string; type: string; seconds: number; finished: boolean }>(sql`
    WITH studied AS (
      SELECT to_char(f.started_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, f.resource_id, sum(f.duration_sec)::int AS seconds, false AS finished
      FROM study.focus_sessions f
      WHERE f.user_id = ${userId} AND f.resource_id IS NOT NULL AND f.duration_sec > 0 AND f.ended_at <= now()
        AND f.started_at >= now() - make_interval(days => ${evaluationWindowDays + 1})
      GROUP BY 1, 2
      UNION ALL
      SELECT to_char(p.completed_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD'), p.resource_id, 0, true
      FROM study.user_resource_progress p
      WHERE p.user_id = ${userId} AND p.completed_at >= now() - make_interval(days => ${evaluationWindowDays + 1})
    )
    SELECT s.day, s.resource_id, r.title, r.type::text AS type, sum(s.seconds)::int AS seconds, bool_or(s.finished) AS finished
    FROM studied s JOIN catalog.resources r ON r.id = s.resource_id
    GROUP BY s.day, s.resource_id, r.title, r.type
  `);
  const [latest] = await tx.execute<{ at: string | null }>(sql`
    SELECT greatest(
      (SELECT max(ended_at) FROM study.focus_sessions WHERE user_id = ${userId} AND ended_at <= now()),
      (SELECT max(updated_at) FROM study.user_resource_progress WHERE user_id = ${userId})
    ) AS at
  `);
  const byDay = new Map<string, Evidence[]>();
  for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), { resourceId: row.resource_id, title: row.title, type: row.type, seconds: Number(row.seconds), finished: row.finished }]);
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

async function loadPlannerState(tx: Transaction, userId: string, timezone: string) {
  const [state] = await tx.execute<{ last_planned_at: string | null; pending: number; today: string; tomorrow: string; later: string }>(sql`
    SELECT
      (SELECT max(created_at) FROM study.schedule_items WHERE user_id = ${userId} AND source = 'agent') AS last_planned_at,
      (SELECT count(*)::int FROM study.schedule_items WHERE user_id = ${userId} AND status = 'suggested') AS pending,
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

async function judgeTasks(items: OpenItem[], evidence: Map<string, Evidence[]>): Promise<Verdict[]> {
  const result = await structuredCompletion({
    name: "plan_verdicts",
    system: "You are the LearnSpace observer. You check a learner's study plan against what they actually studied, so they never tick boxes themselves. Judge each plan item only from the evidence listed for its own day. The kind says what counts: watch needs videos, read needs papers or articles, practice and review need study of the item's topic. Mark done only when the evidence clearly covers the item; partial coverage gets a progressPct below 100. The note is one short sentence to the learner that cites the evidence, for example \"Watched 32 min of Java Inheritance Explained.\"",
    user: JSON.stringify({ items: items.map((item) => ({ id: item.id, title: item.title, kind: item.kind, description: item.description, day: item.day, plannedMinutes: minutes(plannedSeconds(item)), evidence: (evidence.get(item.day) ?? []).map((entry) => ({ title: entry.title, type: entry.type, minutes: minutes(entry.seconds), finished: entry.finished })) })) }),
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
    const [current] = await tx.execute<{ at: string | null }>(sql`SELECT max(created_at) AS at FROM study.schedule_items WHERE user_id = ${userId} AND source = 'agent'`);
    // Another tick planned first; keep its suggestions.
    if ((current?.at ? new Date(current.at).getTime() : null) !== (observed.planner.lastPlannedAt?.getTime() ?? null)) return;
    await tx.delete(scheduleItems).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.status, "suggested")));
    const cursors = { ...observed.planner.slots };
    for (const action of actions) {
      const resourceId = action.resourceId ?? await resolveResource(tx, userId, action.searchQuery);
      const startsAt = cursors[action.when];
      const endsAt = new Date(startsAt.getTime() + action.minutes * 60_000);
      cursors[action.when] = endsAt;
      await tx.insert(scheduleItems).values({ userId, kind: action.kind, status: "suggested", source: "agent", title: action.title, description: action.reason, startsAt, endsAt, resourceId, createdAt: now, updatedAt: now });
    }
  });
  return { changed: true };
}

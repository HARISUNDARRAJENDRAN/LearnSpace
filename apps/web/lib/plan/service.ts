import { withUserTransaction, type Transaction } from "@learnspace/db";
import { resources, scheduleItems, studySessions, userResourceProgress, videoDetails } from "@learnspace/db/schema";
import { cacheDelete, homeDashboardCacheKey } from "@learnspace/shared/recommendation-cache";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthError } from "../auth/errors";
import { openAiConfigured, structuredCompletion } from "../ai/openai";
import { kindForResource, kindFromWords, kindLabel, PLAN_KINDS, type PlanKind } from "./kinds";

export type PlanStatus = "suggested" | "planned" | "done" | "dismissed";

export type PlanItem = {
  id: string;
  title: string;
  description: string | null;
  kind: PlanKind;
  status: PlanStatus;
  source: "learner" | "agent";
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  progressPct: number;
  observerNote: string | null;
  evaluatedAt: string | null;
  completedAt: string | null;
  resource: { id: string; title: string; type: string; youtubeId: string | null } | null;
};

const maxItemMs = 12 * 3_600_000;

const planItemFields = z.object({
  title: z.string().trim().min(1, "Give the plan a title.").max(160),
  description: z.string().trim().max(1000).nullable(),
  kind: z.enum(PLAN_KINDS),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  allDay: z.boolean(),
}).strict();

function validTimes(value: { startsAt?: string | undefined; endsAt?: string | null | undefined }): boolean {
  if (!value.startsAt || !value.endsAt) return true;
  const span = Date.parse(value.endsAt) - Date.parse(value.startsAt);
  return span > 0 && span <= maxItemMs;
}

// The learner picks what to study (a session's material, or their own words) and when; the type is worked out for them.
export const planItemInputSchema = planItemFields
  .extend({ title: planItemFields.shape.title.optional(), kind: planItemFields.shape.kind.optional(), resourceId: z.uuid().nullable().optional(), studySessionId: z.uuid().nullable().optional() })
  .refine(validTimes, "End the plan after it starts, within 12 hours.")
  .refine((value) => Boolean(value.title || value.resourceId), "Give the plan a title or pick what to study.");

// Learners edit their plan and may dismiss agent items; only the observer marks work done (a tick asks it to check, see tickPlanItem).
export const planItemPatchSchema = planItemFields.partial()
  .extend({ status: z.enum(["planned", "dismissed"]).optional() })
  .strict()
  .refine(validTimes, "End the plan after it starts, within 12 hours.");

export const planRangeSchema = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .refine(({ from, to }) => Date.parse(to) > Date.parse(from) && Date.parse(to) - Date.parse(from) <= 62 * 86_400_000, "Ask for at most 62 days at a time.");

export const planTickSchema = z.object({ done: z.boolean() }).strict();

export type PlanItemInput = z.infer<typeof planItemInputSchema>;
export type PlanItemPatch = z.infer<typeof planItemPatchSchema>;

const itemColumns = {
  id: scheduleItems.id,
  title: scheduleItems.title,
  description: scheduleItems.description,
  kind: scheduleItems.kind,
  status: scheduleItems.status,
  source: scheduleItems.source,
  startsAt: scheduleItems.startsAt,
  endsAt: scheduleItems.endsAt,
  allDay: scheduleItems.allDay,
  progressPct: scheduleItems.progressPct,
  observerNote: scheduleItems.observerNote,
  evaluatedAt: scheduleItems.evaluatedAt,
  completedAt: scheduleItems.completedAt,
  resourceId: resources.id,
  resourceTitle: resources.title,
  resourceType: resources.type,
  youtubeId: videoDetails.youtubeId,
};

type ItemRow = Awaited<ReturnType<typeof selectItems>>[number];

function toItem(row: ItemRow): PlanItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind as PlanKind,
    status: row.status as PlanStatus,
    source: row.source as PlanItem["source"],
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    allDay: row.allDay,
    progressPct: Math.round(row.progressPct),
    observerNote: row.observerNote,
    evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    resource: row.resourceId && row.resourceTitle && row.resourceType ? { id: row.resourceId, title: row.resourceTitle, type: row.resourceType, youtubeId: row.youtubeId } : null,
  };
}

function selectItems(tx: Transaction) {
  return tx.select(itemColumns).from(scheduleItems)
    .leftJoin(resources, eq(resources.id, scheduleItems.resourceId))
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id));
}

async function loadItem(tx: Transaction, userId: string, itemId: string): Promise<PlanItem> {
  const [row] = await selectItems(tx).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, itemId)));
  if (!row) throw new AuthError("PLAN_ITEM_NOT_FOUND", "That plan item no longer exists.", 404);
  return toItem(row);
}

export async function getPlanItem(userId: string, itemId: string): Promise<PlanItem> {
  const id = z.uuid().parse(itemId);
  return withUserTransaction(userId, (tx) => loadItem(tx, userId, id));
}

export async function listPlanItems(userId: string, from: string, to: string): Promise<PlanItem[]> {
  const range = planRangeSchema.parse({ from, to });
  return withUserTransaction(userId, async (tx) => {
    const rows = await selectItems(tx).where(and(
      eq(scheduleItems.userId, userId),
      inArray(scheduleItems.status, ["planned", "done"]),
      lt(scheduleItems.startsAt, new Date(range.to)),
      sql`coalesce(${scheduleItems.endsAt}, ${scheduleItems.startsAt}) >= ${range.from}::timestamptz`,
    )).orderBy(asc(scheduleItems.startsAt));
    return rows.map(toItem);
  });
}

export async function listPlanSuggestions(tx: Transaction, userId: string): Promise<PlanItem[]> {
  // The planner's upcoming items: they are already on the calendar, and Home lists them so the learner can start or drop one.
  const rows = await selectItems(tx).where(and(
    eq(scheduleItems.userId, userId), eq(scheduleItems.source, "agent"), eq(scheduleItems.allDay, false),
    or(eq(scheduleItems.status, "suggested"), and(eq(scheduleItems.status, "planned"), sql`coalesce(${scheduleItems.endsAt}, ${scheduleItems.startsAt}) > now()`)),
  )).orderBy(asc(scheduleItems.startsAt)).limit(3);
  return rows.map(toItem);
}

const kindSchema = z.object({ kind: z.enum(PLAN_KINDS) });

// Free-text plans: the words decide when they name a kind; otherwise a model reads the intent, and Watch is the fallback.
export async function inferPlanKind(title: string, description: string | null): Promise<PlanKind> {
  const text = `${title} ${description ?? ""}`;
  const named = kindFromWords(text);
  if (named || !openAiConfigured()) return named ?? "watch";
  try {
    const result = await structuredCompletion({
      name: "plan_kind",
      system: "Classify one item from a learner's study plan. watch: watching videos or lectures. read: reading papers, articles, books or docs. practice: exercises, coding, solving problems, building. review: revising or recapping something already studied. Answer with the single best kind.",
      user: JSON.stringify({ title, notes: description }),
      jsonSchema: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: PLAN_KINDS } } },
      parser: kindSchema,
    });
    return result.kind;
  } catch (error) {
    console.error("[plan] kind inference failed", error);
    return "watch";
  }
}

// A material the learner can open, and whether they already finished it (then the plan is a review).
async function loadMaterial(tx: Transaction, userId: string, resourceId: string): Promise<{ title: string; kind: PlanKind }> {
  const [row] = await tx.select({ title: resources.title, type: resources.type, completedAt: userResourceProgress.completedAt }).from(resources)
    .leftJoin(userResourceProgress, and(eq(userResourceProgress.resourceId, resources.id), eq(userResourceProgress.userId, userId)))
    .where(and(eq(resources.id, resourceId), sql`${resources.deletedAt} IS NULL`, or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"]))));
  if (!row) throw new AuthError("PLAN_RESOURCE_NOT_FOUND", "That material is not available.", 404);
  return { title: row.title, kind: row.completedAt ? "review" : kindForResource(row.type) };
}

export async function createPlanItem(userId: string, input: PlanItemInput): Promise<PlanItem> {
  const value = planItemInputSchema.parse(input);
  // Free-text kinds may need a model call, so they are settled before the transaction opens.
  const freeKind = value.resourceId ? null : value.kind ?? await inferPlanKind(value.title ?? "", value.description);
  const created = await withUserTransaction(userId, async (tx) => {
    const material = value.resourceId ? await loadMaterial(tx, userId, value.resourceId) : null;
    if (value.studySessionId) {
      const [session] = await tx.select({ id: studySessions.id }).from(studySessions).where(and(eq(studySessions.id, value.studySessionId), eq(studySessions.userId, userId)));
      if (!session) throw new AuthError("PLAN_SESSION_NOT_FOUND", "That study session no longer exists.", 404);
    }
    const kind = material?.kind ?? freeKind ?? "watch";
    const [row] = await tx.insert(scheduleItems).values({
      userId,
      kind,
      title: value.title || `${kindLabel[kind]} ${material?.title ?? ""}`.trim().slice(0, 160),
      resourceId: value.resourceId ?? null,
      studySessionId: value.studySessionId ?? null,
      description: value.description,
      startsAt: new Date(value.startsAt),
      endsAt: value.endsAt ? new Date(value.endsAt) : null,
      allDay: value.allDay,
    }).returning({ id: scheduleItems.id });
    return loadItem(tx, userId, row!.id);
  });
  await cacheDelete(homeDashboardCacheKey(userId));
  return created;
}

export async function updatePlanItem(userId: string, itemId: string, patch: PlanItemPatch): Promise<PlanItem> {
  const id = z.uuid().parse(itemId);
  const parsed = planItemPatchSchema.parse(patch);
  // A free-text item's type follows its words, so a new title or notes re-infers it; material-linked items keep theirs.
  const [linked] = parsed.kind === undefined && (parsed.title !== undefined || parsed.description !== undefined)
    ? await withUserTransaction(userId, (tx) => tx.select({ resourceId: scheduleItems.resourceId, title: scheduleItems.title, description: scheduleItems.description }).from(scheduleItems).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id))))
    : [];
  const value = linked && !linked.resourceId
    ? { ...parsed, kind: await inferPlanKind(parsed.title ?? linked.title, parsed.description === undefined ? linked.description : parsed.description) }
    : parsed;
  const updated = await withUserTransaction(userId, async (tx) => {
    const [current] = await tx.select({ status: scheduleItems.status, source: scheduleItems.source, startsAt: scheduleItems.startsAt, endsAt: scheduleItems.endsAt }).from(scheduleItems)
      .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id))).for("update");
    if (!current) throw new AuthError("PLAN_ITEM_NOT_FOUND", "That plan item no longer exists.", 404);
    // Agent items land on the calendar already planned; the learner can still dismiss them, and accept any older-style suggestion.
    const dismissable = current.status === "suggested" || (current.source === "agent" && current.status === "planned");
    if (value.status === "planned" && current.status !== "suggested") throw new AuthError("PLAN_ITEM_NOT_SUGGESTED", "Only suggestions can be accepted.", 409);
    if (value.status === "dismissed" && !dismissable) throw new AuthError("PLAN_ITEM_NOT_SUGGESTED", "Only the planner's items can be dismissed.", 409);
    const now = new Date();
    const startsAt = value.startsAt ? new Date(value.startsAt) : current.startsAt;
    const endsAt = value.endsAt === undefined ? current.endsAt : value.endsAt ? new Date(value.endsAt) : null;
    if (endsAt && (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > maxItemMs)) throw new AuthError("INVALID_PLAN_TIME", "End the plan after it starts, within 12 hours.", 422);
    // What counts as evidence changes with the time or kind, so the observer looks again.
    const reevaluate = value.startsAt !== undefined || value.endsAt !== undefined || value.kind !== undefined;
    await tx.update(scheduleItems).set({
      ...(value.title === undefined ? {} : { title: value.title }),
      ...(value.description === undefined ? {} : { description: value.description }),
      ...(value.allDay === undefined ? {} : { allDay: value.allDay }),
      ...(value.kind === undefined ? {} : { kind: value.kind }),
      ...(value.status === undefined ? {} : { status: value.status }),
      ...(reevaluate ? { evaluatedAt: null } : {}),
      startsAt,
      endsAt,
      updatedAt: now,
    }).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id)));
    return loadItem(tx, userId, id);
  });
  await cacheDelete(homeDashboardCacheKey(userId));
  return updated;
}

export async function deletePlanItem(userId: string, itemId: string): Promise<void> {
  const id = z.uuid().parse(itemId);
  await withUserTransaction(userId, async (tx) => {
    // Deleting an untouched agent item dismisses it instead, so the planner remembers not to suggest it again.
    const dismissed = await tx.update(scheduleItems).set({ status: "dismissed", updatedAt: new Date() })
      .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id), eq(scheduleItems.source, "agent"), inArray(scheduleItems.status, ["suggested", "planned"]), eq(scheduleItems.progressPct, 0)))
      .returning({ id: scheduleItems.id });
    if (dismissed.length > 0) return;
    const deleted = await tx.delete(scheduleItems).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id), sql`${scheduleItems.status} <> 'dismissed'`)).returning({ id: scheduleItems.id });
    if (deleted.length === 0) throw new AuthError("PLAN_ITEM_NOT_FOUND", "That plan item no longer exists.", 404);
  });
  await cacheDelete(homeDashboardCacheKey(userId));
}

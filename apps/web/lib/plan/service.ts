import { withUserTransaction, type Transaction } from "@learnspace/db";
import { resources, scheduleItems, videoDetails } from "@learnspace/db/schema";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthError } from "../auth/errors";
import { PLAN_KINDS, type PlanKind } from "./kinds";

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

export const planItemInputSchema = planItemFields.refine(validTimes, "End the plan after it starts, within 12 hours.");

// Learners plan and accept or dismiss agent suggestions; only the observer marks work done.
export const planItemPatchSchema = planItemFields.partial()
  .extend({ status: z.enum(["planned", "dismissed"]).optional() })
  .strict()
  .refine(validTimes, "End the plan after it starts, within 12 hours.");

export const planRangeSchema = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .refine(({ from, to }) => Date.parse(to) > Date.parse(from) && Date.parse(to) - Date.parse(from) <= 62 * 86_400_000, "Ask for at most 62 days at a time.");

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
  const rows = await selectItems(tx).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.status, "suggested")))
    .orderBy(asc(scheduleItems.startsAt)).limit(3);
  return rows.map(toItem);
}

export async function createPlanItem(userId: string, input: PlanItemInput): Promise<PlanItem> {
  const value = planItemInputSchema.parse(input);
  return withUserTransaction(userId, async (tx) => {
    const [row] = await tx.insert(scheduleItems).values({
      userId,
      kind: value.kind,
      title: value.title,
      description: value.description,
      startsAt: new Date(value.startsAt),
      endsAt: value.endsAt ? new Date(value.endsAt) : null,
      allDay: value.allDay,
    }).returning({ id: scheduleItems.id });
    return loadItem(tx, userId, row!.id);
  });
}

export async function updatePlanItem(userId: string, itemId: string, patch: PlanItemPatch): Promise<PlanItem> {
  const id = z.uuid().parse(itemId);
  const value = planItemPatchSchema.parse(patch);
  return withUserTransaction(userId, async (tx) => {
    const [current] = await tx.select({ status: scheduleItems.status, startsAt: scheduleItems.startsAt, endsAt: scheduleItems.endsAt }).from(scheduleItems)
      .where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id))).for("update");
    if (!current) throw new AuthError("PLAN_ITEM_NOT_FOUND", "That plan item no longer exists.", 404);
    if (value.status && current.status !== "suggested") throw new AuthError("PLAN_ITEM_NOT_SUGGESTED", "Only suggestions can be accepted or dismissed.", 409);
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
      updatedAt: new Date(),
    }).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id)));
    return loadItem(tx, userId, id);
  });
}

export async function deletePlanItem(userId: string, itemId: string): Promise<void> {
  const id = z.uuid().parse(itemId);
  await withUserTransaction(userId, async (tx) => {
    const deleted = await tx.delete(scheduleItems).where(and(eq(scheduleItems.userId, userId), eq(scheduleItems.id, id))).returning({ id: scheduleItems.id });
    if (deleted.length === 0) throw new AuthError("PLAN_ITEM_NOT_FOUND", "That plan item no longer exists.", 404);
  });
}

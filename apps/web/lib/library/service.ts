import { randomUUID } from "node:crypto";
import { withUserTransaction, type Transaction } from "@learnspace/db";
import { activityEvents, collectionEnrollments, collectionItems, collectionSections, collections, libraryItems, resources, userResourceProgress, videoDetails, paperDetails } from "@learnspace/db/schema";
import type { LibraryCollectionDetail, LibraryCollectionSummary, LibraryItemRequest } from "@learnspace/shared";
import { collectionIdSchema, collectionKindSchema, studyResourceReadinessSchema } from "@learnspace/shared";
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { invalidateHomeFeedCache } from "../discovery/cache";
import { startCollection } from "../study/service";

export type SavedLibraryResource = {
  resourceId: string;
  title: string;
  description: string | null;
  type: typeof resources.$inferSelect.type;
  progressPct: number;
  lastOpenedAt: string | null;
  canonicalUrl: string | null;
  readiness: "preparing" | "ready" | "unavailable";
};

export type LibraryPageData = {
  savedResources: SavedLibraryResource[];
  collections: LibraryCollectionSummary[];
  continueCollections: LibraryCollectionSummary[];
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function kind(value: string): LibraryCollectionSummary["kind"] {
  const parsed = collectionKindSchema.safeParse(value);
  return parsed.success ? parsed.data : "manual";
}

function collectionOwnership(collection: typeof collections.$inferSelect, userId: string): LibraryCollectionSummary["ownership"] {
  if (collection.ownerUserId === userId) return "user";
  if (collection.ownerUserId === null && (collection.kind === "curated" || collection.kind === "learning_path")) return "learnspace";
  return "other";
}

function collectionSource(collection: typeof collections.$inferSelect, userId: string): LibraryCollectionSummary["source"] {
  if (collection.ownerUserId === userId) return collection.kind === "generated" ? "generated" : "user";
  if (collection.ownerUserId === null && (collection.kind === "curated" || collection.kind === "learning_path")) return "learnspace";
  return "public";
}

function readiness(status: typeof resources.$inferSelect.status, hasVersion: boolean, hasDetail: boolean): SavedLibraryResource["readiness"] {
  if (status === "failed" || status === "archived" || !hasDetail) return "unavailable";
  if (hasVersion) return studyResourceReadinessSchema.parse("ready");
  return "preparing";
}

async function visibleResource(tx: Transaction, userId: string, resourceId: string) {
  const rows = await tx
    .select()
    .from(resources)
    .where(and(eq(resources.id, resourceId), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])), isNull(resources.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLibraryPage(userId: string): Promise<LibraryPageData> {
  return withUserTransaction(userId, async (tx) => {
    const [savedRows, collectionRows] = await Promise.all([
      tx.select({ item: libraryItems, resource: resources, video: videoDetails, paper: paperDetails }).from(libraryItems).innerJoin(resources, eq(resources.id, libraryItems.resourceId)).leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id)).leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id)).where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"))).orderBy(desc(libraryItems.updatedAt)).limit(60),
      tx.select().from(collections).where(or(eq(collections.ownerUserId, userId), eq(collections.visibility, "public"))).orderBy(desc(collections.updatedAt)).limit(40),
    ]);
    const resourceIds = savedRows.map((row) => row.resource.id);
    const progressRows = resourceIds.length > 0 ? await tx.select().from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, resourceIds))) : [];
    const progressByResource = new Map(progressRows.map((row) => [row.resourceId, row]));
    const collectionIds = collectionRows.map((row) => row.id);
    const [countRows, enrollmentRows] = await Promise.all([
      collectionIds.length > 0 ? tx.select({ collectionId: collectionSections.collectionId, itemCount: count(collectionItems.id) }).from(collectionSections).leftJoin(collectionItems, eq(collectionItems.sectionId, collectionSections.id)).where(inArray(collectionSections.collectionId, collectionIds)).groupBy(collectionSections.collectionId) : Promise.resolve([]),
      collectionIds.length > 0 ? tx.select().from(collectionEnrollments).where(and(eq(collectionEnrollments.userId, userId), inArray(collectionEnrollments.collectionId, collectionIds))) : Promise.resolve([]),
    ]);
    const countByCollection = new Map(countRows.map((row) => [row.collectionId, Number(row.itemCount)]));
    const enrollmentByCollection = new Map(enrollmentRows.map((row) => [row.collectionId, row]));
    const summaries = collectionRows.map((collection) => {
      const enrollment = enrollmentByCollection.get(collection.id);
      return { id: collection.id, title: collection.title, description: collection.description, kind: kind(collection.kind), ownership: collectionOwnership(collection, userId), source: collectionSource(collection, userId), visibility: collection.visibility, itemCount: countByCollection.get(collection.id) ?? 0, progressPct: enrollment ? Number(enrollment.progressPct) : null, currentItemId: enrollment?.currentItemId ?? null } satisfies LibraryCollectionSummary;
    });
    return {
      savedResources: savedRows.map((row) => ({
        resourceId: row.resource.id,
        title: row.resource.title,
        description: row.resource.description,
        type: row.resource.type,
        progressPct: Number(progressByResource.get(row.resource.id)?.progressPct ?? 0),
        lastOpenedAt: iso(progressByResource.get(row.resource.id)?.lastOpenedAt ?? row.item.lastOpenedAt),
        canonicalUrl: row.resource.canonicalUrl,
        readiness: readiness(row.resource.status, Boolean(row.resource.currentVersionId), row.resource.type === "video" ? Boolean(row.video?.youtubeId) : row.resource.type === "paper" || row.resource.type === "pdf" ? Boolean(row.paper) : true),
      })),
      collections: summaries,
      continueCollections: summaries.filter((collection) => collection.progressPct !== null && collection.progressPct < 100),
    };
  });
}

export async function saveLibraryItem(userId: string, input: LibraryItemRequest): Promise<void> {
  await withUserTransaction(userId, async (tx) => {
    const resource = await visibleResource(tx, userId, input.resourceId);
    if (!resource) throw new AuthError("RESOURCE_NOT_AVAILABLE", "This material is not available.", 404);
    const now = new Date();
    if (input.action === "save") {
      await tx.insert(libraryItems).values({ userId, resourceId: input.resourceId, status: "saved", source: "user", addedAt: now, updatedAt: now }).onConflictDoUpdate({ target: [libraryItems.userId, libraryItems.resourceId], set: { status: "saved", source: "user", updatedAt: now } });
      await tx.insert(activityEvents).values({ schemaVersion: 1, userId, resourceId: input.resourceId, eventType: "resource.saved", actorType: "user", source: "web", correlationId: randomUUID(), occurredAt: now, payload: { source: "library" } }).onConflictDoNothing();
    } else {
      await tx.delete(libraryItems).where(and(eq(libraryItems.userId, userId), eq(libraryItems.resourceId, input.resourceId)));
      await tx.insert(activityEvents).values({ schemaVersion: 1, userId, resourceId: input.resourceId, eventType: "resource.unsaved", actorType: "user", source: "web", correlationId: randomUUID(), occurredAt: now, payload: { source: "library" } }).onConflictDoNothing();
    }
  });
  await invalidateHomeFeedCache(userId);
}

export async function getCollectionDetail(userId: string, collectionId: string): Promise<LibraryCollectionDetail> {
  const normalizedCollectionId = collectionIdSchema.parse(collectionId);
  return withUserTransaction(userId, async (tx) => {
    const collectionRows = await tx.select().from(collections).where(and(eq(collections.id, normalizedCollectionId), or(eq(collections.ownerUserId, userId), eq(collections.visibility, "public")))).limit(1);
    const collection = collectionRows[0];
    if (!collection) throw new AuthError("COLLECTION_NOT_FOUND", "That collection is not available.", 404);
    const sections = await tx.select().from(collectionSections).where(eq(collectionSections.collectionId, normalizedCollectionId)).orderBy(asc(collectionSections.position));
    const itemRows = await tx.select({ item: collectionItems, resource: resources }).from(collectionItems).innerJoin(resources, eq(resources.id, collectionItems.resourceId)).where(inArray(collectionItems.sectionId, sections.map((section) => section.id))).orderBy(asc(collectionItems.position));
    const resourceIds = itemRows.map((row) => row.resource.id);
    const [progressRows, enrollmentRows] = await Promise.all([
      resourceIds.length > 0 ? tx.select().from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, resourceIds))) : Promise.resolve([]),
      tx.select().from(collectionEnrollments).where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.collectionId, normalizedCollectionId))).limit(1),
    ]);
    const progressByResource = new Map(progressRows.map((row) => [row.resourceId, row]));
    const enrollment = enrollmentRows[0];
    const itemBySection = new Map<string, LibraryCollectionDetail["sections"][number]["items"]>();
    for (const row of itemRows) {
      const items = itemBySection.get(row.item.sectionId) ?? [];
      items.push({ id: row.item.id, resourceId: row.resource.id, title: row.resource.title, type: row.resource.type === "video" || row.resource.type === "paper" || row.resource.type === "pdf" ? row.resource.type : "other", position: row.item.position, required: row.item.required, note: row.item.note, progressPct: Number(progressByResource.get(row.resource.id)?.progressPct ?? 0) });
      itemBySection.set(row.item.sectionId, items);
    }
    const itemCount = itemRows.length;
    return {
      id: collection.id,
      title: collection.title,
      description: collection.description,
      kind: kind(collection.kind),
      ownership: collectionOwnership(collection, userId),
      source: collectionSource(collection, userId),
      visibility: collection.visibility,
      itemCount,
      progressPct: enrollment ? Number(enrollment.progressPct) : null,
      currentItemId: enrollment?.currentItemId ?? null,
      sections: sections.map((section) => ({ id: section.id, title: section.title, description: section.description, items: (itemBySection.get(section.id) ?? []).sort((left, right) => left.position - right.position) })),
    };
  });
}

export async function startLibraryCollection(userId: string, collectionId: string, idempotencyKey: string) {
  return startCollection(userId, collectionId, idempotencyKey);
}

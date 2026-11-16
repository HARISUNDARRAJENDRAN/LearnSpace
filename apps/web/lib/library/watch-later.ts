import { withUserTransaction } from "@learnspace/db";
import { collectionEnrollments, collectionItems, collections, collectionSections, resources, videoDetails } from "@learnspace/db/schema";
import { collectionIdSchema } from "@learnspace/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

/** A Discover playlist the learner kept for later; continuing it opens it in Sessions. */
export type WatchLaterPlaylist = {
  collectionId: string;
  slug: string | null;
  title: string;
  lessonCount: number;
  /** The first lesson's video, for the card's thumbnail. */
  youtubeId: string | null;
  addedAt: string;
};

/**
 * Watch later is the learner's queued courses: added from Discover, not started yet. A playlist leaves it once it is
 * continued in Sessions (its enrollment becomes active) or removed.
 */
export async function listWatchLater(userId: string): Promise<WatchLaterPlaylist[]> {
  return withUserTransaction(userId, async (tx) => {
    const rows = await tx.select({ id: collections.id, slug: collections.slug, title: collections.title, addedAt: collectionEnrollments.startedAt }).from(collectionEnrollments)
      .innerJoin(collections, eq(collections.id, collectionEnrollments.collectionId))
      .where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.status, "queued")))
      .orderBy(desc(collectionEnrollments.startedAt)).limit(100);
    if (rows.length === 0) return [];
    const lessons = await tx.select({ collectionId: collectionSections.collectionId, youtubeId: videoDetails.youtubeId }).from(collectionItems)
      .innerJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
      .innerJoin(resources, eq(resources.id, collectionItems.resourceId))
      .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
      .where(and(inArray(collectionSections.collectionId, rows.map((row) => row.id)), eq(resources.type, "video"), isNull(resources.deletedAt)))
      .orderBy(asc(collectionSections.position), asc(collectionItems.position));
    const byCollection = Map.groupBy(lessons, (lesson) => lesson.collectionId);
    return rows.map((row) => {
      const videos = byCollection.get(row.id) ?? [];
      return { collectionId: row.id, slug: row.slug, title: row.title, lessonCount: videos.length, youtubeId: videos.find((video) => video.youtubeId)?.youtubeId ?? null, addedAt: row.addedAt.toISOString() };
    });
  });
}

/** Whether a Discover course is already in Watch later, so its button says so. */
export async function isInWatchLater(userId: string, slug: string): Promise<boolean> {
  return withUserTransaction(userId, async (tx) => {
    const [row] = await tx.select({ status: collectionEnrollments.status }).from(collectionEnrollments)
      .innerJoin(collections, eq(collections.id, collectionEnrollments.collectionId))
      .where(and(eq(collectionEnrollments.userId, userId), eq(collections.slug, slug), eq(collections.kind, "curated"), isNull(collections.ownerUserId))).limit(1);
    return row?.status === "queued";
  });
}

/** Takes a playlist off Watch later. Only a queued one: a course already started keeps its progress. */
export async function removeFromWatchLater(userId: string, collectionId: string): Promise<void> {
  const id = collectionIdSchema.parse(collectionId);
  await withUserTransaction(userId, (tx) => tx.delete(collectionEnrollments)
    .where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.collectionId, id), eq(collectionEnrollments.status, "queued"))));
}

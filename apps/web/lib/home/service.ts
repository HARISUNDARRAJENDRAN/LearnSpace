import { withUserTransaction, type Transaction } from "@learnspace/db";
import { concepts, libraryItems, resourceConcepts, resources, studySessions, userResourceProgress, videoDetails } from "@learnspace/db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

const continueLimit = 1;
const relatedLimit = 4;

type HomeVideo = {
  resourceId: string;
  title: string;
  channelTitle: string | null;
  youtubeId: string;
  thumbnailUrl: string | null;
  thumbnailFallbackUrl: string | null;
  durationMs: number | null;
};

export type HomeContinueItem = HomeVideo & {
  description: string | null;
  sessionId: string;
  progressPct: number;
  lastActiveAt: string;
};

export type HomeVideoItem = HomeVideo & {
  reason: string;
};

export type LearnHomeData = {
  continueWatching: HomeContinueItem | null;
  relatedAnchor: { resourceId: string; title: string } | null;
  relatedVideos: HomeVideoItem[];
};

function thumbnailUrls(youtubeId: string): { primary: string; fallback: string } | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return null;
  return {
    primary: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    fallback: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
  };
}

function visibleResource(userId: string) {
  return or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"]));
}

function videoResource(userId: string) {
  return and(
    eq(resources.type, "video"),
    isNull(resources.deletedAt),
    inArray(resources.status, ["pending", "processing", "ready"]),
    visibleResource(userId),
  );
}

async function loadContinueCandidates(tx: Transaction, userId: string, status: "active" | "paused"): Promise<HomeContinueItem[]> {
  const rows = await tx
    .select({
      sessionId: studySessions.id,
      lastActiveAt: studySessions.lastActiveAt,
      resource: resources,
      video: videoDetails,
      progressPct: userResourceProgress.progressPct,
    })
    .from(studySessions)
    .innerJoin(resources, eq(resources.id, studySessions.activeResourceId))
    .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(userResourceProgress, and(
      eq(userResourceProgress.userId, userId),
      eq(userResourceProgress.resourceId, resources.id),
    ))
    .where(and(
      eq(studySessions.userId, userId),
      eq(studySessions.status, status),
      sql`coalesce(${userResourceProgress.progressPct}, 0) < 100`,
      sql`coalesce(${userResourceProgress.status}, 'not_started') <> 'completed'`,
      videoResource(userId),
    ))
    .orderBy(desc(studySessions.lastActiveAt))
    .limit(continueLimit);

  return rows.map((row) => {
    const thumbnails = thumbnailUrls(row.video.youtubeId);
    return {
    resourceId: row.resource.id,
    title: row.resource.title,
    description: row.resource.description,
    channelTitle: row.video.channelTitle,
    youtubeId: row.video.youtubeId,
    thumbnailUrl: thumbnails?.primary ?? null,
    thumbnailFallbackUrl: thumbnails?.fallback ?? null,
    durationMs: row.video.durationMs,
    sessionId: row.sessionId,
    progressPct: Number(row.progressPct ?? 0),
    lastActiveAt: row.lastActiveAt.toISOString(),
    };
  });
}

async function loadRecentAnchor(tx: Transaction, userId: string): Promise<{ resourceId: string; title: string } | null> {
  const row = await tx
    .select({ resourceId: resources.id, title: resources.title })
    .from(userResourceProgress)
    .innerJoin(resources, eq(resources.id, userResourceProgress.resourceId))
    .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .where(and(
      eq(userResourceProgress.userId, userId),
      isNotNull(userResourceProgress.lastOpenedAt),
      videoResource(userId),
    ))
    .orderBy(desc(userResourceProgress.lastOpenedAt))
    .limit(1);
  return row[0] ?? null;
}

async function loadRelatedVideos(tx: Transaction, userId: string, anchorResourceId: string): Promise<HomeVideoItem[]> {
  const anchorConcepts = await tx
    .select({ conceptId: resourceConcepts.conceptId, name: concepts.name, relevance: resourceConcepts.relevance })
    .from(resourceConcepts)
    .innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId))
    .where(eq(resourceConcepts.resourceId, anchorResourceId))
    .orderBy(desc(resourceConcepts.relevance))
    .limit(12);
  if (anchorConcepts.length === 0) return [];

  const conceptIds = anchorConcepts.map((concept) => concept.conceptId);
  const overlapScore = sql<number>`sum(${resourceConcepts.relevance})`;
  const overlapCount = sql<number>`count(distinct ${resourceConcepts.conceptId})`;
  const rows = await tx
    .select({
      resourceId: resources.id,
      title: resources.title,
      qualityScore: resources.qualityScore,
      updatedAt: resources.updatedAt,
      channelTitle: videoDetails.channelTitle,
      youtubeId: videoDetails.youtubeId,
      durationMs: videoDetails.durationMs,
      overlapScore,
      overlapCount,
    })
    .from(resourceConcepts)
    .innerJoin(resources, eq(resources.id, resourceConcepts.resourceId))
    .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(libraryItems, and(
      eq(libraryItems.userId, userId),
      eq(libraryItems.resourceId, resources.id),
      eq(libraryItems.status, "removed"),
    ))
    .where(and(
      inArray(resourceConcepts.conceptId, conceptIds),
      sql`${resources.id} <> ${anchorResourceId}`,
      videoResource(userId),
      isNull(libraryItems.resourceId),
    ))
    .groupBy(resources.id, resources.title, resources.qualityScore, resources.updatedAt, videoDetails.channelTitle, videoDetails.youtubeId, videoDetails.durationMs)
    .orderBy(desc(overlapCount), desc(overlapScore), desc(resources.qualityScore), desc(resources.updatedAt))
    .limit(relatedLimit);

  const reasonConcept = anchorConcepts[0]?.name ?? "this lesson";
  return rows.map((row) => {
    const thumbnails = thumbnailUrls(row.youtubeId);
    return {
      resourceId: row.resourceId,
      title: row.title,
      channelTitle: row.channelTitle,
    youtubeId: row.youtubeId,
    thumbnailUrl: thumbnails?.primary ?? null,
    thumbnailFallbackUrl: thumbnails?.fallback ?? null,
    durationMs: row.durationMs,
    reason: `Related to ${reasonConcept}`,
    };
  });
}

export async function getLearnHome(userId: string): Promise<LearnHomeData> {
  return withUserTransaction(userId, async (tx) => {
    const [active, paused, recentAnchor] = await Promise.all([
      loadContinueCandidates(tx, userId, "active"),
      loadContinueCandidates(tx, userId, "paused"),
      loadRecentAnchor(tx, userId),
    ]);
    const continueCandidates = active.length > 0 ? active : paused;
    const continueWatching = continueCandidates[0] ?? null;
    const relatedResource = continueWatching ?? recentAnchor;
    const relatedVideos = relatedResource ? await loadRelatedVideos(tx, userId, relatedResource.resourceId) : [];
    return {
      continueWatching,
      relatedAnchor: relatedResource ? { resourceId: relatedResource.resourceId, title: relatedResource.title } : null,
      relatedVideos,
    };
  });
}

import { withUserTransaction, type Transaction } from "@learnspace/db";
import { concepts, libraryItems, paperDetails, resourceConcepts, resources, studySessions, userResourceProgress, users, videoDetails } from "@learnspace/db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { youtubeThumbnailSources } from "./thumbnail";

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
  sessions: HomeSession[];
  sessionCounts: HomeSessionCounts;
  activity: { today: string; days: HomeActivityDay[] };
  continueWatching: HomeContinueItem | null;
  relatedAnchor: { resourceId: string; title: string } | null;
  relatedVideos: HomeVideoItem[];
};

export type HomeSession = {
  id: string;
  resourceId: string;
  title: string;
  type: "video" | "paper";
  description: string | null;
  source: string;
  youtubeId: string | null;
  progressPct: number;
  completed: boolean;
  lastActiveAt: string;
};

export type HomeSessionCounts = { total: number; completed: number; videos: number; videosCompleted: number; papers: number; papersCompleted: number };

async function loadHomeSessions(tx: Transaction, userId: string): Promise<Pick<LearnHomeData, "sessions" | "sessionCounts">> {
  const completed = sql`(${studySessions.status} = 'completed' OR coalesce(${userResourceProgress.progressPct}, 0) >= 100 OR ${userResourceProgress.status} = 'completed')`;
  const rows = await tx.select({
    id: studySessions.id, resource: resources, video: videoDetails, paper: paperDetails,
    progressPct: userResourceProgress.progressPct, completed: sql<boolean>`coalesce(${completed}, false)`, lastActiveAt: studySessions.lastActiveAt,
    total: sql<number>`count(*) OVER ()`, completedCount: sql<number>`count(*) FILTER (WHERE ${completed}) OVER ()`,
    videos: sql<number>`count(*) FILTER (WHERE ${resources.type} = 'video') OVER ()`,
    videosCompleted: sql<number>`count(*) FILTER (WHERE ${resources.type} = 'video' AND ${completed}) OVER ()`,
    papers: sql<number>`count(*) FILTER (WHERE ${resources.type} IN ('paper', 'pdf')) OVER ()`,
    papersCompleted: sql<number>`count(*) FILTER (WHERE ${resources.type} IN ('paper', 'pdf') AND ${completed}) OVER ()`,
  }).from(studySessions)
    .innerJoin(resources, eq(resources.id, studySessions.activeResourceId))
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .leftJoin(userResourceProgress, and(eq(userResourceProgress.userId, userId), eq(userResourceProgress.resourceId, resources.id)))
    .where(and(eq(studySessions.userId, userId), inArray(studySessions.status, ["active", "paused", "completed"]),
      inArray(resources.type, ["video", "paper", "pdf"]), isNull(resources.deletedAt),
      inArray(resources.status, ["pending", "processing", "ready"]), visibleResource(userId)))
    .orderBy(desc(studySessions.lastActiveAt)).limit(50);
  const first = rows[0];
  return {
    sessionCounts: { total: Number(first?.total ?? 0), completed: Number(first?.completedCount ?? 0), videos: Number(first?.videos ?? 0), videosCompleted: Number(first?.videosCompleted ?? 0), papers: Number(first?.papers ?? 0), papersCompleted: Number(first?.papersCompleted ?? 0) },
    sessions: rows.map((row) => ({
      id: row.id, resourceId: row.resource.id, title: row.resource.title, type: row.resource.type === "video" ? "video" : "paper",
      description: row.paper?.abstract ?? row.resource.description,
      source: row.resource.type === "video" ? row.video?.channelTitle ?? "Video lesson" : row.paper?.venue ?? (row.paper?.arxivId ? `arXiv · ${row.paper.arxivId}` : "Research paper"),
      youtubeId: row.video?.youtubeId ?? null, progressPct: row.completed ? 100 : Math.max(0, Math.min(100, Number(row.progressPct ?? 0))),
      completed: row.completed, lastActiveAt: row.lastActiveAt.toISOString(),
    })),
  };
}

export type HomeActivityDay = {
  day: string;
  focusSeconds: number;
  practiceSeconds: number;
  researchSeconds: number;
  videoSeconds: number;
  paperSeconds: number;
  otherSeconds: number;
  resources: number;
  completed: number;
};

async function loadActivity(tx: Transaction, userId: string): Promise<LearnHomeData["activity"]> {
  const [user] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  let timezone = user?.timezone ?? "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { timezone = "UTC"; }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Read measured intervals directly: the daily projections have no writer yet.
  const days = await tx.execute<HomeActivityDay>(sql`
    WITH measured AS (
      SELECT to_char(f.started_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        f.duration_sec AS seconds, f.mode, r.type
      FROM study.focus_sessions f
      LEFT JOIN catalog.resources r ON r.id = f.resource_id
      WHERE f.user_id = ${userId} AND f.ended_at <= now() AND f.duration_sec > 0 AND f.started_at <= now()
    ), daily AS (
      SELECT day,
        sum(CASE WHEN mode NOT IN ('practice', 'research') THEN seconds ELSE 0 END) AS focus_seconds,
        sum(CASE WHEN mode = 'practice' THEN seconds ELSE 0 END) AS practice_seconds,
        sum(CASE WHEN mode = 'research' THEN seconds ELSE 0 END) AS research_seconds,
        sum(CASE WHEN mode <> 'practice' AND type = 'video' THEN seconds ELSE 0 END) AS video_seconds,
        sum(CASE WHEN mode <> 'practice' AND type IN ('paper', 'pdf') THEN seconds ELSE 0 END) AS paper_seconds,
        sum(CASE WHEN mode <> 'practice' AND (type IS NULL OR type NOT IN ('video', 'paper', 'pdf')) THEN seconds ELSE 0 END) AS other_seconds,
        0 AS resources, 0 AS completed
      FROM measured GROUP BY day
      UNION ALL
      SELECT to_char(first_started_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD'), 0, 0, 0, 0, 0, 0, count(*), 0
      FROM study.user_resource_progress
      WHERE user_id = ${userId} AND first_started_at <= now() GROUP BY 1
      UNION ALL
      SELECT to_char(completed_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD'), 0, 0, 0, 0, 0, 0, 0, count(*)
      FROM study.user_resource_progress
      WHERE user_id = ${userId} AND completed_at <= now() GROUP BY 1
    )
    SELECT day, sum(focus_seconds)::float8 AS "focusSeconds",
      sum(practice_seconds)::float8 AS "practiceSeconds", sum(research_seconds)::float8 AS "researchSeconds",
      sum(video_seconds)::float8 AS "videoSeconds", sum(paper_seconds)::float8 AS "paperSeconds",
      sum(other_seconds)::float8 AS "otherSeconds", sum(resources)::float8 AS resources, sum(completed)::float8 AS completed
    FROM daily GROUP BY day ORDER BY day
  `);
  return { today, days: [...days] };
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
    const thumbnails = youtubeThumbnailSources(row.video.youtubeId);
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
    const thumbnails = youtubeThumbnailSources(row.youtubeId);
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
    const [active, paused, recentAnchor, activity, sessionData] = await Promise.all([
      loadContinueCandidates(tx, userId, "active"),
      loadContinueCandidates(tx, userId, "paused"),
      loadRecentAnchor(tx, userId),
      loadActivity(tx, userId),
      loadHomeSessions(tx, userId),
    ]);
    const continueCandidates = active.length > 0 ? active : paused;
    const continueWatching = continueCandidates[0] ?? null;
    const relatedResource = continueWatching ?? recentAnchor;
    const relatedVideos = relatedResource ? await loadRelatedVideos(tx, userId, relatedResource.resourceId) : [];
    return {
      ...sessionData,
      activity,
      continueWatching,
      relatedAnchor: relatedResource ? { resourceId: relatedResource.resourceId, title: relatedResource.title } : null,
      relatedVideos,
    };
  });
}

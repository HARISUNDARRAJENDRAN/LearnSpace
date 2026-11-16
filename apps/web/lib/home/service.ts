import { withUserTransaction, type Transaction } from "@learnspace/db";
import { concepts, libraryItems, paperDetails, resourceConcepts, resources, userResourceProgress, users, videoDetails } from "@learnspace/db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { type Activity, type ActivityDay, progression, type Progression } from "../plan/levels";
import { listPlanSuggestions, type PlanItem } from "../plan/service";
import { youtubeThumbnailSources } from "./thumbnail";

const relatedLimit = 4;
// The resource picker in the plan dialog offers these recent lessons.
const recentLimit = 12;
const providerNames: Record<string, string> = { youtube: "YouTube", arxiv: "arXiv" };

export type HomeVideoItem = {
  resourceId: string;
  title: string;
  channelTitle: string | null;
  youtubeId: string;
  thumbnailUrl: string | null;
  thumbnailFallbackUrl: string | null;
  durationMs: number | null;
  reason: string;
};

export type HomeLesson = {
  resourceId: string;
  title: string;
  type: string;
  source: string | null;
  youtubeId: string | null;
  durationMs: number | null;
  progressPct: number;
  status: string;
  spentSeconds: number;
  lastSessionSeconds: number;
  startedDay: string | null;
  openedDay: string;
};

export type LearnHomeData = {
  today: string;
  progression: Progression;
  recentLessons: HomeLesson[];
  nextActions: PlanItem[];
};

export async function loadTimezone(tx: Transaction, userId: string): Promise<string> {
  const [user] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const timezone = user?.timezone ?? "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { return "UTC"; }
  return timezone;
}

// XP per calendar day and source, read from measured study so it always matches the evidence.
// Raw amounts per day and activity; lib/plan/levels turns them into XP so the points live in one place.
export async function loadActivityDays(tx: Transaction, userId: string, timezone: string): Promise<ActivityDay[]> {
  const day = (column: ReturnType<typeof sql>) => sql`to_char(${column} AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`;
  const rows = await tx.execute<{ day: string; activity: Activity; amount: number }>(sql`
    SELECT ${day(sql`focus.started_at`)} AS day, CASE WHEN resource.type IN ('paper', 'pdf', 'webpage', 'note') THEN 'read' ELSE 'watch' END AS activity,
      floor(sum(focus.duration_sec) / 60.0)::float8 AS amount
    FROM study.focus_sessions AS focus
    LEFT JOIN catalog.resources AS resource ON resource.id = focus.resource_id
    WHERE focus.user_id = ${userId} AND focus.ended_at <= now() AND focus.duration_sec > 0
    GROUP BY 1, 2
    UNION ALL
    SELECT ${day(sql`progress.completed_at`)}, CASE WHEN resource.type = 'video' THEN 'finish_video' ELSE 'finish_paper' END, count(*)::float8
    FROM study.user_resource_progress AS progress
    JOIN catalog.resources AS resource ON resource.id = progress.resource_id
    WHERE progress.user_id = ${userId} AND progress.completed_at <= now()
    GROUP BY 1, 2
    UNION ALL
    SELECT ${day(sql`occurred_at`)}, 'question', count(*)::float8
    FROM activity.activity_events
    WHERE user_id = ${userId} AND event_type = 'question.asked' AND occurred_at <= now()
    GROUP BY 1
    UNION ALL
    -- Plan items earn their points in proportion to how much of them was completed.
    SELECT ${day(sql`starts_at`)}, 'plan_' || kind, (sum(progress_pct) / 100.0)::float8
    FROM study.schedule_items
    WHERE user_id = ${userId} AND status IN ('planned', 'done') AND progress_pct > 0 AND starts_at <= now()
    GROUP BY 1, 2
    UNION ALL
    -- On time: a timed item planned in advance whose matching study (at least 5 min) began within 10 min of its start.
    SELECT ${day(sql`item.starts_at`)}, 'on_time', count(*)::float8
    FROM study.schedule_items AS item
    WHERE item.user_id = ${userId} AND item.status IN ('planned', 'done') AND item.progress_pct > 0 AND NOT item.all_day
      AND item.created_at <= item.starts_at AND item.starts_at <= now()
      AND EXISTS (
        SELECT 1 FROM study.focus_sessions AS focus
        WHERE focus.user_id = item.user_id AND focus.duration_sec >= 300 AND focus.ended_at <= now()
          AND focus.started_at BETWEEN item.starts_at - interval '10 minutes' AND item.starts_at + interval '10 minutes'
          AND (item.resource_id IS NULL OR focus.resource_id = item.resource_id)
      )
    GROUP BY 1
    UNION ALL
    -- In slot: the share of a planned slot covered by matching study, capped by how much of the item the observer credited.
    SELECT ${day(sql`slot.starts_at`)}, 'in_slot', sum(slot.share)::float8
    FROM (
      SELECT item.starts_at, least(1.0, item.progress_pct / 100.0, coalesce(sum(greatest(0, extract(epoch FROM least(focus.ended_at, item.ends_at) - greatest(focus.started_at, item.starts_at)))), 0)
        / greatest(60, extract(epoch FROM item.ends_at - item.starts_at))) AS share
      FROM study.schedule_items AS item
      LEFT JOIN study.focus_sessions AS focus ON focus.user_id = item.user_id AND focus.ended_at <= now()
        AND focus.started_at < item.ends_at AND focus.ended_at > item.starts_at
        AND (item.resource_id IS NULL OR focus.resource_id = item.resource_id)
      WHERE item.user_id = ${userId} AND item.status IN ('planned', 'done') AND item.progress_pct > 0 AND NOT item.all_day
        AND item.ends_at IS NOT NULL AND item.created_at <= item.starts_at AND item.ends_at <= now()
      GROUP BY item.id
    ) AS slot
    WHERE slot.share > 0
    GROUP BY 1
    UNION ALL
    -- A day's whole plan: every item that day completed. Dismissed items do not count against it.
    SELECT plan_day.day, 'day_plan', 1
    FROM (
      SELECT ${day(sql`starts_at`)} AS day, bool_and(status = 'done') AS all_done
      FROM study.schedule_items
      WHERE user_id = ${userId} AND status IN ('planned', 'done') AND starts_at <= now()
      GROUP BY 1
    ) AS plan_day
    WHERE plan_day.all_done
  `);
  return [...rows].map((row) => ({ day: row.day, activity: row.activity, amount: Number(row.amount) }));
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

async function loadRecentLessons(tx: Transaction, userId: string, timezone: string): Promise<HomeLesson[]> {
  const rows = await tx
    .select({
      resourceId: resources.id,
      title: resources.title,
      type: resources.type,
      provider: resources.provider,
      channelTitle: videoDetails.channelTitle,
      youtubeId: videoDetails.youtubeId,
      venue: paperDetails.venue,
      durationMs: videoDetails.durationMs,
      progressPct: userResourceProgress.progressPct,
      status: userResourceProgress.status,
      startedDay: sql<string | null>`to_char(${userResourceProgress.firstStartedAt} AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`,
      openedDay: sql<string>`to_char(${userResourceProgress.lastOpenedAt} AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`,
      spentSeconds: sql<number>`(
        SELECT coalesce(sum(f.duration_sec), 0)::float8 FROM study.focus_sessions f
        WHERE f.user_id = ${userId} AND f.resource_id = ${resources.id} AND f.ended_at <= now()
      )`,
      lastSessionSeconds: sql<number>`(
        SELECT coalesce(sum(f.duration_sec), 0)::float8 FROM study.focus_sessions f
        WHERE f.user_id = ${userId} AND f.resource_id = ${resources.id} AND f.study_session_id = ${userResourceProgress.lastSessionId} AND f.ended_at <= now()
      )`,
    })
    .from(userResourceProgress)
    .innerJoin(resources, eq(resources.id, userResourceProgress.resourceId))
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .where(and(
      eq(userResourceProgress.userId, userId),
      isNotNull(userResourceProgress.lastOpenedAt),
      isNull(resources.deletedAt),
      visibleResource(userId),
    ))
    .orderBy(desc(userResourceProgress.lastOpenedAt))
    .limit(recentLimit);
  return rows.map((row) => ({
    resourceId: row.resourceId,
    title: row.title,
    type: row.type,
    source: row.channelTitle ?? row.venue ?? providerNames[row.provider] ?? row.provider,
    youtubeId: row.youtubeId,
    durationMs: row.durationMs,
    progressPct: Number(row.progressPct ?? 0),
    status: row.status,
    spentSeconds: Number(row.spentSeconds),
    lastSessionSeconds: Number(row.lastSessionSeconds),
    startedDay: row.startedDay,
    openedDay: row.openedDay,
  }));
}

export async function loadRelatedVideos(tx: Transaction, userId: string, anchorResourceId: string): Promise<HomeVideoItem[]> {
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

export function localToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function getLearnHome(userId: string): Promise<LearnHomeData> {
  return withUserTransaction(userId, async (tx) => {
    const timezone = await loadTimezone(tx, userId);
    const today = localToday(timezone);
    const [xpDays, recentLessons, nextActions] = await Promise.all([
      loadActivityDays(tx, userId, timezone),
      loadRecentLessons(tx, userId, timezone),
      listPlanSuggestions(tx, userId),
    ]);
    return { today, progression: progression(xpDays, today), recentLessons, nextActions };
  });
}

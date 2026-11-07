import type postgres from "postgres";
import { scoreYoutubeQuality } from "@learnspace/shared/youtube-quality";
import { configuredNumber } from "./config.js";

type SqlClient = ReturnType<typeof postgres>;

export type YoutubeVideoMetrics = {
  youtubeId: string;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  // Free with the same call; richer text for semantic matching.
  description: string | null;
  tags: string[];
  language: string | null;
  durationMs: number | null;
  captionStatus: string | null;
  embeddable: boolean | null;
  liveBroadcastContent: string | null;
  privacyStatus: string | null;
  ageRestricted: boolean;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
};

export type YoutubeChannelMetrics = {
  channelId: string;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
};

export type YoutubeGate = "unavailable" | "age_restricted" | "not_embeddable" | "live" | "short";

export type YoutubeMetricsResult = {
  videos: number;
  channels: number;
  gated: number;
  quotaUnits: number;
  quotaCapped: boolean;
  error: string | null;
};

const apiBase = "https://www.googleapis.com/youtube/v3";
const maxIdsPerCall = 50;
const videoFields = "items(id,snippet(publishedAt,channelId,channelTitle,description,tags,defaultAudioLanguage,liveBroadcastContent),contentDetails(duration,caption,contentRating(ytRating)),statistics(viewCount,likeCount,commentCount),status(privacyStatus,uploadStatus,embeddable))";
const channelFields = "items(id,statistics(viewCount,subscriberCount,hiddenSubscriberCount,videoCount))";
// YouTube API policy: stored statistics must be refreshed or deleted within 30 days.
const statisticsRetentionDays = 30;

/** Parses an ISO 8601 duration such as PT1H2M3S or P1DT2H into milliseconds. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || value === "P" || value.endsWith("T")) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Math.round(((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000);
}

export function youtubeGate(video: Pick<YoutubeVideoMetrics, "durationMs" | "embeddable" | "liveBroadcastContent" | "privacyStatus" | "ageRestricted">, minimumDurationMs: number): YoutubeGate | null {
  if (video.privacyStatus !== "public" && video.privacyStatus !== "unlisted") return "unavailable";
  if (video.ageRestricted) return "age_restricted";
  if (video.embeddable !== true) return "not_embeddable";
  if (video.liveBroadcastContent === "live" || video.liveBroadcastContent === "upcoming") return "live";
  if (video.durationMs !== null && video.durationMs <= minimumDurationMs) return "short";
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number | null {
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseVideoItem(value: unknown): YoutubeVideoMetrics | null {
  const item = record(value);
  const youtubeId = text(item.id);
  if (!youtubeId) return null;
  const snippet = record(item.snippet), details = record(item.contentDetails), statistics = record(item.statistics), status = record(item.status);
  const uploadStatus = text(status.uploadStatus);
  return {
    youtubeId,
    channelId: text(snippet.channelId),
    channelTitle: text(snippet.channelTitle),
    publishedAt: text(snippet.publishedAt),
    description: text(snippet.description)?.slice(0, 5000) ?? null,
    tags: Array.isArray(snippet.tags) ? snippet.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 15) : [],
    language: text(snippet.defaultAudioLanguage),
    durationMs: parseIsoDuration(details.duration),
    captionStatus: text(details.caption),
    embeddable: typeof status.embeddable === "boolean" ? status.embeddable : null,
    liveBroadcastContent: text(snippet.liveBroadcastContent),
    // A deleted, rejected or failed upload is unplayable whatever its privacy says.
    privacyStatus: uploadStatus && uploadStatus !== "processed" && uploadStatus !== "uploaded" ? "unavailable" : text(status.privacyStatus),
    ageRestricted: record(details.contentRating).ytRating === "ytAgeRestricted",
    viewCount: count(statistics.viewCount),
    // Hidden like counts are absent: store null, never 0.
    likeCount: count(statistics.likeCount),
    commentCount: count(statistics.commentCount),
  };
}

export function parseChannelItem(value: unknown): YoutubeChannelMetrics | null {
  const item = record(value);
  const channelId = text(item.id);
  if (!channelId) return null;
  const statistics = record(item.statistics);
  return {
    channelId,
    subscriberCount: statistics.hiddenSubscriberCount === true ? null : count(statistics.subscriberCount),
    viewCount: count(statistics.viewCount),
    videoCount: count(statistics.videoCount),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/** Atomically spends quota units for today (YouTube resets at midnight Pacific); false once the cap is reached. */
async function reserveQuota(sql: SqlClient, units: number): Promise<boolean> {
  const cap = configuredNumber("YOUTUBE_DAILY_QUOTA_CAP", 9000, 1, 1_000_000);
  const rows = await sql`
    INSERT INTO ops.api_usage_daily (provider, usage_date, units)
    VALUES ('youtube', (now() AT TIME ZONE 'America/Los_Angeles')::date, ${units})
    ON CONFLICT (provider, usage_date) DO UPDATE SET units = ops.api_usage_daily.units + EXCLUDED.units
      WHERE ops.api_usage_daily.units + EXCLUDED.units <= ${cap}
    RETURNING units
  `;
  return rows.length > 0;
}

async function youtubeItems(resource: "videos" | "channels", ids: string[], key: string): Promise<unknown[]> {
  const url = new URL(`${apiBase}/${resource}`);
  url.searchParams.set("part", resource === "videos" ? "snippet,contentDetails,statistics,status" : "statistics");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("maxResults", String(maxIdsPerCall));
  url.searchParams.set("fields", resource === "videos" ? videoFields : channelFields);
  url.searchParams.set("key", key);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  // The URL carries the key, so errors name only the resource and status.
  if (!response.ok) throw new Error(`YouTube ${resource}.list returned ${response.status}`);
  const body = record(await response.json());
  return Array.isArray(body.items) ? body.items : [];
}

/**
 * Fetches YouTube metadata and statistics for videos whose metrics are missing
 * or older than YOUTUBE_METRICS_MAX_AGE_DAYS, gates unusable videos, and
 * rescores them. Scoped to resourceIds when given, else the stalest videos.
 */
export async function refreshYoutubeMetrics(sql: SqlClient, resourceIds: string[] | null = null): Promise<YoutubeMetricsResult> {
  const result: YoutubeMetricsResult = { videos: 0, channels: 0, gated: 0, quotaUnits: 0, quotaCapped: false, error: null };
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || resourceIds?.length === 0) return result;
  const maxAgeDays = configuredNumber("YOUTUBE_METRICS_MAX_AGE_DAYS", 7, 1, statisticsRetentionDays - 1);
  const batchSize = configuredNumber("YOUTUBE_METRICS_BATCH_SIZE", 200, 1, 5000);
  const minimumDurationMs = configuredNumber("YOUTUBE_MIN_DURATION_SECONDS", 60, 0, 3600) * 1000;
  const due = await sql<{ resource_id: string; youtube_id: string }[]>`
    SELECT vd.resource_id, vd.youtube_id
    FROM catalog.video_details vd
    JOIN catalog.resources r ON r.id = vd.resource_id
    WHERE r.deleted_at IS NULL
      ${resourceIds ? sql`AND vd.resource_id = ANY(${resourceIds}::uuid[])` : sql``}
      AND (vd.metrics_captured_at IS NULL OR vd.metrics_captured_at < now() - make_interval(days => ${maxAgeDays}))
    ORDER BY vd.metrics_captured_at NULLS FIRST, vd.resource_id
    LIMIT ${batchSize}
  `;
  if (due.length === 0) return result;

  const fetched = new Map<string, YoutubeVideoMetrics>();
  const requested = new Set<string>();
  try {
    for (const ids of chunks([...new Set(due.map((row) => row.youtube_id))], maxIdsPerCall)) {
      if (!await reserveQuota(sql, 1)) { result.quotaCapped = true; break; }
      result.quotaUnits += 1;
      for (const item of await youtubeItems("videos", ids, key)) {
        const video = parseVideoItem(item);
        if (video) fetched.set(video.youtubeId, video);
      }
      for (const id of ids) requested.add(id);
    }
    const channelIds = [...new Set([...fetched.values()].flatMap((video) => video.channelId ? [video.channelId] : []))];
    const fresh = channelIds.length ? await sql<{ channel_id: string }[]>`
      SELECT channel_id FROM catalog.youtube_channels
      WHERE channel_id = ANY(${channelIds}) AND metrics_captured_at >= now() - make_interval(days => ${maxAgeDays})
    ` : [];
    const freshIds = new Set(fresh.map((row) => row.channel_id));
    const channels: YoutubeChannelMetrics[] = [];
    for (const ids of chunks(channelIds.filter((id) => !freshIds.has(id)), maxIdsPerCall)) {
      if (!await reserveQuota(sql, 1)) { result.quotaCapped = true; break; }
      result.quotaUnits += 1;
      for (const item of await youtubeItems("channels", ids, key)) {
        const channel = parseChannelItem(item);
        if (channel) channels.push(channel);
      }
    }
    if (channels.length) await sql`
      INSERT INTO catalog.youtube_channels (channel_id, subscriber_count, view_count, video_count, metrics_captured_at)
      SELECT channel_id, subscriber_count, view_count, video_count, now()
      FROM jsonb_to_recordset(${sql.json(channels.map((channel) => ({ channel_id: channel.channelId, subscriber_count: channel.subscriberCount, view_count: channel.viewCount, video_count: channel.videoCount })))}::jsonb)
        AS input(channel_id text, subscriber_count bigint, view_count bigint, video_count bigint)
      ON CONFLICT (channel_id) DO UPDATE SET subscriber_count = EXCLUDED.subscriber_count, view_count = EXCLUDED.view_count,
        video_count = EXCLUDED.video_count, metrics_captured_at = EXCLUDED.metrics_captured_at
    `;
    result.channels = channels.length;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "YouTube request failed";
  }

  // Requested ids that YouTube did not return are deleted or private.
  const rows = due.filter((row) => requested.has(row.youtube_id)).map((row) => {
    const video = fetched.get(row.youtube_id);
    const gate = video ? youtubeGate(video, minimumDurationMs) : "unavailable";
    if (gate) result.gated += 1;
    return {
      resource_id: row.resource_id,
      gate,
      channel_id: video?.channelId ?? null,
      channel_title: video?.channelTitle ?? null,
      published_at: video?.publishedAt ?? null,
      description: video?.description ?? null,
      tags: video?.tags ?? [],
      language: video?.language ?? null,
      duration_ms: video?.durationMs ?? null,
      caption_status: video?.captionStatus ?? null,
      embeddable: video?.embeddable ?? null,
      live_broadcast_content: video?.liveBroadcastContent ?? null,
      privacy_status: video?.privacyStatus ?? "unavailable",
      age_restricted: video?.ageRestricted ?? null,
      view_count: video?.viewCount ?? null,
      like_count: video?.likeCount ?? null,
      comment_count: video?.commentCount ?? null,
    };
  });
  if (rows.length) {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE catalog.video_details vd SET
          channel_id = COALESCE(input.channel_id, vd.channel_id),
          channel_title = COALESCE(input.channel_title, vd.channel_title),
          published_at = COALESCE(input.published_at, vd.published_at),
          default_audio_language = COALESCE(input.language, vd.default_audio_language),
          duration_ms = COALESCE(input.duration_ms, vd.duration_ms),
          caption_status = input.caption_status,
          embeddable = input.embeddable,
          live_broadcast_content = input.live_broadcast_content,
          privacy_status = input.privacy_status,
          age_restricted = input.age_restricted,
          latest_view_count = input.view_count,
          latest_like_count = input.like_count,
          latest_comment_count = input.comment_count,
          metrics_captured_at = now(),
          fetched_at = now()
        FROM jsonb_to_recordset(${tx.json(rows)}::jsonb) AS input(
          resource_id uuid, channel_id text, channel_title text, published_at timestamptz, language text, duration_ms integer,
          caption_status text, embeddable boolean, live_broadcast_content text, privacy_status text, age_restricted boolean,
          view_count bigint, like_count bigint, comment_count bigint)
        WHERE vd.resource_id = input.resource_id
      `;
      // Gated videos leave every status = 'ready' surface; a later clean refresh restores them.
      await tx`
        UPDATE catalog.resources r SET
          status = CASE
            WHEN input.gate IS NOT NULL THEN 'archived'::catalog.resource_status
            WHEN r.status = 'archived' AND r.metadata ? 'youtubeGate' THEN 'ready'::catalog.resource_status
            ELSE r.status END,
          -- YouTube's own description beats a short search snippet.
          description = CASE WHEN length(input.description) > length(COALESCE(r.description, '')) THEN input.description ELSE r.description END,
          metadata = (CASE WHEN input.gate IS NOT NULL THEN r.metadata || jsonb_build_object('youtubeGate', input.gate) ELSE r.metadata - 'youtubeGate' END)
            || CASE WHEN jsonb_array_length(input.tags) > 0 THEN jsonb_build_object('youtubeTags', input.tags) ELSE '{}'::jsonb END
        FROM jsonb_to_recordset(${tx.json(rows.map(({ resource_id, gate, description, tags }) => ({ resource_id, gate, description, tags })))}::jsonb)
          AS input(resource_id uuid, gate text, description text, tags jsonb)
        WHERE r.id = input.resource_id
      `;
    });
    await recomputeYoutubeQuality(sql, rows.map((row) => row.resource_id));
  }
  result.videos = rows.length;
  console.info(JSON.stringify({ metric: "youtube_metrics_refresh", ...result }));
  return result;
}

/** Recomputes quality_score from stored metadata and metrics, for resourceIds or every video. */
export async function recomputeYoutubeQuality(sql: SqlClient, resourceIds: string[] | null = null): Promise<number> {
  type Row = {
    id: string; title: string; description: string | null; channel_title: string | null; duration_ms: number | null; published_at: Date | null;
    latest_view_count: string | null; latest_like_count: string | null; latest_comment_count: string | null; metrics_captured_at: Date | null;
    subscriber_count: string | null; channel_view_count: string | null; video_count: string | null;
  };
  const number = (value: string | null) => value === null ? null : Number(value);
  const now = new Date();
  let changed = 0;
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = await sql<Row[]>`
      SELECT r.id, r.title, r.description, vd.channel_title, vd.duration_ms, vd.published_at,
        vd.latest_view_count, vd.latest_like_count, vd.latest_comment_count, vd.metrics_captured_at,
        c.subscriber_count, c.view_count AS channel_view_count, c.video_count
      FROM catalog.resources r
      JOIN catalog.video_details vd ON vd.resource_id = r.id
      LEFT JOIN catalog.youtube_channels c ON c.channel_id = vd.channel_id
      WHERE r.type = 'video' AND r.deleted_at IS NULL AND r.id > ${after}
        ${resourceIds ? sql`AND r.id = ANY(${resourceIds}::uuid[])` : sql``}
      ORDER BY r.id
      LIMIT 1000
    `;
    if (rows.length === 0) return changed;
    after = rows.at(-1)!.id;
    const scores = rows.map((row) => ({
      id: row.id,
      score: scoreYoutubeQuality({
        title: row.title, description: row.description, channelTitle: row.channel_title, durationMs: row.duration_ms, publishedAt: row.published_at,
        viewCount: number(row.latest_view_count), likeCount: number(row.latest_like_count), commentCount: number(row.latest_comment_count),
        metricsCapturedAt: row.metrics_captured_at, channelSubscriberCount: number(row.subscriber_count),
        channelViewCount: number(row.channel_view_count), channelVideoCount: number(row.video_count),
      }, now).finalQualityScore,
    }));
    const updated = await sql`
      UPDATE catalog.resources r SET quality_score = input.score
      FROM jsonb_to_recordset(${sql.json(scores)}::jsonb) AS input(id uuid, score real)
      WHERE r.id = input.id AND r.quality_score IS DISTINCT FROM input.score
    `;
    changed += updated.count;
  }
}

/** Deletes YouTube statistics older than the 30-day API policy limit and rescores affected videos. */
export async function purgeExpiredYoutubeStatistics(sql: SqlClient): Promise<number> {
  const purged = await sql<{ resource_id: string }[]>`
    UPDATE catalog.video_details
    SET latest_view_count = NULL, latest_like_count = NULL, latest_comment_count = NULL, metrics_captured_at = NULL
    WHERE metrics_captured_at < now() - make_interval(days => ${statisticsRetentionDays})
    RETURNING resource_id
  `;
  await sql`DELETE FROM catalog.youtube_channels WHERE metrics_captured_at < now() - make_interval(days => ${statisticsRetentionDays})`;
  await sql`DELETE FROM catalog.video_metric_snapshots WHERE captured_at < now() - make_interval(days => ${statisticsRetentionDays})`;
  if (purged.length) await recomputeYoutubeQuality(sql, purged.map((row) => row.resource_id));
  return purged.length;
}

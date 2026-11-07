import { bigint, boolean, index, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { resources } from "./resources.js";

export const videoDetails = catalogSchema.table("video_details", {
  resourceId: uuid("resource_id").primaryKey().references(() => resources.id, { onDelete: "restrict" }),
  youtubeId: text("youtube_id").notNull().unique(),
  channelId: text("channel_id"),
  channelTitle: text("channel_title"),
  durationMs: integer("duration_ms"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  defaultAudioLanguage: text("default_audio_language"),
  captionStatus: text("caption_status"),
  embeddable: boolean("embeddable"),
  liveBroadcastContent: text("live_broadcast_content"),
  privacyStatus: text("privacy_status"),
  ageRestricted: boolean("age_restricted"),
  latestViewCount: bigint("latest_view_count", { mode: "number" }),
  latestLikeCount: bigint("latest_like_count", { mode: "number" }),
  latestCommentCount: bigint("latest_comment_count", { mode: "number" }),
  metricsCapturedAt: timestamp("metrics_captured_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
});

export const youtubeChannels = catalogSchema.table("youtube_channels", {
  channelId: text("channel_id").primaryKey(),
  subscriberCount: bigint("subscriber_count", { mode: "number" }),
  viewCount: bigint("view_count", { mode: "number" }),
  videoCount: bigint("video_count", { mode: "number" }),
  metricsCapturedAt: timestamp("metrics_captured_at", { withTimezone: true }).notNull(),
});

export const videoMetricSnapshots = catalogSchema.table(
  "video_metric_snapshots",
  {
    resourceId: uuid("resource_id").notNull().references(() => videoDetails.resourceId, { onDelete: "restrict" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    viewCount: bigint("view_count", { mode: "number" }),
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.capturedAt] }),
    index("video_metric_snapshots_resource_time_idx").on(table.resourceId, table.capturedAt.desc()),
  ],
);

CREATE TABLE "catalog"."youtube_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"subscriber_count" bigint,
	"view_count" bigint,
	"video_count" bigint,
	"metrics_captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."api_usage_daily" (
	"provider" text NOT NULL,
	"usage_date" date NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_daily_provider_usage_date_pk" PRIMARY KEY("provider","usage_date")
);
--> statement-breakpoint
ALTER TABLE "catalog"."video_details" ADD COLUMN "embeddable" boolean;--> statement-breakpoint
ALTER TABLE "catalog"."video_details" ADD COLUMN "live_broadcast_content" text;--> statement-breakpoint
ALTER TABLE "catalog"."video_details" ADD COLUMN "privacy_status" text;--> statement-breakpoint
ALTER TABLE "catalog"."video_details" ADD COLUMN "age_restricted" boolean;--> statement-breakpoint
ALTER TABLE catalog.youtube_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY youtube_channels_worker_select ON catalog.youtube_channels FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY youtube_channels_worker_insert ON catalog.youtube_channels FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY youtube_channels_worker_update ON catalog.youtube_channels FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY youtube_channels_worker_delete ON catalog.youtube_channels FOR DELETE TO learnspace_worker USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.youtube_channels TO learnspace_worker;
--> statement-breakpoint
ALTER TABLE ops.api_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_usage_daily_worker_select ON ops.api_usage_daily FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY api_usage_daily_worker_insert ON ops.api_usage_daily FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY api_usage_daily_worker_update ON ops.api_usage_daily FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON ops.api_usage_daily TO learnspace_worker;
--> statement-breakpoint
-- YouTube API policy: stored statistics older than 30 days are refreshed or deleted.
CREATE POLICY video_metric_snapshots_worker_delete ON catalog.video_metric_snapshots FOR DELETE TO learnspace_worker USING (true);
GRANT DELETE ON catalog.video_metric_snapshots TO learnspace_worker;

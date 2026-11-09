CREATE TABLE "catalog"."transcript_submissions" (
	"resource_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"language" text NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"segments" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_submissions_resource_id_user_id_pk" PRIMARY KEY("resource_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ops"."transcript_requests" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"youtube_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"caption_url" text,
	"language" text,
	"expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_requests_status_chk" CHECK ("ops"."transcript_requests"."status" IN ('queued', 'signed', 'ready', 'unavailable', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "catalog"."transcript_submissions" ADD CONSTRAINT "transcript_submissions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."transcript_submissions" ADD CONSTRAINT "transcript_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."transcript_requests" ADD CONSTRAINT "transcript_requests_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_requests_status_requested_idx" ON "ops"."transcript_requests" USING btree ("status","requested_at");--> statement-breakpoint
-- Each learner reads and writes only their own caption download; the worker publishes matching copies and clears them.
ALTER TABLE catalog.transcript_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transcript_submissions_owner_select ON catalog.transcript_submissions FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY transcript_submissions_owner_insert ON catalog.transcript_submissions FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY transcript_submissions_owner_update ON catalog.transcript_submissions FOR UPDATE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY transcript_submissions_worker_select ON catalog.transcript_submissions FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY transcript_submissions_worker_delete ON catalog.transcript_submissions FOR DELETE TO learnspace_worker USING (true);
GRANT SELECT, INSERT, UPDATE ON catalog.transcript_submissions TO learnspace_app;
GRANT SELECT, DELETE ON catalog.transcript_submissions TO learnspace_worker;
--> statement-breakpoint
-- The app may only queue a video or requeue an expiring signature; signing and publishing belong to the worker role.
ALTER TABLE ops.transcript_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY transcript_requests_app_select ON ops.transcript_requests FOR SELECT TO learnspace_app USING (true);
CREATE POLICY transcript_requests_app_insert ON ops.transcript_requests FOR INSERT TO learnspace_app WITH CHECK (status = 'queued' AND caption_url IS NULL);
CREATE POLICY transcript_requests_app_requeue ON ops.transcript_requests FOR UPDATE TO learnspace_app USING (status = 'signed' AND expires_at < now() + interval '10 minutes') WITH CHECK (status = 'queued' AND caption_url IS NULL);
CREATE POLICY transcript_requests_worker_select ON ops.transcript_requests FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY transcript_requests_worker_update ON ops.transcript_requests FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON ops.transcript_requests TO learnspace_app;
GRANT SELECT, UPDATE ON ops.transcript_requests TO learnspace_worker;

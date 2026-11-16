CREATE TABLE "study"."video_notes" (
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guide_status" text,
	"guide_started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_notes_user_id_resource_id_pk" PRIMARY KEY("user_id","resource_id"),
	CONSTRAINT "video_notes_guide_status_check" CHECK ("study"."video_notes"."guide_status" in ('writing', 'ready', 'failed'))
);
--> statement-breakpoint
-- Notes move from the session to its video: each learner's newest page for a video is kept.
INSERT INTO "study"."video_notes" ("user_id", "resource_id", "revision", "blocks", "history", "updated_at")
SELECT DISTINCT ON (n."user_id", s."active_resource_id") n."user_id", s."active_resource_id", n."revision", n."blocks", n."history", n."updated_at"
FROM "study"."session_notes" n JOIN "study"."study_sessions" s ON s."id" = n."study_session_id"
WHERE s."active_resource_id" IS NOT NULL
ORDER BY n."user_id", s."active_resource_id", n."updated_at" DESC;--> statement-breakpoint
ALTER TABLE "study"."session_notes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "study"."session_notes" CASCADE;--> statement-breakpoint
DROP INDEX "study"."session_transcript_session_idx";--> statement-breakpoint
ALTER TABLE "study"."session_transcript" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
UPDATE "study"."session_transcript" t SET "resource_id" = s."active_resource_id" FROM "study"."study_sessions" s WHERE s."id" = t."study_session_id";--> statement-breakpoint
DELETE FROM "study"."session_transcript" WHERE "resource_id" IS NULL;--> statement-breakpoint
ALTER TABLE "study"."session_transcript" ALTER COLUMN "resource_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "study"."video_notes" ADD CONSTRAINT "video_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."video_notes" ADD CONSTRAINT "video_notes_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_transcript" ADD CONSTRAINT "session_transcript_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_transcript_session_idx" ON "study"."session_transcript" USING btree ("study_session_id","resource_id","seq");;--> statement-breakpoint
-- A learner reads and writes only their own notes; nobody deletes them.
ALTER TABLE study.video_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY video_notes_owner_policy ON study.video_notes
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY video_notes_owner_insert_policy ON study.video_notes
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY video_notes_owner_update_policy ON study.video_notes
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON TABLE study.video_notes TO learnspace_app;

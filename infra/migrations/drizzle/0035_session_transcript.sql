CREATE TABLE "study"."session_transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "study"."session_transcript_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"study_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"position_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_transcript_speaker_check" CHECK ("study"."session_transcript"."speaker" in ('you', 'luna'))
);
--> statement-breakpoint
ALTER TABLE "study"."session_transcript" ADD CONSTRAINT "session_transcript_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_transcript" ADD CONSTRAINT "session_transcript_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_transcript" ADD CONSTRAINT "session_transcript_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_transcript_session_idx" ON "study"."session_transcript" USING btree ("study_session_id","seq");--> statement-breakpoint
ALTER TABLE "study"."session_notes" DROP COLUMN "turns";--> statement-breakpoint
-- A learner reads and appends their own transcript; nobody rewrites or deletes it.
ALTER TABLE study.session_transcript ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_transcript_owner_policy ON study.session_transcript
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_transcript_owner_insert_policy ON study.session_transcript
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT ON TABLE study.session_transcript TO learnspace_app;

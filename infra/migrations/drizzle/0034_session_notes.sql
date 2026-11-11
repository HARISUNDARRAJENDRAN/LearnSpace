CREATE TABLE "study"."session_notes" (
	"study_session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study"."session_notes" ADD CONSTRAINT "session_notes_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_notes" ADD CONSTRAINT "session_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_notes" ADD CONSTRAINT "session_notes_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- A learner reads and writes only their own notes; nobody deletes them.
ALTER TABLE study.session_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_notes_owner_policy ON study.session_notes
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_notes_owner_insert_policy ON study.session_notes
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_notes_owner_update_policy ON study.session_notes
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON TABLE study.session_notes TO learnspace_app;

CREATE TABLE "study"."mastery_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mastery_checks_status_chk" CHECK ("study"."mastery_checks"."status" IN ('open', 'passed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "study"."mastery_checks" ADD CONSTRAINT "mastery_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."mastery_checks" ADD CONSTRAINT "mastery_checks_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."mastery_checks" ADD CONSTRAINT "mastery_checks_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."mastery_checks" ADD CONSTRAINT "mastery_checks_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."mastery_checks" ADD CONSTRAINT "mastery_checks_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mastery_checks_user_resource_idx" ON "study"."mastery_checks" USING btree ("user_id","resource_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mastery_checks_open_uq" ON "study"."mastery_checks" USING btree ("user_id","resource_id") WHERE "study"."mastery_checks"."status" = 'open';--> statement-breakpoint
-- A learner reads, starts and answers only their own checks; nobody deletes one.
ALTER TABLE study.mastery_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY mastery_checks_owner_policy ON study.mastery_checks
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY mastery_checks_owner_insert_policy ON study.mastery_checks
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY mastery_checks_owner_update_policy ON study.mastery_checks
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON TABLE study.mastery_checks TO learnspace_app;

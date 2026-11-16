CREATE TABLE "practice"."coding_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parent_attempt_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"phase" text DEFAULT 'correct' NOT NULL,
	"language" text NOT NULL,
	"drafts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correct_solved" boolean DEFAULT false NOT NULL,
	"efficient_solved" boolean DEFAULT false NOT NULL,
	"hint_level" integer DEFAULT 0 NOT NULL,
	"revealed" boolean DEFAULT false NOT NULL,
	"failed_submissions" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"tracker" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"focus" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credit" numeric(5, 4),
	"outcome" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coding_attempts_role_chk" CHECK ("practice"."coding_attempts"."role" IN ('primary', 'transfer', 'reinforcement')),
	CONSTRAINT "coding_attempts_phase_chk" CHECK ("practice"."coding_attempts"."phase" IN ('correct', 'efficient')),
	CONSTRAINT "coding_attempts_hint_level_chk" CHECK ("practice"."coding_attempts"."hint_level" BETWEEN 0 AND 4),
	CONSTRAINT "coding_attempts_outcome_chk" CHECK ("practice"."coding_attempts"."outcome" IS NULL OR "practice"."coding_attempts"."outcome" IN ('advance', 'transfer', 'reinforce', 'review_later')),
	CONSTRAINT "coding_attempts_credit_chk" CHECK ("practice"."coding_attempts"."credit" IS NULL OR "practice"."coding_attempts"."credit" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "practice"."coding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"level" integer,
	"text" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coding_events_kind_chk" CHECK ("practice"."coding_events"."kind" IN ('hint', 'offer', 'offer_declined', 'learner', 'tutor', 'reveal', 'focus', 'transition'))
);
--> statement-breakpoint
CREATE TABLE "practice"."coding_mastery" (
	"user_id" uuid NOT NULL,
	"concept" text NOT NULL,
	"score" real NOT NULL,
	"independent_solves" integer DEFAULT 0 NOT NULL,
	"assisted_solves" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"last_practiced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_review_at" timestamp with time zone,
	CONSTRAINT "coding_mastery_user_id_concept_pk" PRIMARY KEY("user_id","concept"),
	CONSTRAINT "coding_mastery_score_chk" CHECK ("practice"."coding_mastery"."score" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "practice"."coding_problem_secrets" (
	"problem_id" uuid PRIMARY KEY NOT NULL,
	"authored" jsonb NOT NULL,
	"tests" jsonb,
	"perf_limit_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice"."coding_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid,
	"concept" text NOT NULL,
	"difficulty" text NOT NULL,
	"parent_problem_id" uuid,
	"status" text NOT NULL,
	"title" text,
	"spec" jsonb,
	"tutor" jsonb,
	"verification" jsonb,
	"failure" text,
	"created_by" uuid,
	"model" text,
	"contract_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "coding_problems_status_chk" CHECK ("practice"."coding_problems"."status" IN ('generating', 'verifying', 'verified', 'rejected')),
	CONSTRAINT "coding_problems_difficulty_chk" CHECK ("practice"."coding_problems"."difficulty" IN ('easy', 'medium', 'hard')),
	CONSTRAINT "coding_problems_verified_chk" CHECK ("practice"."coding_problems"."status" <> 'verified' OR ("practice"."coding_problems"."spec" IS NOT NULL AND "practice"."coding_problems"."tutor" IS NOT NULL AND "practice"."coding_problems"."verified_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "practice"."coding_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"language" text NOT NULL,
	"code" text NOT NULL,
	"verdict" text NOT NULL,
	"passed" integer NOT NULL,
	"total" integer NOT NULL,
	"runtime_ms" integer,
	"memory_kb" integer,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice"."video_coding_profiles" (
	"resource_version_id" uuid PRIMARY KEY NOT NULL,
	"resource_id" uuid NOT NULL,
	"status" text NOT NULL,
	"category" text,
	"practice_fit" real,
	"recommended" boolean DEFAULT false NOT NULL,
	"language" text,
	"difficulty" text,
	"concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"contract_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_coding_profiles_status_chk" CHECK ("practice"."video_coding_profiles"."status" IN ('classifying', 'ready', 'failed'))
);
--> statement-breakpoint
DROP TABLE "practice"."code_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."exercise_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."execution_runs" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."observer_diagnostics" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."test_bundles" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."exercise_bindings" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."exercise_examples" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."exercise_versions" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."exercises" CASCADE;--> statement-breakpoint
DROP TABLE "practice"."hint_events" CASCADE;--> statement-breakpoint
ALTER TABLE "practice"."coding_attempts" ADD CONSTRAINT "coding_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_attempts" ADD CONSTRAINT "coding_attempts_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_attempts" ADD CONSTRAINT "coding_attempts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_attempts" ADD CONSTRAINT "coding_attempts_problem_id_coding_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "practice"."coding_problems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_attempts" ADD CONSTRAINT "coding_attempts_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_attempts" ADD CONSTRAINT "coding_attempts_parent_fkey" FOREIGN KEY ("parent_attempt_id") REFERENCES "practice"."coding_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_events" ADD CONSTRAINT "coding_events_attempt_id_coding_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."coding_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_events" ADD CONSTRAINT "coding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_mastery" ADD CONSTRAINT "coding_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_problem_secrets" ADD CONSTRAINT "coding_problem_secrets_problem_id_coding_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "practice"."coding_problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_problems" ADD CONSTRAINT "coding_problems_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_problems" ADD CONSTRAINT "coding_problems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_problems" ADD CONSTRAINT "coding_problems_parent_fkey" FOREIGN KEY ("parent_problem_id") REFERENCES "practice"."coding_problems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_submissions" ADD CONSTRAINT "coding_submissions_attempt_id_coding_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."coding_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."coding_submissions" ADD CONSTRAINT "coding_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."video_coding_profiles" ADD CONSTRAINT "video_coding_profiles_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."video_coding_profiles" ADD CONSTRAINT "video_coding_profiles_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coding_attempts_open_uq" ON "practice"."coding_attempts" USING btree ("user_id","resource_id") WHERE "practice"."coding_attempts"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "coding_attempts_user_resource_idx" ON "practice"."coding_attempts" USING btree ("user_id","resource_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coding_events_attempt_idx" ON "practice"."coding_events" USING btree ("attempt_id","created_at");--> statement-breakpoint
CREATE INDEX "coding_problems_bank_idx" ON "practice"."coding_problems" USING btree ("resource_id","concept","difficulty","status");--> statement-breakpoint
CREATE INDEX "coding_problems_parent_idx" ON "practice"."coding_problems" USING btree ("parent_problem_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "coding_problems_generating_uq" ON "practice"."coding_problems" USING btree (coalesce("resource_id", '00000000-0000-0000-0000-000000000000'::uuid),"concept","difficulty",coalesce("parent_problem_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "practice"."coding_problems"."status" IN ('generating', 'verifying');--> statement-breakpoint
CREATE INDEX "coding_submissions_attempt_idx" ON "practice"."coding_submissions" USING btree ("attempt_id","created_at");--> statement-breakpoint
CREATE INDEX "video_coding_profiles_resource_idx" ON "practice"."video_coding_profiles" USING btree ("resource_id");--> statement-breakpoint
DROP TYPE "practice"."attempt_status";--> statement-breakpoint
DROP TYPE "practice"."execution_status";--> statement-breakpoint
DROP TYPE "practice"."exercise_kind";--> statement-breakpoint
-- The first coding-practice design (object-storage test bundles and a database execution queue) never ran; its functions go with its tables.
DROP FUNCTION IF EXISTS practice.enqueue_execution(uuid, uuid, uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS practice.validate_attempt_binding_context();--> statement-breakpoint
DROP FUNCTION IF EXISTS practice.validate_execution_run_hashes();--> statement-breakpoint
DROP FUNCTION IF EXISTS practice.validate_model_invocation_attempt();--> statement-breakpoint
-- A video's coding profile is shared catalogue knowledge: any learner's request may classify it.
ALTER TABLE practice.video_coding_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY video_coding_profiles_app_select ON practice.video_coding_profiles FOR SELECT TO learnspace_app USING (true);
CREATE POLICY video_coding_profiles_app_insert ON practice.video_coding_profiles FOR INSERT TO learnspace_app WITH CHECK (true);
CREATE POLICY video_coding_profiles_app_update ON practice.video_coding_profiles FOR UPDATE TO learnspace_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE practice.video_coding_profiles TO learnspace_app;
--> statement-breakpoint
-- Problems are a shared bank. The app writes a problem and hands it to the runner (verifying), or rejects it; only the runner
-- can mark one verified, and nobody changes a verified problem.
ALTER TABLE practice.coding_problems ENABLE ROW LEVEL SECURITY;
CREATE POLICY coding_problems_app_select ON practice.coding_problems FOR SELECT TO learnspace_app USING (true);
CREATE POLICY coding_problems_app_insert ON practice.coding_problems FOR INSERT TO learnspace_app WITH CHECK (status = 'generating');
CREATE POLICY coding_problems_app_update ON practice.coding_problems FOR UPDATE TO learnspace_app
  USING (status IN ('generating', 'verifying'))
  WITH CHECK (status IN ('generating', 'verifying', 'rejected'));
CREATE POLICY coding_problems_runner_select ON practice.coding_problems FOR SELECT TO learnspace_runner USING (true);
CREATE POLICY coding_problems_runner_update ON practice.coding_problems FOR UPDATE TO learnspace_runner
  USING (status = 'verifying')
  WITH CHECK (status IN ('verified', 'rejected'));
GRANT SELECT, INSERT, UPDATE ON TABLE practice.coding_problems TO learnspace_app;
GRANT SELECT ON TABLE practice.coding_problems TO learnspace_runner;
GRANT UPDATE (status, verification, failure, verified_at) ON TABLE practice.coding_problems TO learnspace_runner;
--> statement-breakpoint
-- Tests, generators and reference code: the app writes them once, while authoring, and can never read them back; the runner
-- reads them to grade and completes them while verifying.
ALTER TABLE practice.coding_problem_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY coding_problem_secrets_app_insert ON practice.coding_problem_secrets FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM practice.coding_problems problem WHERE problem.id = problem_id AND problem.status = 'generating'));
CREATE POLICY coding_problem_secrets_runner_select ON practice.coding_problem_secrets FOR SELECT TO learnspace_runner USING (true);
CREATE POLICY coding_problem_secrets_runner_update ON practice.coding_problem_secrets FOR UPDATE TO learnspace_runner
  USING (EXISTS (SELECT 1 FROM practice.coding_problems problem WHERE problem.id = problem_id AND problem.status = 'verifying'))
  WITH CHECK (true);
GRANT INSERT ON TABLE practice.coding_problem_secrets TO learnspace_app;
GRANT SELECT ON TABLE practice.coding_problem_secrets TO learnspace_runner;
GRANT UPDATE (tests, perf_limit_ms) ON TABLE practice.coding_problem_secrets TO learnspace_runner;
--> statement-breakpoint
-- A learner's attempts, submissions, tutoring record and concept mastery are theirs alone; nothing is deleted.
ALTER TABLE practice.coding_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY coding_attempts_owner_select ON practice.coding_attempts FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY coding_attempts_owner_insert ON practice.coding_attempts FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY coding_attempts_owner_update ON practice.coding_attempts FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON TABLE practice.coding_attempts TO learnspace_app;
ALTER TABLE practice.coding_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY coding_submissions_owner_select ON practice.coding_submissions FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY coding_submissions_owner_insert ON practice.coding_submissions FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT ON TABLE practice.coding_submissions TO learnspace_app;
ALTER TABLE practice.coding_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY coding_events_owner_select ON practice.coding_events FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY coding_events_owner_insert ON practice.coding_events FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT ON TABLE practice.coding_events TO learnspace_app;
ALTER TABLE practice.coding_mastery ENABLE ROW LEVEL SECURITY;
CREATE POLICY coding_mastery_owner_select ON practice.coding_mastery FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY coding_mastery_owner_insert ON practice.coding_mastery FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY coding_mastery_owner_update ON practice.coding_mastery FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON TABLE practice.coding_mastery TO learnspace_app;

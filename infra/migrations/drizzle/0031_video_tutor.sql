CREATE TABLE "retrieval"."answer_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"contract_version" text NOT NULL,
	"scope_key" text NOT NULL,
	"question_sha256" char(64) NOT NULL,
	"question_embedding" vector(1536),
	"answer" jsonb NOT NULL,
	"chunk_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD COLUMN "resource_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD COLUMN "first_output_ms" integer;--> statement-breakpoint
ALTER TABLE "retrieval"."answer_cache" ADD CONSTRAINT "answer_cache_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_cache_question_uq" ON "retrieval"."answer_cache" USING btree ("resource_version_id","contract_version","scope_key","question_sha256");--> statement-breakpoint
CREATE INDEX "answer_cache_scope_idx" ON "retrieval"."answer_cache" USING btree ("resource_version_id","contract_version","scope_key");--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_messages_thread_idempotency_uq" ON "study"."tutor_messages" USING btree ("thread_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_threads_active_resource_uq" ON "study"."tutor_threads" USING btree ("study_session_id","resource_id") WHERE "study"."tutor_threads"."status" = 'active';--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD CONSTRAINT "tutor_messages_status_chk" CHECK ("study"."tutor_messages"."status" IN ('pending', 'completed', 'failed', 'cancelled'));--> statement-breakpoint
-- The web app runs the tutor, so it records the tutor's runs and model calls as the learner, like the AI role.
GRANT SELECT, INSERT, UPDATE ON TABLE agent.agent_runs, agent.model_invocations TO learnspace_app;
ALTER POLICY agent_runs_owner_policy ON agent.agent_runs TO learnspace_ai, learnspace_app;
ALTER POLICY agent_runs_owner_insert_policy ON agent.agent_runs TO learnspace_ai, learnspace_app;
ALTER POLICY agent_runs_owner_update_policy ON agent.agent_runs TO learnspace_ai, learnspace_app;
ALTER POLICY model_invocations_owner_policy ON agent.model_invocations TO learnspace_ai, learnspace_app;
ALTER POLICY model_invocations_owner_insert_policy ON agent.model_invocations TO learnspace_ai, learnspace_app;
ALTER POLICY model_invocations_owner_update_policy ON agent.model_invocations TO learnspace_ai, learnspace_app;
--> statement-breakpoint
-- The global tutor spend counter is shared by every web instance.
CREATE POLICY api_usage_daily_app_select ON ops.api_usage_daily FOR SELECT TO learnspace_app USING (provider LIKE 'tutor:%');
CREATE POLICY api_usage_daily_app_insert ON ops.api_usage_daily FOR INSERT TO learnspace_app WITH CHECK (provider LIKE 'tutor:%');
CREATE POLICY api_usage_daily_app_update ON ops.api_usage_daily FOR UPDATE TO learnspace_app USING (provider LIKE 'tutor:%') WITH CHECK (provider LIKE 'tutor:%');
GRANT SELECT, INSERT, UPDATE ON ops.api_usage_daily TO learnspace_app;
--> statement-breakpoint
-- Cached answers are shared across learners, so only transcripts of public videos are cached, and nobody edits an entry.
ALTER TABLE retrieval.answer_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY answer_cache_public_select ON retrieval.answer_cache FOR SELECT TO learnspace_app
  USING (EXISTS (SELECT 1 FROM catalog.resource_versions AS rv JOIN catalog.resources AS r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND r.owner_user_id IS NULL AND r.visibility IN ('public', 'unlisted')));
CREATE POLICY answer_cache_public_insert ON retrieval.answer_cache FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.resource_versions AS rv JOIN catalog.resources AS r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND r.owner_user_id IS NULL AND r.visibility IN ('public', 'unlisted')));
-- The worker prunes entries of replaced transcripts; a DELETE that filters rows needs to read them too.
CREATE POLICY answer_cache_worker_select ON retrieval.answer_cache FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY answer_cache_worker_delete ON retrieval.answer_cache FOR DELETE TO learnspace_worker USING (true);
GRANT SELECT, INSERT ON retrieval.answer_cache TO learnspace_app;
GRANT SELECT, DELETE ON retrieval.answer_cache TO learnspace_worker;
--> statement-breakpoint
INSERT INTO retrieval.embedding_profiles (id, provider, model_name, dimensions, distance_metric, normalization, status, activated_at)
VALUES ('openai-text-embedding-3-small-1536', 'openai', 'text-embedding-3-small', 1536, 'cosine', 'unit', 'active', now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE "agent"."model_invocations" DROP CONSTRAINT IF EXISTS "model_invocations_agent_step_id_agent_steps_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" DROP CONSTRAINT IF EXISTS "model_invocations_run_step_fkey";--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" DROP COLUMN IF EXISTS "agent_step_id";--> statement-breakpoint
ALTER TABLE "catalog"."resource_assets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "study"."session_context_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_concepts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."user_knowledge_edges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."agent_steps" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."audit_log" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."backfill_checkpoints" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."dead_letter_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projection"."dashboard_state" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projection"."session_summary" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projection"."user_learning_daily" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "catalog"."resource_assets";--> statement-breakpoint
DROP TABLE "study"."session_context_snapshots";--> statement-breakpoint
DROP TABLE "retrieval"."chunk_concepts";--> statement-breakpoint
DROP TABLE "retrieval"."ingestion_runs";--> statement-breakpoint
DROP TABLE "knowledge"."artifact_concepts";--> statement-breakpoint
DROP TABLE "knowledge"."user_knowledge_edges";--> statement-breakpoint
DROP TABLE "knowledge"."mastery_signals";--> statement-breakpoint
DROP FUNCTION IF EXISTS "knowledge"."validate_mastery_signal_source"();--> statement-breakpoint
DROP TABLE "knowledge"."review_schedules";--> statement-breakpoint
DROP TABLE "knowledge"."unresolved_questions";--> statement-breakpoint
DROP TABLE "agent"."agent_artifacts";--> statement-breakpoint
DROP TABLE "agent"."tool_invocations";--> statement-breakpoint
DROP TABLE "agent"."agent_steps";--> statement-breakpoint
DROP TYPE "agent"."step_status";--> statement-breakpoint
DROP TABLE "ops"."audit_log";--> statement-breakpoint
DROP TABLE "ops"."backfill_checkpoints";--> statement-breakpoint
DROP TABLE "ops"."dead_letter_events";--> statement-breakpoint
DROP TABLE "projection"."dashboard_state";--> statement-breakpoint
DROP TABLE "projection"."session_summary";--> statement-breakpoint
DROP TABLE "projection"."user_learning_daily";--> statement-breakpoint
DROP SCHEMA "projection";--> statement-breakpoint
ALTER TABLE "discovery"."resource_embeddings" DROP CONSTRAINT "resource_embeddings_nonzero_chk";--> statement-breakpoint
DROP INDEX "catalog"."resources_search_tsv_idx";--> statement-breakpoint
DROP INDEX "retrieval"."resource_chunks_version_content_ordinal_uq";--> statement-breakpoint
DROP INDEX "retrieval"."chunk_embeddings_cosine_hnsw_idx";--> statement-breakpoint
DROP INDEX "discovery"."resource_embeddings_cosine_hnsw_idx";--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(1536) USING "embedding"::halfvec(1536);--> statement-breakpoint
ALTER TABLE "retrieval"."answer_cache" ALTER COLUMN "question_embedding" SET DATA TYPE halfvec(1536) USING "question_embedding"::halfvec(1536);--> statement-breakpoint
ALTER TABLE "discovery"."resource_embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(1536) USING "embedding"::halfvec(1536);--> statement-breakpoint
ALTER TABLE "discovery"."resource_embeddings" ADD CONSTRAINT "resource_embeddings_nonzero_chk" CHECK ("discovery"."resource_embeddings"."embedding" IS NULL OR l2_norm("discovery"."resource_embeddings"."embedding") > 0);--> statement-breakpoint
CREATE INDEX "resources_public_ready_updated_idx" ON "catalog"."resources" USING btree ("type","updated_at","id") WHERE "catalog"."resources"."owner_user_id" IS NULL AND "catalog"."resources"."status" = 'ready' AND "catalog"."resources"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_resource_progress_user_updated_idx" ON "study"."user_resource_progress" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_resource_progress_user_opened_idx" ON "study"."user_resource_progress" USING btree ("user_id","last_opened_at" DESC NULLS LAST) WHERE "study"."user_resource_progress"."last_opened_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "study_sessions_user_active_desc_idx" ON "study"."study_sessions" USING btree ("user_id","last_active_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recommendation_runs_reuse_idx" ON "discovery"."recommendation_runs" USING btree ("user_id","surface","strategy_version","feature_version","created_at" DESC NULLS LAST) WHERE "discovery"."recommendation_runs"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "jobs_discovery_finished_idx" ON "ops"."jobs" USING btree ("queue","job_type","finished_at" DESC NULLS LAST) WHERE "ops"."jobs"."status" IN ('done', 'dead') AND "ops"."jobs"."finished_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_type_idx" ON "ops"."outbox_events" USING btree ("event_type","available_at","created_at") WHERE "ops"."outbox_events"."status" = 'pending';

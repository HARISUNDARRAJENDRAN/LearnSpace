DROP INDEX "knowledge"."artifact_concepts_identity_pk";--> statement-breakpoint
DROP INDEX "knowledge"."concept_aliases_identity_pk";--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" ADD CONSTRAINT "artifact_concepts_legacy_pk" PRIMARY KEY("artifact_resource_id","concept_id","relation_type","source");--> statement-breakpoint
ALTER TABLE "knowledge"."concept_aliases" ADD CONSTRAINT "concept_aliases_concept_id_normalized_alias_locale_pk" PRIMARY KEY("concept_id","normalized_alias","locale");
--> statement-breakpoint
ALTER TABLE identity.auth_sessions
  ADD CONSTRAINT auth_sessions_rotated_from_fkey
  FOREIGN KEY (rotated_from_id)
  REFERENCES identity.auth_sessions(id)
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE knowledge.concepts
  ADD CONSTRAINT concepts_canonical_parent_fkey
  FOREIGN KEY (canonical_parent_id)
  REFERENCES knowledge.concepts(id)
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE retrieval.resource_chunks
  ADD CONSTRAINT resource_chunks_parent_fkey
  FOREIGN KEY (parent_chunk_id)
  REFERENCES retrieval.resource_chunks(id)
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE practice.code_snapshots
  ADD CONSTRAINT code_snapshots_parent_fkey
  FOREIGN KEY (parent_snapshot_id)
  REFERENCES practice.code_snapshots(id)
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE study.tutor_messages
  ADD CONSTRAINT tutor_messages_source_message_fkey
  FOREIGN KEY (source_message_id)
  REFERENCES study.tutor_messages(id)
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE catalog.resources
  ADD CONSTRAINT resources_current_version_fkey
  FOREIGN KEY (id, current_version_id)
  REFERENCES catalog.resource_versions(resource_id, id)
  DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE activity.activity_events
  ADD CONSTRAINT activity_events_resource_version_owner_fkey
  FOREIGN KEY (resource_id, resource_version_id)
  REFERENCES catalog.resource_versions(resource_id, id)
  ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE retrieval.ingestion_runs
  ADD CONSTRAINT ingestion_runs_resource_version_owner_fkey
  FOREIGN KEY (resource_id, resource_version_id)
  REFERENCES catalog.resource_versions(resource_id, id)
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE practice.exercise_bindings
  ADD CONSTRAINT exercise_bindings_resource_version_owner_fkey
  FOREIGN KEY (resource_id, resource_version_id)
  REFERENCES catalog.resource_versions(resource_id, id)
  ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX activity_events_occurred_brin_idx
  ON activity.activity_events USING brin (occurred_at)
  WITH (pages_per_range = 128);
--> statement-breakpoint
CREATE TABLE retrieval.authorized_chunk_metadata (
  id uuid PRIMARY KEY,
  resource_version_id uuid NOT NULL,
  chunk_type text NOT NULL,
  heading_path text[] NOT NULL,
  token_count integer NOT NULL,
  anchor jsonb NOT NULL
);
--> statement-breakpoint
DROP TABLE retrieval.authorized_chunk_metadata;
--> statement-breakpoint
CREATE VIEW retrieval.authorized_chunk_metadata
WITH (security_barrier = true)
AS
SELECT c.id,
       c.resource_version_id,
       c.chunk_type,
       c.heading_path,
       c.token_count,
       c.anchor
FROM retrieval.resource_chunks AS c
JOIN catalog.resource_versions AS rv ON rv.id = c.resource_version_id
JOIN catalog.resources AS r ON r.id = rv.resource_id
WHERE r.visibility IN ('public', 'unlisted')
   OR r.owner_user_id::text = current_setting('app.user_id', true);
--> statement-breakpoint
CREATE VIEW practice.learner_exercise_versions
WITH (security_barrier = true)
AS
SELECT ev.id,
       ev.exercise_id,
       ev.version_no,
       ev.language,
       ev.runtime_family,
       ev.difficulty,
       ev.prompt_md,
       ev.starter_code,
       ev.function_signature,
       ev.constraints,
       ev.content_sha256,
       ev.generator_model,
       ev.generator_version,
       ev.validation_status,
       ev.created_at
FROM practice.exercise_versions AS ev
JOIN practice.exercises AS e ON e.id = ev.exercise_id
WHERE e.owner_user_id IS NULL
   OR e.owner_user_id::text = current_setting('app.user_id', true);
--> statement-breakpoint
CREATE VIEW practice.runner_execution_payload
WITH (security_barrier = true)
AS
SELECT er.id AS execution_run_id,
       er.attempt_id,
       er.code_snapshot_id,
       er.test_bundle_id,
       er.request_id,
       er.status,
       er.runner_pool,
       er.runtime_image_digest,
       er.source_sha256,
       er.test_bundle_sha256,
       er.cpu_limit_ms,
       er.wall_limit_ms,
       er.memory_limit_bytes,
       cs.source_code,
       tb.object_key AS test_bundle_object_key,
       tb.sha256 AS test_bundle_content_sha256,
       tb.runtime_image_digest AS test_bundle_runtime_image_digest,
       tb.harness_version,
       tb.resource_limits,
       tb.key_reference
FROM practice.execution_runs AS er
JOIN practice.code_snapshots AS cs ON cs.id = er.code_snapshot_id
JOIN practice.test_bundles AS tb ON tb.id = er.test_bundle_id;
--> statement-breakpoint
CREATE VIEW identity.support_user_summary
WITH (security_barrier = true)
AS
SELECT id, display_name, locale, timezone, subscription_tier, status, created_at
FROM identity.users;
--> statement-breakpoint
CREATE VIEW agent.cost_metrics_redacted
WITH (security_barrier = true)
AS
SELECT date_trunc('day', created_at)::date AS day,
       provider,
       model_name,
       count(*)::integer AS invocation_count,
       coalesce(sum(input_tokens), 0)::integer AS input_tokens,
       coalesce(sum(output_tokens), 0)::integer AS output_tokens,
       coalesce(sum(estimated_cost_usd), 0)::numeric(18,8) AS estimated_cost_usd
FROM agent.model_invocations
GROUP BY date_trunc('day', created_at)::date, provider, model_name;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection REVOKE ALL ON TABLES FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.users, identity.auth_accounts, identity.auth_sessions, identity.user_settings TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts, catalog.collections, catalog.collection_sections, catalog.collection_items, catalog.collection_enrollments, catalog.library_items TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE study.learning_goals, study.study_sessions, study.session_resources, study.session_context_snapshots, study.session_checkpoints, study.user_resource_progress, study.focus_sessions, study.schedule_items, study.tutor_threads, study.tutor_messages TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE activity.activity_events TO learnspace_app;
--> statement-breakpoint
GRANT SELECT ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles, retrieval.ingestion_runs, retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE practice.exercises, practice.exercise_bindings, practice.exercise_examples, practice.exercise_attempts, practice.code_snapshots, practice.execution_runs, practice.observer_diagnostics, practice.hint_events TO learnspace_app;
--> statement-breakpoint
GRANT SELECT ON TABLE knowledge.concepts, knowledge.concept_aliases, knowledge.concept_relations, knowledge.user_knowledge_edges, knowledge.concept_mastery, knowledge.review_schedules, knowledge.unresolved_questions, knowledge.artifact_details, knowledge.artifact_sources, knowledge.artifact_concepts TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE knowledge.artifact_details, knowledge.artifact_sources, knowledge.artifact_concepts TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE discovery.recommendation_runs, discovery.recommendation_candidates, discovery.recommendation_impressions, discovery.discovery_interactions, discovery.user_concept_affinity, discovery.resource_quality_snapshots TO learnspace_app;
--> statement-breakpoint
GRANT SELECT ON TABLE projection.dashboard_state, projection.user_learning_daily, projection.session_summary TO learnspace_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE ops.idempotency_records, ops.outbox_events TO learnspace_app;
--> statement-breakpoint
GRANT SELECT ON practice.learner_exercise_versions TO learnspace_app;
--> statement-breakpoint
GRANT SELECT ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT ON TABLE study.study_sessions, study.session_resources, study.session_context_snapshots, study.session_checkpoints, study.tutor_threads, study.tutor_messages TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles, retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT ON TABLE knowledge.concepts, knowledge.concept_aliases, knowledge.concept_relations, knowledge.concept_mastery, knowledge.review_schedules TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT ON TABLE practice.exercise_attempts, practice.code_snapshots, practice.execution_runs, practice.observer_diagnostics, practice.hint_events TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE agent.agent_runs, agent.agent_steps, agent.tool_invocations, agent.model_invocations, agent.agent_artifacts TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT ON practice.learner_exercise_versions TO learnspace_ai;
--> statement-breakpoint
GRANT SELECT ON TABLE identity.users, catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts, study.study_sessions, study.session_resources, study.session_context_snapshots, study.session_checkpoints, activity.activity_events TO learnspace_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE retrieval.ingestion_runs, retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles, retrieval.chunk_concepts, retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations, knowledge.user_knowledge_edges, knowledge.mastery_signals, knowledge.concept_mastery, knowledge.review_schedules, discovery.user_concept_affinity, discovery.resource_quality_snapshots, projection.dashboard_state, projection.user_learning_daily, projection.session_summary, ops.jobs, ops.outbox_events, ops.dead_letter_events, ops.backfill_checkpoints TO learnspace_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts TO learnspace_worker;
--> statement-breakpoint
GRANT SELECT ON TABLE practice.test_bundles, practice.exercise_attempts, practice.code_snapshots TO learnspace_runner;
--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE practice.execution_runs TO learnspace_runner;
--> statement-breakpoint
GRANT SELECT ON practice.runner_execution_payload TO learnspace_runner;
--> statement-breakpoint
GRANT SELECT ON identity.support_user_summary, retrieval.authorized_chunk_metadata, agent.cost_metrics_redacted TO learnspace_readonly;
--> statement-breakpoint
ALTER TABLE identity.user_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_settings_owner_policy ON identity.user_settings
  FOR ALL TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE catalog.resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY resources_owner_or_visible_policy ON catalog.resources
  FOR ALL TO learnspace_app, learnspace_ai
  USING (owner_user_id::text = current_setting('app.user_id', true) OR visibility IN ('public', 'unlisted'))
  WITH CHECK (owner_user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY resources_worker_policy ON catalog.resources
  FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE catalog.resource_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY resource_versions_visible_policy ON catalog.resource_versions
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
--> statement-breakpoint
CREATE POLICY resource_versions_worker_policy ON catalog.resource_versions
  FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE catalog.resource_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY resource_assets_visible_policy ON catalog.resource_assets
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resource_versions rv JOIN catalog.resources r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
--> statement-breakpoint
CREATE POLICY resource_assets_worker_policy ON catalog.resource_assets
  FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE catalog.library_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_items_owner_policy ON catalog.library_items
  FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE catalog.collections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY collections_owner_or_visible_policy ON catalog.collections
  FOR ALL TO learnspace_app USING (owner_user_id::text = current_setting('app.user_id', true) OR visibility IN ('public', 'unlisted')) WITH CHECK (owner_user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE catalog.collection_enrollments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY collection_enrollments_owner_policy ON catalog.collection_enrollments
  FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.learning_goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY learning_goals_owner_policy ON study.learning_goals FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.study_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY study_sessions_owner_policy ON study.study_sessions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.session_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY session_resources_owner_policy ON study.session_resources FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE study.session_context_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY session_snapshots_owner_policy ON study.session_context_snapshots FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE study.session_checkpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY session_checkpoints_owner_policy ON study.session_checkpoints FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE study.user_resource_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_resource_progress_owner_policy ON study.user_resource_progress FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.focus_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY focus_sessions_owner_policy ON study.focus_sessions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.schedule_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_items_owner_policy ON study.schedule_items FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.tutor_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tutor_threads_owner_policy ON study.tutor_threads FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE study.tutor_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tutor_messages_owner_policy ON study.tutor_messages FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM study.tutor_threads t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.tutor_threads t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE activity.activity_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY activity_events_owner_policy ON activity.activity_events FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY activity_events_worker_policy ON activity.activity_events FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE retrieval.resource_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY resource_chunks_visible_policy ON retrieval.resource_chunks FOR SELECT TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resource_versions rv JOIN catalog.resources r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
--> statement-breakpoint
CREATE POLICY resource_chunks_worker_policy ON retrieval.resource_chunks FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE retrieval.chunk_embeddings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chunk_embeddings_visible_policy ON retrieval.chunk_embeddings FOR SELECT TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM retrieval.resource_chunks c JOIN catalog.resource_versions rv ON rv.id = c.resource_version_id JOIN catalog.resources r ON r.id = rv.resource_id WHERE c.id = chunk_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
--> statement-breakpoint
CREATE POLICY chunk_embeddings_worker_policy ON retrieval.chunk_embeddings FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE retrieval.retrieval_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retrieval_runs_owner_policy ON retrieval.retrieval_runs FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY retrieval_runs_worker_policy ON retrieval.retrieval_runs FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE practice.exercise_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY exercise_attempts_owner_policy ON practice.exercise_attempts FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE practice.code_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY code_snapshots_owner_policy ON practice.code_snapshots FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE practice.observer_diagnostics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY observer_diagnostics_owner_policy ON practice.observer_diagnostics FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE practice.hint_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY hint_events_owner_policy ON practice.hint_events FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE knowledge.user_knowledge_edges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_knowledge_edges_owner_policy ON knowledge.user_knowledge_edges FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE knowledge.mastery_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mastery_signals_owner_policy ON knowledge.mastery_signals FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY mastery_signals_worker_policy ON knowledge.mastery_signals FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE knowledge.concept_mastery ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY concept_mastery_owner_policy ON knowledge.concept_mastery FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY concept_mastery_worker_policy ON knowledge.concept_mastery FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE knowledge.review_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY review_schedules_owner_policy ON knowledge.review_schedules FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY review_schedules_worker_policy ON knowledge.review_schedules FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE knowledge.unresolved_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY unresolved_questions_owner_policy ON knowledge.unresolved_questions FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE agent.agent_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_runs_owner_policy ON agent.agent_runs FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE agent.agent_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_steps_owner_policy ON agent.agent_steps FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE agent.tool_invocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tool_invocations_owner_policy ON agent.tool_invocations FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE agent.model_invocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY model_invocations_owner_policy ON agent.model_invocations FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE agent.agent_artifacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_artifacts_owner_policy ON agent.agent_artifacts FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
--> statement-breakpoint
ALTER TABLE projection.dashboard_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dashboard_state_owner_policy ON projection.dashboard_state FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE projection.user_learning_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_learning_daily_owner_policy ON projection.user_learning_daily FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE projection.session_summary ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY session_summary_owner_policy ON projection.session_summary FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE ops.idempotency_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_records_owner_policy ON ops.idempotency_records FOR ALL TO learnspace_app USING (user_id IS NULL OR user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id IS NULL OR user_id::text = current_setting('app.user_id', true));

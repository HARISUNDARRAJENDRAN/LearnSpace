DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_rotated_from_fkey' AND conrelid = 'identity.auth_sessions'::regclass) THEN
    ALTER TABLE identity.auth_sessions ADD CONSTRAINT auth_sessions_rotated_from_fkey FOREIGN KEY (rotated_from_id) REFERENCES identity.auth_sessions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concepts_canonical_parent_fkey' AND conrelid = 'knowledge.concepts'::regclass) THEN
    ALTER TABLE knowledge.concepts ADD CONSTRAINT concepts_canonical_parent_fkey FOREIGN KEY (canonical_parent_id) REFERENCES knowledge.concepts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_chunks_parent_fkey' AND conrelid = 'retrieval.resource_chunks'::regclass) THEN
    ALTER TABLE retrieval.resource_chunks ADD CONSTRAINT resource_chunks_parent_fkey FOREIGN KEY (parent_chunk_id) REFERENCES retrieval.resource_chunks(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'code_snapshots_parent_fkey' AND conrelid = 'practice.code_snapshots'::regclass) THEN
    ALTER TABLE practice.code_snapshots ADD CONSTRAINT code_snapshots_parent_fkey FOREIGN KEY (parent_snapshot_id) REFERENCES practice.code_snapshots(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_messages_source_message_fkey' AND conrelid = 'study.tutor_messages'::regclass) THEN
    ALTER TABLE study.tutor_messages ADD CONSTRAINT tutor_messages_source_message_fkey FOREIGN KEY (source_message_id) REFERENCES study.tutor_messages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resources_current_version_fkey' AND conrelid = 'catalog.resources'::regclass) THEN
    ALTER TABLE catalog.resources ADD CONSTRAINT resources_current_version_fkey FOREIGN KEY (id, current_version_id) REFERENCES catalog.resource_versions(resource_id, id) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_events_resource_version_owner_fkey' AND conrelid = 'activity.activity_events'::regclass) THEN
    ALTER TABLE activity.activity_events ADD CONSTRAINT activity_events_resource_version_owner_fkey FOREIGN KEY (resource_id, resource_version_id) REFERENCES catalog.resource_versions(resource_id, id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_runs_resource_version_owner_fkey' AND conrelid = 'retrieval.ingestion_runs'::regclass) THEN
    ALTER TABLE retrieval.ingestion_runs ADD CONSTRAINT ingestion_runs_resource_version_owner_fkey FOREIGN KEY (resource_id, resource_version_id) REFERENCES catalog.resource_versions(resource_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_bindings_resource_version_owner_fkey' AND conrelid = 'practice.exercise_bindings'::regclass) THEN
    ALTER TABLE practice.exercise_bindings ADD CONSTRAINT exercise_bindings_resource_version_owner_fkey FOREIGN KEY (resource_id, resource_version_id) REFERENCES catalog.resource_versions(resource_id, id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS activity_events_occurred_brin_idx ON activity.activity_events USING brin (occurred_at) WITH (pages_per_range = 128);

CREATE OR REPLACE FUNCTION catalog.prevent_ready_resource_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.processing_status = 'ready' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'ready resource versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resource_versions_immutable_trg ON catalog.resource_versions;
CREATE TRIGGER resource_versions_immutable_trg
BEFORE UPDATE ON catalog.resource_versions
FOR EACH ROW
EXECUTE FUNCTION catalog.prevent_ready_resource_version_update();

CREATE OR REPLACE FUNCTION practice.validate_execution_run_hashes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM practice.code_snapshots WHERE id = NEW.code_snapshot_id AND source_sha256 = NEW.source_sha256) THEN
    RAISE EXCEPTION 'execution source hash does not match code snapshot' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM practice.test_bundles WHERE id = NEW.test_bundle_id AND sha256 = NEW.test_bundle_sha256) THEN
    RAISE EXCEPTION 'execution test bundle hash does not match test bundle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS execution_runs_hashes_trg ON practice.execution_runs;
CREATE TRIGGER execution_runs_hashes_trg
BEFORE INSERT OR UPDATE ON practice.execution_runs
FOR EACH ROW
EXECUTE FUNCTION practice.validate_execution_run_hashes();

CREATE OR REPLACE VIEW retrieval.authorized_chunk_metadata WITH (security_barrier = true) AS
SELECT c.id, c.resource_version_id, c.chunk_type, c.heading_path, c.token_count, c.anchor
FROM retrieval.resource_chunks AS c
JOIN catalog.resource_versions AS rv ON rv.id = c.resource_version_id
JOIN catalog.resources AS r ON r.id = rv.resource_id
WHERE r.visibility IN ('public', 'unlisted') OR r.owner_user_id::text = current_setting('app.user_id', true);

CREATE OR REPLACE VIEW practice.learner_exercise_versions WITH (security_barrier = true) AS
SELECT ev.id, ev.exercise_id, ev.version_no, ev.language, ev.runtime_family, ev.difficulty, ev.prompt_md, ev.starter_code, ev.function_signature, ev.constraints, ev.content_sha256, ev.generator_model, ev.generator_version, ev.validation_status, ev.created_at
FROM practice.exercise_versions AS ev
JOIN practice.exercises AS e ON e.id = ev.exercise_id
WHERE e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true);

CREATE OR REPLACE VIEW practice.runner_execution_payload WITH (security_barrier = true) AS
SELECT er.id AS execution_run_id, er.attempt_id, er.code_snapshot_id, er.test_bundle_id, er.request_id, er.status, er.runner_pool, er.runtime_image_digest, er.source_sha256, er.test_bundle_sha256, er.cpu_limit_ms, er.wall_limit_ms, er.memory_limit_bytes, cs.source_code, tb.object_key AS test_bundle_object_key, tb.sha256 AS test_bundle_content_sha256, tb.runtime_image_digest AS test_bundle_runtime_image_digest, tb.harness_version, tb.resource_limits, tb.key_reference
FROM practice.execution_runs AS er
JOIN practice.code_snapshots AS cs ON cs.id = er.code_snapshot_id
JOIN practice.test_bundles AS tb ON tb.id = er.test_bundle_id;

CREATE OR REPLACE VIEW identity.support_user_summary WITH (security_barrier = true) AS
SELECT id, display_name, locale, timezone, subscription_tier, status, created_at FROM identity.users;

CREATE OR REPLACE VIEW agent.cost_metrics_redacted WITH (security_barrier = true) AS
SELECT date_trunc('day', created_at)::date AS day, provider, model_name, count(*)::integer AS invocation_count, coalesce(sum(input_tokens), 0)::integer AS input_tokens, coalesce(sum(output_tokens), 0)::integer AS output_tokens, coalesce(sum(estimated_cost_usd), 0)::numeric(18,8) AS estimated_cost_usd
FROM agent.model_invocations
GROUP BY date_trunc('day', created_at)::date, provider, model_name;

REVOKE ALL ON ALL TABLES IN SCHEMA identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection FROM PUBLIC;
GRANT USAGE ON SCHEMA identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT USAGE ON SCHEMA public TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalog REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA study REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA retrieval REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA practice REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA knowledge REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA agent REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA discovery REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA projection REVOKE ALL ON TABLES FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.users, identity.auth_accounts, identity.auth_sessions, identity.user_settings TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts, catalog.collections, catalog.collection_sections, catalog.collection_items, catalog.collection_enrollments, catalog.library_items TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE study.learning_goals, study.study_sessions, study.session_resources, study.session_context_snapshots, study.session_checkpoints, study.user_resource_progress, study.focus_sessions, study.schedule_items, study.tutor_threads, study.tutor_messages TO learnspace_app;
GRANT SELECT, INSERT ON TABLE activity.activity_events TO learnspace_app;
GRANT SELECT ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles, retrieval.ingestion_runs, retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE practice.exercises, practice.exercise_bindings, practice.exercise_examples, practice.exercise_attempts, practice.code_snapshots, practice.execution_runs, practice.observer_diagnostics, practice.hint_events TO learnspace_app;
GRANT SELECT ON TABLE knowledge.concepts, knowledge.concept_aliases, knowledge.concept_relations, knowledge.user_knowledge_edges, knowledge.concept_mastery, knowledge.review_schedules, knowledge.unresolved_questions, knowledge.artifact_details, knowledge.artifact_sources, knowledge.artifact_concepts TO learnspace_app;
GRANT INSERT, UPDATE ON TABLE knowledge.artifact_details, knowledge.artifact_sources, knowledge.artifact_concepts TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE discovery.recommendation_runs, discovery.recommendation_candidates, discovery.recommendation_impressions, discovery.discovery_interactions, discovery.user_concept_affinity, discovery.resource_quality_snapshots TO learnspace_app;
GRANT SELECT ON TABLE projection.dashboard_state, projection.user_learning_daily, projection.session_summary TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE ops.idempotency_records, ops.outbox_events TO learnspace_app;
GRANT SELECT ON practice.learner_exercise_versions TO learnspace_app;

GRANT SELECT ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts TO learnspace_ai;
GRANT SELECT ON TABLE study.study_sessions, study.session_resources, study.session_context_snapshots, study.session_checkpoints, study.tutor_threads, study.tutor_messages TO learnspace_ai;
GRANT SELECT, INSERT, UPDATE ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles, retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations TO learnspace_ai;
GRANT SELECT ON TABLE knowledge.concepts, knowledge.concept_aliases, knowledge.concept_relations, knowledge.concept_mastery, knowledge.review_schedules TO learnspace_ai;
GRANT SELECT ON TABLE practice.exercise_attempts, practice.code_snapshots, practice.execution_runs, practice.observer_diagnostics, practice.hint_events TO learnspace_ai;
GRANT SELECT, INSERT, UPDATE ON TABLE agent.agent_runs, agent.agent_steps, agent.tool_invocations, agent.model_invocations, agent.agent_artifacts TO learnspace_ai;
GRANT SELECT ON practice.learner_exercise_versions TO learnspace_ai;

GRANT SELECT ON TABLE identity.users, catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts, study.study_sessions, study.session_resources, study.session_context_snapshots, study.session_checkpoints, activity.activity_events TO learnspace_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE retrieval.ingestion_runs, retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles, retrieval.chunk_concepts, retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations, knowledge.user_knowledge_edges, knowledge.concept_mastery, knowledge.review_schedules, discovery.user_concept_affinity, discovery.resource_quality_snapshots, projection.dashboard_state, projection.user_learning_daily, projection.session_summary, ops.jobs, ops.outbox_events, ops.dead_letter_events, ops.backfill_checkpoints TO learnspace_worker;
GRANT SELECT, INSERT ON TABLE activity.activity_events, knowledge.mastery_signals TO learnspace_worker;
REVOKE UPDATE, DELETE ON TABLE activity.activity_events, knowledge.mastery_signals FROM learnspace_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.authors, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts TO learnspace_worker;

GRANT SELECT ON TABLE practice.test_bundles, practice.exercise_attempts, practice.code_snapshots TO learnspace_runner;
GRANT SELECT, UPDATE ON TABLE practice.execution_runs TO learnspace_runner;
GRANT SELECT ON practice.runner_execution_payload TO learnspace_runner;
GRANT SELECT ON identity.support_user_summary, retrieval.authorized_chunk_metadata, agent.cost_metrics_redacted TO learnspace_readonly;

ALTER TABLE identity.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_settings_owner_policy ON identity.user_settings;
CREATE POLICY user_settings_owner_policy ON identity.user_settings FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));

ALTER TABLE catalog.resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resources_owner_or_visible_policy ON catalog.resources;
CREATE POLICY resources_owner_or_visible_policy ON catalog.resources FOR ALL TO learnspace_app, learnspace_ai USING (owner_user_id::text = current_setting('app.user_id', true) OR visibility IN ('public', 'unlisted')) WITH CHECK (owner_user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS resources_worker_policy ON catalog.resources;
CREATE POLICY resources_worker_policy ON catalog.resources FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

ALTER TABLE catalog.resource_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_versions_visible_policy ON catalog.resource_versions;
CREATE POLICY resource_versions_visible_policy ON catalog.resource_versions FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS resource_versions_worker_policy ON catalog.resource_versions;
CREATE POLICY resource_versions_worker_policy ON catalog.resource_versions FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

ALTER TABLE catalog.resource_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_assets_visible_policy ON catalog.resource_assets;
CREATE POLICY resource_assets_visible_policy ON catalog.resource_assets FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resource_versions rv JOIN catalog.resources r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resource_versions rv JOIN catalog.resources r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS resource_assets_worker_policy ON catalog.resource_assets;
CREATE POLICY resource_assets_worker_policy ON catalog.resource_assets FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

ALTER TABLE catalog.library_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_items_owner_policy ON catalog.library_items;
CREATE POLICY library_items_owner_policy ON catalog.library_items FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE catalog.collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collections_owner_or_visible_policy ON catalog.collections;
CREATE POLICY collections_owner_or_visible_policy ON catalog.collections FOR ALL TO learnspace_app USING (owner_user_id::text = current_setting('app.user_id', true) OR visibility IN ('public', 'unlisted')) WITH CHECK (owner_user_id::text = current_setting('app.user_id', true));
ALTER TABLE catalog.collection_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_enrollments_owner_policy ON catalog.collection_enrollments;
CREATE POLICY collection_enrollments_owner_policy ON catalog.collection_enrollments FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE catalog.collection_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_sections_owner_policy ON catalog.collection_sections;
CREATE POLICY collection_sections_owner_policy ON catalog.collection_sections FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM catalog.collections c WHERE c.id = collection_id AND (c.owner_user_id::text = current_setting('app.user_id', true) OR c.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.collections c WHERE c.id = collection_id AND c.owner_user_id::text = current_setting('app.user_id', true)));
ALTER TABLE catalog.collection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_items_owner_policy ON catalog.collection_items;
CREATE POLICY collection_items_owner_policy ON catalog.collection_items FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM catalog.collection_sections cs JOIN catalog.collections c ON c.id = cs.collection_id WHERE cs.id = section_id AND (c.owner_user_id::text = current_setting('app.user_id', true) OR c.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.collection_sections cs JOIN catalog.collections c ON c.id = cs.collection_id WHERE cs.id = section_id AND c.owner_user_id::text = current_setting('app.user_id', true)));
ALTER TABLE catalog.video_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_details_visible_policy ON catalog.video_details;
CREATE POLICY video_details_visible_policy ON catalog.video_details FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS video_details_worker_policy ON catalog.video_details;
CREATE POLICY video_details_worker_policy ON catalog.video_details FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.video_metric_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_metric_snapshots_visible_policy ON catalog.video_metric_snapshots;
CREATE POLICY video_metric_snapshots_visible_policy ON catalog.video_metric_snapshots FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS video_metric_snapshots_worker_policy ON catalog.video_metric_snapshots;
CREATE POLICY video_metric_snapshots_worker_policy ON catalog.video_metric_snapshots FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_details_visible_policy ON catalog.paper_details;
CREATE POLICY paper_details_visible_policy ON catalog.paper_details FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS paper_details_worker_policy ON catalog.paper_details;
CREATE POLICY paper_details_worker_policy ON catalog.paper_details FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_authors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_authors_visible_policy ON catalog.paper_authors;
CREATE POLICY paper_authors_visible_policy ON catalog.paper_authors FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.paper_details p JOIN catalog.resources r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.paper_details p JOIN catalog.resources r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS paper_authors_worker_policy ON catalog.paper_authors;
CREATE POLICY paper_authors_worker_policy ON catalog.paper_authors FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_references_visible_policy ON catalog.paper_references;
CREATE POLICY paper_references_visible_policy ON catalog.paper_references FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.paper_details p JOIN catalog.resources r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.paper_details p JOIN catalog.resources r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS paper_references_worker_policy ON catalog.paper_references;
CREATE POLICY paper_references_worker_policy ON catalog.paper_references FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.resource_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_concepts_visible_policy ON catalog.resource_concepts;
CREATE POLICY resource_concepts_visible_policy ON catalog.resource_concepts FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS resource_concepts_worker_policy ON catalog.resource_concepts;
CREATE POLICY resource_concepts_worker_policy ON catalog.resource_concepts FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

ALTER TABLE study.learning_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS learning_goals_owner_policy ON study.learning_goals;
CREATE POLICY learning_goals_owner_policy ON study.learning_goals FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.study_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_sessions_owner_policy ON study.study_sessions;
CREATE POLICY study_sessions_owner_policy ON study.study_sessions FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS study_sessions_worker_policy ON study.study_sessions;
CREATE POLICY study_sessions_worker_policy ON study.study_sessions FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.session_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_resources_owner_policy ON study.session_resources;
CREATE POLICY session_resources_owner_policy ON study.session_resources FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS session_resources_worker_policy ON study.session_resources;
CREATE POLICY session_resources_worker_policy ON study.session_resources FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.session_context_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_snapshots_owner_policy ON study.session_context_snapshots;
CREATE POLICY session_snapshots_owner_policy ON study.session_context_snapshots FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS session_snapshots_worker_policy ON study.session_context_snapshots;
CREATE POLICY session_snapshots_worker_policy ON study.session_context_snapshots FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.session_checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_checkpoints_owner_policy ON study.session_checkpoints;
CREATE POLICY session_checkpoints_owner_policy ON study.session_checkpoints FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS session_checkpoints_worker_policy ON study.session_checkpoints;
CREATE POLICY session_checkpoints_worker_policy ON study.session_checkpoints FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.user_resource_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_resource_progress_owner_policy ON study.user_resource_progress;
CREATE POLICY user_resource_progress_owner_policy ON study.user_resource_progress FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.focus_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS focus_sessions_owner_policy ON study.focus_sessions;
CREATE POLICY focus_sessions_owner_policy ON study.focus_sessions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.schedule_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_items_owner_policy ON study.schedule_items;
CREATE POLICY schedule_items_owner_policy ON study.schedule_items FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.tutor_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tutor_threads_owner_policy ON study.tutor_threads;
CREATE POLICY tutor_threads_owner_policy ON study.tutor_threads FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.tutor_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tutor_messages_owner_policy ON study.tutor_messages;
CREATE POLICY tutor_messages_owner_policy ON study.tutor_messages FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM study.tutor_threads t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM study.tutor_threads t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true)));

ALTER TABLE activity.activity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_events_owner_policy ON activity.activity_events;
CREATE POLICY activity_events_owner_policy ON activity.activity_events FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS activity_events_worker_policy ON activity.activity_events;
CREATE POLICY activity_events_worker_policy ON activity.activity_events FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.resource_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_chunks_visible_policy ON retrieval.resource_chunks;
CREATE POLICY resource_chunks_visible_policy ON retrieval.resource_chunks FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resource_versions rv JOIN catalog.resources r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resource_versions rv JOIN catalog.resources r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS resource_chunks_worker_policy ON retrieval.resource_chunks;
CREATE POLICY resource_chunks_worker_policy ON retrieval.resource_chunks FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.chunk_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chunk_embeddings_visible_policy ON retrieval.chunk_embeddings;
CREATE POLICY chunk_embeddings_visible_policy ON retrieval.chunk_embeddings FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM retrieval.resource_chunks c JOIN catalog.resource_versions rv ON rv.id = c.resource_version_id JOIN catalog.resources r ON r.id = rv.resource_id WHERE c.id = chunk_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM retrieval.resource_chunks c JOIN catalog.resource_versions rv ON rv.id = c.resource_version_id JOIN catalog.resources r ON r.id = rv.resource_id WHERE c.id = chunk_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS chunk_embeddings_worker_policy ON retrieval.chunk_embeddings;
CREATE POLICY chunk_embeddings_worker_policy ON retrieval.chunk_embeddings FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.retrieval_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retrieval_runs_owner_policy ON retrieval.retrieval_runs;
CREATE POLICY retrieval_runs_owner_policy ON retrieval.retrieval_runs FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS retrieval_runs_worker_policy ON retrieval.retrieval_runs;
CREATE POLICY retrieval_runs_worker_policy ON retrieval.retrieval_runs FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.retrieved_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retrieved_chunks_owner_policy ON retrieval.retrieved_chunks;
CREATE POLICY retrieved_chunks_owner_policy ON retrieval.retrieved_chunks FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM retrieval.retrieval_runs r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM retrieval.retrieval_runs r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS retrieved_chunks_worker_policy ON retrieval.retrieved_chunks;
CREATE POLICY retrieved_chunks_worker_policy ON retrieval.retrieved_chunks FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.citations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS citations_owner_policy ON retrieval.citations;
CREATE POLICY citations_owner_policy ON retrieval.citations FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM retrieval.retrieval_runs r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM retrieval.retrieval_runs r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS citations_worker_policy ON retrieval.citations;
CREATE POLICY citations_worker_policy ON retrieval.citations FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

ALTER TABLE practice.exercise_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercise_attempts_owner_policy ON practice.exercise_attempts;
CREATE POLICY exercise_attempts_owner_policy ON practice.exercise_attempts FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE practice.exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercises_visible_policy ON practice.exercises;
CREATE POLICY exercises_visible_policy ON practice.exercises FOR ALL TO learnspace_app USING (owner_user_id IS NULL OR owner_user_id::text = current_setting('app.user_id', true)) WITH CHECK (owner_user_id IS NULL OR owner_user_id::text = current_setting('app.user_id', true));
ALTER TABLE practice.exercise_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercise_bindings_owner_policy ON practice.exercise_bindings;
CREATE POLICY exercise_bindings_owner_policy ON practice.exercise_bindings FOR ALL TO learnspace_app USING (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE practice.exercise_examples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercise_examples_visible_policy ON practice.exercise_examples;
CREATE POLICY exercise_examples_visible_policy ON practice.exercise_examples FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM practice.exercise_versions ev JOIN practice.exercises e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND (e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true)))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_versions ev JOIN practice.exercises e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND (e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true))));
ALTER TABLE practice.code_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS code_snapshots_owner_policy ON practice.code_snapshots;
CREATE POLICY code_snapshots_owner_policy ON practice.code_snapshots FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE practice.observer_diagnostics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS observer_diagnostics_owner_policy ON practice.observer_diagnostics;
CREATE POLICY observer_diagnostics_owner_policy ON practice.observer_diagnostics FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE practice.hint_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hint_events_owner_policy ON practice.hint_events;
CREATE POLICY hint_events_owner_policy ON practice.hint_events FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE practice.execution_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_runs_owner_policy ON practice.execution_runs;
CREATE POLICY execution_runs_owner_policy ON practice.execution_runs FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS execution_runs_runner_policy ON practice.execution_runs;
CREATE POLICY execution_runs_runner_policy ON practice.execution_runs FOR ALL TO learnspace_runner USING (true) WITH CHECK (true);

ALTER TABLE knowledge.user_knowledge_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_knowledge_edges_owner_policy ON knowledge.user_knowledge_edges;
CREATE POLICY user_knowledge_edges_owner_policy ON knowledge.user_knowledge_edges FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE knowledge.mastery_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mastery_signals_owner_policy ON knowledge.mastery_signals;
CREATE POLICY mastery_signals_owner_policy ON knowledge.mastery_signals FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS mastery_signals_worker_policy ON knowledge.mastery_signals;
CREATE POLICY mastery_signals_worker_policy ON knowledge.mastery_signals FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.concept_mastery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS concept_mastery_owner_policy ON knowledge.concept_mastery;
CREATE POLICY concept_mastery_owner_policy ON knowledge.concept_mastery FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS concept_mastery_worker_policy ON knowledge.concept_mastery;
CREATE POLICY concept_mastery_worker_policy ON knowledge.concept_mastery FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.review_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_schedules_owner_policy ON knowledge.review_schedules;
CREATE POLICY review_schedules_owner_policy ON knowledge.review_schedules FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS review_schedules_worker_policy ON knowledge.review_schedules;
CREATE POLICY review_schedules_worker_policy ON knowledge.review_schedules FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.unresolved_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unresolved_questions_owner_policy ON knowledge.unresolved_questions;
CREATE POLICY unresolved_questions_owner_policy ON knowledge.unresolved_questions FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE knowledge.artifact_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_details_owner_policy ON knowledge.artifact_details;
CREATE POLICY artifact_details_owner_policy ON knowledge.artifact_details FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE knowledge.artifact_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_sources_owner_policy ON knowledge.artifact_sources;
CREATE POLICY artifact_sources_owner_policy ON knowledge.artifact_sources FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM knowledge.artifact_details a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE knowledge.artifact_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_concepts_owner_policy ON knowledge.artifact_concepts;
CREATE POLICY artifact_concepts_owner_policy ON knowledge.artifact_concepts FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM knowledge.artifact_details a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));

ALTER TABLE agent.agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_runs_owner_policy ON agent.agent_runs;
CREATE POLICY agent_runs_owner_policy ON agent.agent_runs FOR ALL TO learnspace_app, learnspace_ai USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE agent.agent_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_steps_owner_policy ON agent.agent_steps;
CREATE POLICY agent_steps_owner_policy ON agent.agent_steps FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE agent.tool_invocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_invocations_owner_policy ON agent.tool_invocations;
CREATE POLICY tool_invocations_owner_policy ON agent.tool_invocations FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE agent.model_invocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_invocations_owner_policy ON agent.model_invocations;
CREATE POLICY model_invocations_owner_policy ON agent.model_invocations FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE agent.agent_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_artifacts_owner_policy ON agent.agent_artifacts;
CREATE POLICY agent_artifacts_owner_policy ON agent.agent_artifacts FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));

ALTER TABLE discovery.recommendation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_runs_owner_policy ON discovery.recommendation_runs;
CREATE POLICY recommendation_runs_owner_policy ON discovery.recommendation_runs FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE discovery.recommendation_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_candidates_owner_policy ON discovery.recommendation_candidates;
CREATE POLICY recommendation_candidates_owner_policy ON discovery.recommendation_candidates FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM discovery.recommendation_runs r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM discovery.recommendation_runs r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE discovery.recommendation_impressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_impressions_owner_policy ON discovery.recommendation_impressions;
CREATE POLICY recommendation_impressions_owner_policy ON discovery.recommendation_impressions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE discovery.discovery_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discovery_interactions_owner_policy ON discovery.discovery_interactions;
CREATE POLICY discovery_interactions_owner_policy ON discovery.discovery_interactions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE discovery.user_concept_affinity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_concept_affinity_owner_policy ON discovery.user_concept_affinity;
CREATE POLICY user_concept_affinity_owner_policy ON discovery.user_concept_affinity FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS user_concept_affinity_worker_policy ON discovery.user_concept_affinity;
CREATE POLICY user_concept_affinity_worker_policy ON discovery.user_concept_affinity FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

ALTER TABLE projection.dashboard_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_state_owner_policy ON projection.dashboard_state;
CREATE POLICY dashboard_state_owner_policy ON projection.dashboard_state FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS dashboard_state_worker_policy ON projection.dashboard_state;
CREATE POLICY dashboard_state_worker_policy ON projection.dashboard_state FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE projection.user_learning_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_learning_daily_owner_policy ON projection.user_learning_daily;
CREATE POLICY user_learning_daily_owner_policy ON projection.user_learning_daily FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS user_learning_daily_worker_policy ON projection.user_learning_daily;
CREATE POLICY user_learning_daily_worker_policy ON projection.user_learning_daily FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE projection.session_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_summary_owner_policy ON projection.session_summary;
CREATE POLICY session_summary_owner_policy ON projection.session_summary FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS session_summary_worker_policy ON projection.session_summary;
CREATE POLICY session_summary_worker_policy ON projection.session_summary FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE ops.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_events_owner_policy ON ops.outbox_events;
CREATE POLICY outbox_events_owner_policy ON ops.outbox_events FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
DROP POLICY IF EXISTS outbox_events_worker_policy ON ops.outbox_events;
CREATE POLICY outbox_events_worker_policy ON ops.outbox_events FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE ops.idempotency_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idempotency_records_owner_policy ON ops.idempotency_records;
CREATE POLICY idempotency_records_owner_policy ON ops.idempotency_records FOR ALL TO learnspace_app USING (user_id IS NULL OR user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id IS NULL OR user_id::text = current_setting('app.user_id', true));

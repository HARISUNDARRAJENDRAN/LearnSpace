ALTER TABLE "retrieval"."embedding_profiles" ADD CONSTRAINT "embedding_profiles_active_dimensions_chk" CHECK ("retrieval"."embedding_profiles"."dimensions" = 1536);
ALTER TABLE "retrieval"."embedding_profiles" ADD CONSTRAINT "embedding_profiles_distance_metric_chk" CHECK ("retrieval"."embedding_profiles"."distance_metric" = 'cosine');
ALTER TABLE identity.auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_rotated_from_fkey;
ALTER TABLE retrieval.resource_chunks DROP CONSTRAINT IF EXISTS resource_chunks_parent_fkey;
ALTER TABLE practice.code_snapshots DROP CONSTRAINT IF EXISTS code_snapshots_parent_fkey;
ALTER TABLE activity.activity_events DROP CONSTRAINT IF EXISTS activity_events_resource_version_owner_fkey;
ALTER TABLE retrieval.ingestion_runs DROP CONSTRAINT IF EXISTS ingestion_runs_resource_version_owner_fkey;
ALTER TABLE practice.exercise_bindings DROP CONSTRAINT IF EXISTS exercise_bindings_resource_version_owner_fkey;
ALTER TABLE identity.auth_sessions ADD CONSTRAINT auth_sessions_rotated_user_fkey FOREIGN KEY (user_id, rotated_from_id) REFERENCES identity.auth_sessions (user_id, id) ON DELETE NO ACTION;
ALTER TABLE retrieval.resource_chunks ADD CONSTRAINT resource_chunks_parent_version_fkey FOREIGN KEY (resource_version_id, parent_chunk_id) REFERENCES retrieval.resource_chunks (resource_version_id, id) ON DELETE CASCADE;
ALTER TABLE practice.code_snapshots ADD CONSTRAINT code_snapshots_parent_attempt_fkey FOREIGN KEY (attempt_id, parent_snapshot_id) REFERENCES practice.code_snapshots (attempt_id, id) ON DELETE NO ACTION;
CREATE OR REPLACE FUNCTION catalog.validate_current_resource_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_resource_id uuid;
  version_status text;
BEGIN
  IF NEW.current_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT rv.resource_id, rv.processing_status
  INTO version_resource_id, version_status
  FROM catalog.resource_versions AS rv
  WHERE rv.id = NEW.current_version_id;
  IF NOT FOUND OR version_resource_id IS DISTINCT FROM NEW.id OR version_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'current resource version must belong to the resource and be ready' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resources_current_version_ready_trg ON catalog.resources;
CREATE TRIGGER resources_current_version_ready_trg
BEFORE INSERT OR UPDATE OF current_version_id ON catalog.resources
FOR EACH ROW
EXECUTE FUNCTION catalog.validate_current_resource_version();
CREATE OR REPLACE FUNCTION catalog.reject_resource_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.processing_status = 'ready' THEN
    RAISE EXCEPTION 'ready resource versions are immutable' USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resource_versions_immutable_trg ON catalog.resource_versions;
CREATE TRIGGER resource_versions_immutable_trg
BEFORE UPDATE ON catalog.resource_versions
FOR EACH ROW
EXECUTE FUNCTION catalog.reject_resource_version_update();
CREATE OR REPLACE FUNCTION practice.validate_execution_run_hashes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, practice
AS $$
DECLARE
  attempt_version_id uuid;
  snapshot_attempt_id uuid;
  bundle_version_id uuid;
BEGIN
  SELECT a.exercise_version_id, cs.attempt_id, tb.exercise_version_id
  INTO attempt_version_id, snapshot_attempt_id, bundle_version_id
  FROM practice.exercise_attempts AS a
  JOIN practice.code_snapshots AS cs ON cs.id = NEW.code_snapshot_id
  JOIN practice.test_bundles AS tb ON tb.id = NEW.test_bundle_id
  WHERE a.id = NEW.attempt_id;
  IF NOT FOUND OR snapshot_attempt_id IS DISTINCT FROM NEW.attempt_id OR bundle_version_id IS DISTINCT FROM attempt_version_id THEN
    RAISE EXCEPTION 'execution references do not belong to the attempt exercise version' USING ERRCODE = '23514';
  END IF;
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
REVOKE ALL ON TABLE identity.users, identity.auth_accounts, identity.auth_sessions FROM learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.users, identity.auth_accounts, identity.auth_sessions TO learnspace_app;
ALTER TABLE identity.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_users_select_policy ON identity.users;
DROP POLICY IF EXISTS identity_users_insert_policy ON identity.users;
DROP POLICY IF EXISTS identity_users_update_policy ON identity.users;
DROP POLICY IF EXISTS identity_users_delete_policy ON identity.users;
CREATE POLICY identity_users_select_policy ON identity.users FOR SELECT TO learnspace_app USING (id::text = current_setting('app.user_id', true));
CREATE POLICY identity_users_insert_policy ON identity.users FOR INSERT TO learnspace_app WITH CHECK (id::text = current_setting('app.user_id', true));
CREATE POLICY identity_users_update_policy ON identity.users FOR UPDATE TO learnspace_app USING (id::text = current_setting('app.user_id', true)) WITH CHECK (id::text = current_setting('app.user_id', true));
CREATE POLICY identity_users_delete_policy ON identity.users FOR DELETE TO learnspace_app USING (id::text = current_setting('app.user_id', true));
ALTER TABLE identity.auth_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_auth_accounts_select_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_accounts_insert_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_accounts_update_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_accounts_delete_policy ON identity.auth_accounts;
CREATE POLICY identity_auth_accounts_select_policy ON identity.auth_accounts FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY identity_auth_accounts_insert_policy ON identity.auth_accounts FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY identity_auth_accounts_update_policy ON identity.auth_accounts FOR UPDATE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY identity_auth_accounts_delete_policy ON identity.auth_accounts FOR DELETE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE identity.auth_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_auth_sessions_select_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_auth_sessions_insert_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_auth_sessions_update_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_auth_sessions_delete_policy ON identity.auth_sessions;
CREATE POLICY identity_auth_sessions_select_policy ON identity.auth_sessions FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY identity_auth_sessions_insert_policy ON identity.auth_sessions FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY identity_auth_sessions_update_policy ON identity.auth_sessions FOR UPDATE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY identity_auth_sessions_delete_policy ON identity.auth_sessions FOR DELETE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE practice.exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercises_visible_policy ON practice.exercises;
DROP POLICY IF EXISTS exercises_select_policy ON practice.exercises;
DROP POLICY IF EXISTS exercises_insert_policy ON practice.exercises;
DROP POLICY IF EXISTS exercises_update_policy ON practice.exercises;
DROP POLICY IF EXISTS exercises_delete_policy ON practice.exercises;
DROP POLICY IF EXISTS exercises_worker_publication_policy ON practice.exercises;
REVOKE ALL ON TABLE practice.exercises FROM learnspace_ai, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE practice.exercises TO learnspace_app, learnspace_worker;
CREATE POLICY exercises_select_policy ON practice.exercises FOR SELECT TO learnspace_app USING (owner_user_id IS NULL OR owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_insert_policy ON practice.exercises FOR INSERT TO learnspace_app WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_update_policy ON practice.exercises FOR UPDATE TO learnspace_app USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true)) WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_delete_policy ON practice.exercises FOR DELETE TO learnspace_app USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_worker_publication_policy ON practice.exercises FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE practice.execution_runs FROM learnspace_app, learnspace_ai, learnspace_runner;
GRANT SELECT, INSERT ON TABLE practice.execution_runs TO learnspace_app;
GRANT SELECT ON TABLE practice.execution_runs TO learnspace_ai;
GRANT SELECT, UPDATE ON TABLE practice.execution_runs TO learnspace_runner;
ALTER TABLE practice.execution_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_runs_owner_policy ON practice.execution_runs;
DROP POLICY IF EXISTS execution_runs_runner_policy ON practice.execution_runs;
DROP POLICY IF EXISTS execution_runs_app_select_policy ON practice.execution_runs;
DROP POLICY IF EXISTS execution_runs_app_enqueue_policy ON practice.execution_runs;
DROP POLICY IF EXISTS execution_runs_ai_select_policy ON practice.execution_runs;
DROP POLICY IF EXISTS execution_runs_runner_select_policy ON practice.execution_runs;
DROP POLICY IF EXISTS execution_runs_runner_update_policy ON practice.execution_runs;
CREATE POLICY execution_runs_app_select_policy ON practice.execution_runs FOR SELECT TO learnspace_app USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY execution_runs_app_enqueue_policy ON practice.execution_runs FOR INSERT TO learnspace_app WITH CHECK (status = 'queued' AND result = '{}'::jsonb AND exit_code IS NULL AND signal IS NULL AND cpu_time_ms IS NULL AND wall_time_ms IS NULL AND peak_memory_bytes IS NULL AND passed_case_count IS NULL AND total_case_count IS NULL AND stdout_excerpt IS NULL AND stderr_excerpt IS NULL AND started_at IS NULL AND completed_at IS NULL AND EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY execution_runs_ai_select_policy ON practice.execution_runs FOR SELECT TO learnspace_ai USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY execution_runs_runner_select_policy ON practice.execution_runs FOR SELECT TO learnspace_runner USING (true);
CREATE POLICY execution_runs_runner_update_policy ON practice.execution_runs FOR UPDATE TO learnspace_runner USING (true) WITH CHECK (true);
ALTER TABLE ops.idempotency_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idempotency_records_owner_policy ON ops.idempotency_records;
DROP POLICY IF EXISTS idempotency_records_select_policy ON ops.idempotency_records;
CREATE POLICY idempotency_records_select_policy ON ops.idempotency_records FOR SELECT TO learnspace_app USING (user_id IS NOT NULL AND user_id::text = current_setting('app.user_id', true));
REVOKE ALL ON TABLE ops.idempotency_records FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT ON TABLE ops.idempotency_records TO learnspace_app;
CREATE OR REPLACE FUNCTION ops.claim_idempotency(p_scope text, p_idempotency_key text, p_request_sha256 char(64), p_expires_at timestamptz)
RETURNS SETOF ops.idempotency_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ops
AS $$
DECLARE
  caller_user_id uuid;
  record_row ops.idempotency_records%ROWTYPE;
BEGIN
  caller_user_id := NULLIF(current_setting('app.user_id', true), '')::uuid;
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'app.user_id is required for idempotency' USING ERRCODE = '42501';
  END IF;
  INSERT INTO ops.idempotency_records (scope, idempotency_key, user_id, request_sha256, status, expires_at)
  VALUES (p_scope, p_idempotency_key, caller_user_id, p_request_sha256, 'in_progress', p_expires_at)
  ON CONFLICT (scope, idempotency_key) DO NOTHING;
  SELECT * INTO record_row
  FROM ops.idempotency_records
  WHERE scope = p_scope AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'idempotency record was not available' USING ERRCODE = '40001';
  END IF;
  IF record_row.user_id IS DISTINCT FROM caller_user_id OR record_row.request_sha256 <> p_request_sha256 THEN
    RAISE EXCEPTION 'idempotency key was reused with a different request' USING ERRCODE = '23P01';
  END IF;
  RETURN NEXT record_row;
  RETURN;
END;
$$;
CREATE OR REPLACE FUNCTION ops.complete_idempotency(p_scope text, p_idempotency_key text, p_status text, p_response_status integer, p_response_body jsonb, p_resource_id uuid DEFAULT NULL)
RETURNS SETOF ops.idempotency_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ops
AS $$
DECLARE
  caller_user_id uuid;
  record_row ops.idempotency_records%ROWTYPE;
BEGIN
  caller_user_id := NULLIF(current_setting('app.user_id', true), '')::uuid;
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'app.user_id is required for idempotency' USING ERRCODE = '42501';
  END IF;
  UPDATE ops.idempotency_records
  SET status = p_status, response_status = p_response_status, response_body = p_response_body, resource_id = p_resource_id
  WHERE scope = p_scope AND idempotency_key = p_idempotency_key AND user_id = caller_user_id
  RETURNING * INTO record_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'idempotency record does not belong to the current user' USING ERRCODE = '42501';
  END IF;
  RETURN NEXT record_row;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION ops.claim_idempotency(text, text, char(64), timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.complete_idempotency(text, text, text, integer, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.claim_idempotency(text, text, char(64), timestamptz) TO learnspace_app;
GRANT EXECUTE ON FUNCTION ops.complete_idempotency(text, text, text, integer, jsonb, uuid) TO learnspace_app;
CREATE TABLE drizzle.migration_manifest (
  migration_order integer PRIMARY KEY,
  migration_name text NOT NULL UNIQUE,
  checksum char(64) NOT NULL,
  drizzle_hash char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_manifest_order_chk CHECK (migration_order >= 0)
);
REVOKE ALL ON TABLE drizzle.migration_manifest FROM PUBLIC;
ALTER TABLE catalog.collection_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_sections_owner_policy ON catalog.collection_sections;
CREATE POLICY collection_sections_owner_policy ON catalog.collection_sections FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM catalog.collections AS c WHERE c.id = collection_id AND (c.owner_user_id::text = current_setting('app.user_id', true) OR c.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.collections AS c WHERE c.id = collection_id AND c.owner_user_id::text = current_setting('app.user_id', true)));
ALTER TABLE catalog.collection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_items_owner_policy ON catalog.collection_items;
CREATE POLICY collection_items_owner_policy ON catalog.collection_items FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM catalog.collection_sections AS cs JOIN catalog.collections AS c ON c.id = cs.collection_id WHERE cs.id = section_id AND (c.owner_user_id::text = current_setting('app.user_id', true) OR c.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.collection_sections AS cs JOIN catalog.collections AS c ON c.id = cs.collection_id WHERE cs.id = section_id AND c.owner_user_id::text = current_setting('app.user_id', true)));
ALTER TABLE catalog.video_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_details_visible_policy ON catalog.video_details;
DROP POLICY IF EXISTS video_details_worker_policy ON catalog.video_details;
CREATE POLICY video_details_visible_policy ON catalog.video_details FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY video_details_worker_policy ON catalog.video_details FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.video_metric_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_metric_snapshots_visible_policy ON catalog.video_metric_snapshots;
DROP POLICY IF EXISTS video_metric_snapshots_worker_policy ON catalog.video_metric_snapshots;
CREATE POLICY video_metric_snapshots_visible_policy ON catalog.video_metric_snapshots FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY video_metric_snapshots_worker_policy ON catalog.video_metric_snapshots FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_details_visible_policy ON catalog.paper_details;
DROP POLICY IF EXISTS paper_details_worker_policy ON catalog.paper_details;
CREATE POLICY paper_details_visible_policy ON catalog.paper_details FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY paper_details_worker_policy ON catalog.paper_details FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_authors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_authors_visible_policy ON catalog.paper_authors;
DROP POLICY IF EXISTS paper_authors_worker_policy ON catalog.paper_authors;
CREATE POLICY paper_authors_visible_policy ON catalog.paper_authors FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.paper_details AS p JOIN catalog.resources AS r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.paper_details AS p JOIN catalog.resources AS r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY paper_authors_worker_policy ON catalog.paper_authors FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_references_visible_policy ON catalog.paper_references;
DROP POLICY IF EXISTS paper_references_worker_policy ON catalog.paper_references;
CREATE POLICY paper_references_visible_policy ON catalog.paper_references FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.paper_details AS p JOIN catalog.resources AS r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.paper_details AS p JOIN catalog.resources AS r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY paper_references_worker_policy ON catalog.paper_references FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.resource_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_concepts_visible_policy ON catalog.resource_concepts;
DROP POLICY IF EXISTS resource_concepts_worker_policy ON catalog.resource_concepts;
CREATE POLICY resource_concepts_visible_policy ON catalog.resource_concepts FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))) WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY resource_concepts_worker_policy ON catalog.resource_concepts FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS study_sessions_worker_policy ON study.study_sessions;
CREATE POLICY study_sessions_worker_policy ON study.study_sessions FOR SELECT TO learnspace_worker USING (true);
DROP POLICY IF EXISTS session_resources_worker_policy ON study.session_resources;
CREATE POLICY session_resources_worker_policy ON study.session_resources FOR SELECT TO learnspace_worker USING (true);
DROP POLICY IF EXISTS session_snapshots_worker_policy ON study.session_context_snapshots;
CREATE POLICY session_snapshots_worker_policy ON study.session_context_snapshots FOR SELECT TO learnspace_worker USING (true);
DROP POLICY IF EXISTS session_checkpoints_worker_policy ON study.session_checkpoints;
CREATE POLICY session_checkpoints_worker_policy ON study.session_checkpoints FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE retrieval.retrieved_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retrieved_chunks_owner_policy ON retrieval.retrieved_chunks;
DROP POLICY IF EXISTS retrieved_chunks_worker_policy ON retrieval.retrieved_chunks;
CREATE POLICY retrieved_chunks_owner_policy ON retrieval.retrieved_chunks FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY retrieved_chunks_worker_policy ON retrieval.retrieved_chunks FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.citations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS citations_owner_policy ON retrieval.citations;
DROP POLICY IF EXISTS citations_worker_policy ON retrieval.citations;
CREATE POLICY citations_owner_policy ON retrieval.citations FOR ALL TO learnspace_app, learnspace_ai USING (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY citations_worker_policy ON retrieval.citations FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.exercise_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercise_bindings_owner_policy ON practice.exercise_bindings;
CREATE POLICY exercise_bindings_owner_policy ON practice.exercise_bindings FOR ALL TO learnspace_app USING (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true))) WITH CHECK (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE practice.exercise_examples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercise_examples_visible_policy ON practice.exercise_examples;
CREATE POLICY exercise_examples_visible_policy ON practice.exercise_examples FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND (e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true)))) WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND (e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true))));
ALTER TABLE knowledge.artifact_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_details_owner_policy ON knowledge.artifact_details;
CREATE POLICY artifact_details_owner_policy ON knowledge.artifact_details FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE knowledge.artifact_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_sources_owner_policy ON knowledge.artifact_sources;
CREATE POLICY artifact_sources_owner_policy ON knowledge.artifact_sources FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE knowledge.artifact_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_concepts_owner_policy ON knowledge.artifact_concepts;
CREATE POLICY artifact_concepts_owner_policy ON knowledge.artifact_concepts FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE discovery.recommendation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_runs_owner_policy ON discovery.recommendation_runs;
CREATE POLICY recommendation_runs_owner_policy ON discovery.recommendation_runs FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE discovery.recommendation_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_candidates_owner_policy ON discovery.recommendation_candidates;
CREATE POLICY recommendation_candidates_owner_policy ON discovery.recommendation_candidates FOR ALL TO learnspace_app USING (EXISTS (SELECT 1 FROM discovery.recommendation_runs AS r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM discovery.recommendation_runs AS r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE discovery.recommendation_impressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_impressions_owner_policy ON discovery.recommendation_impressions;
CREATE POLICY recommendation_impressions_owner_policy ON discovery.recommendation_impressions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE discovery.discovery_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discovery_interactions_owner_policy ON discovery.discovery_interactions;
CREATE POLICY discovery_interactions_owner_policy ON discovery.discovery_interactions FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE discovery.user_concept_affinity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_concept_affinity_owner_policy ON discovery.user_concept_affinity;
DROP POLICY IF EXISTS user_concept_affinity_worker_policy ON discovery.user_concept_affinity;
CREATE POLICY user_concept_affinity_owner_policy ON discovery.user_concept_affinity FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_concept_affinity_worker_policy ON discovery.user_concept_affinity FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE projection.dashboard_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_state_worker_policy ON projection.dashboard_state;
CREATE POLICY dashboard_state_worker_policy ON projection.dashboard_state FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE projection.user_learning_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_learning_daily_worker_policy ON projection.user_learning_daily;
CREATE POLICY user_learning_daily_worker_policy ON projection.user_learning_daily FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE projection.session_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_summary_worker_policy ON projection.session_summary;
CREATE POLICY session_summary_worker_policy ON projection.session_summary FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE ops.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_events_owner_policy ON ops.outbox_events;
DROP POLICY IF EXISTS outbox_events_worker_policy ON ops.outbox_events;
CREATE POLICY outbox_events_owner_policy ON ops.outbox_events FOR ALL TO learnspace_app USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY outbox_events_worker_policy ON ops.outbox_events FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);

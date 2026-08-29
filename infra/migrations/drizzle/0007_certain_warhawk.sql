ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_retrieval_agent_fkey" FOREIGN KEY ("retrieval_run_id","agent_run_id") REFERENCES "retrieval"."retrieval_runs"("id","agent_run_id") ON DELETE restrict ON UPDATE no action;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles AS runtime_role
    WHERE runtime_role.rolname IN ('learnspace_app', 'learnspace_ai', 'learnspace_worker', 'learnspace_runner', 'learnspace_readonly')
      AND NOT has_schema_privilege(runtime_role.rolname, 'public', 'USAGE')
  ) THEN
    GRANT USAGE ON SCHEMA public TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
  END IF;
END;
$$;
DO $$
DECLARE
  vector_owner oid;
BEGIN
  SELECT t.typowner
    INTO vector_owner
  FROM pg_type AS t
  JOIN pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname = 'vector';
  IF vector_owner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
     AND EXISTS (
       SELECT 1
       FROM pg_roles AS runtime_role
       WHERE runtime_role.rolname IN ('learnspace_app', 'learnspace_ai', 'learnspace_worker', 'learnspace_runner', 'learnspace_readonly')
         AND NOT has_type_privilege(runtime_role.rolname, 'public.vector', 'USAGE')
     ) THEN
    GRANT USAGE ON TYPE public.vector TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
  END IF;
END;
$$;
DO $$
DECLARE
  vector_function record;
BEGIN
  FOR vector_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_depend AS d
      ON d.classid = 'pg_proc'::regclass
     AND d.objid = p.oid
     AND d.refclassid = 'pg_extension'::regclass
    JOIN pg_extension AS e ON e.oid = d.refobjid
    WHERE e.extname = 'vector'
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND NOT (
        has_function_privilege('learnspace_app', p.oid, 'EXECUTE')
        AND has_function_privilege('learnspace_ai', p.oid, 'EXECUTE')
        AND has_function_privilege('learnspace_worker', p.oid, 'EXECUTE')
        AND has_function_privilege('learnspace_runner', p.oid, 'EXECUTE')
        AND has_function_privilege('learnspace_readonly', p.oid, 'EXECUTE')
      )
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly',
      vector_function.signature
    );
  END LOOP;
END;
$$;
DO $$
DECLARE
  policy_row record;
  role_sql text;
  policy_base text;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname, roles, qual, with_check
    FROM pg_policies
    WHERE cmd = 'ALL'
    ORDER BY schemaname, tablename, policyname
  LOOP
    role_sql := (
      SELECT string_agg(format('%I', role_name), ', ' ORDER BY role_name)
      FROM unnest(policy_row.roles) AS role_name
    );
    IF role_sql IS NULL OR role_sql = '' THEN
      role_sql := 'PUBLIC';
    END IF;
    policy_base := left(policy_row.policyname, 55);
    EXECUTE format('DROP POLICY %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR SELECT TO %s USING (%s)',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      role_sql,
      coalesce(policy_row.qual, 'true')
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR INSERT TO %s WITH CHECK (%s)',
      policy_base || '_insert',
      policy_row.schemaname,
      policy_row.tablename,
      role_sql,
      coalesce(policy_row.with_check, policy_row.qual, 'true')
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
      policy_base || '_update',
      policy_row.schemaname,
      policy_row.tablename,
      role_sql,
      coalesce(policy_row.qual, 'true'),
      coalesce(policy_row.with_check, policy_row.qual, 'true')
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR DELETE TO %s USING (%s)',
      policy_base || '_delete',
      policy_row.schemaname,
      policy_row.tablename,
      role_sql,
      coalesce(policy_row.qual, 'true')
    );
  END LOOP;
END;
$$;
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT p.schemaname, p.tablename, p.policyname
    FROM pg_policies AS p
    WHERE (p.schemaname, p.tablename) IN (
      VALUES
        ('catalog', 'resources'), ('catalog', 'resource_versions'), ('catalog', 'resource_assets'),
        ('catalog', 'authors'), ('catalog', 'video_details'), ('catalog', 'video_metric_snapshots'),
        ('catalog', 'paper_details'), ('catalog', 'paper_authors'), ('catalog', 'paper_references'),
        ('catalog', 'resource_concepts'), ('catalog', 'collections'), ('catalog', 'collection_sections'),
        ('catalog', 'collection_items'), ('catalog', 'collection_enrollments'), ('catalog', 'library_items'),
        ('study', 'learning_goals'), ('study', 'study_sessions'), ('study', 'session_resources'),
        ('study', 'session_context_snapshots'), ('study', 'session_checkpoints'),
        ('study', 'user_resource_progress'), ('study', 'focus_sessions'), ('study', 'schedule_items'),
        ('study', 'tutor_threads'), ('study', 'tutor_messages'), ('activity', 'activity_events'),
        ('retrieval', 'resource_chunks'), ('retrieval', 'chunk_embeddings'), ('retrieval', 'embedding_profiles'),
        ('retrieval', 'chunk_concepts'), ('retrieval', 'ingestion_runs'), ('retrieval', 'retrieval_runs'),
        ('retrieval', 'retrieved_chunks'), ('retrieval', 'citations'), ('practice', 'exercises'),
        ('practice', 'exercise_versions'), ('practice', 'test_bundles'), ('practice', 'exercise_bindings'),
        ('practice', 'exercise_examples'), ('practice', 'exercise_attempts'), ('practice', 'code_snapshots'),
        ('practice', 'execution_runs'), ('practice', 'observer_diagnostics'), ('practice', 'hint_events'),
        ('knowledge', 'concepts'), ('knowledge', 'concept_aliases'), ('knowledge', 'concept_relations'),
        ('knowledge', 'mastery_signals'), ('knowledge', 'concept_mastery'), ('knowledge', 'review_schedules'),
        ('knowledge', 'artifact_details'), ('knowledge', 'artifact_sources'), ('knowledge', 'artifact_concepts'),
        ('agent', 'agent_runs'), ('agent', 'agent_steps'), ('agent', 'tool_invocations'),
        ('agent', 'model_invocations'), ('agent', 'agent_artifacts'), ('discovery', 'recommendation_runs'),
        ('discovery', 'recommendation_candidates'), ('discovery', 'recommendation_impressions'),
        ('discovery', 'discovery_interactions'), ('discovery', 'user_concept_affinity'),
        ('projection', 'dashboard_state'), ('projection', 'user_learning_daily'), ('projection', 'session_summary'),
        ('ops', 'idempotency_records'), ('ops', 'outbox_events'), ('ops', 'jobs')
    )
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
END;
$$;
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
  expected_runtime_image text;
  expected_bundle_hash char(64);
  expected_cpu_limit integer;
  expected_wall_limit integer;
  expected_memory_limit bigint;
BEGIN
  SELECT a.exercise_version_id,
         cs.attempt_id,
         tb.exercise_version_id,
         tb.runtime_image_digest,
         tb.sha256,
         (tb.resource_limits ->> 'cpuLimitMs')::integer,
         (tb.resource_limits ->> 'wallLimitMs')::integer,
         (tb.resource_limits ->> 'memoryLimitBytes')::bigint
    INTO attempt_version_id,
         snapshot_attempt_id,
         bundle_version_id,
         expected_runtime_image,
         expected_bundle_hash,
         expected_cpu_limit,
         expected_wall_limit,
         expected_memory_limit
  FROM practice.exercise_attempts AS a
  JOIN practice.code_snapshots AS cs ON cs.id = NEW.code_snapshot_id
  JOIN practice.test_bundles AS tb ON tb.id = NEW.test_bundle_id
  WHERE a.id = NEW.attempt_id;
  IF NOT FOUND OR snapshot_attempt_id IS DISTINCT FROM NEW.attempt_id OR bundle_version_id IS DISTINCT FROM attempt_version_id THEN
    RAISE EXCEPTION 'execution references do not belong to the attempt exercise version' USING ERRCODE = '23514';
  END IF;
  IF expected_cpu_limit IS NULL OR expected_wall_limit IS NULL OR expected_memory_limit IS NULL
     OR expected_cpu_limit <= 0 OR expected_wall_limit <= 0 OR expected_memory_limit <= 0 THEN
    RAISE EXCEPTION 'test bundle resource limits are invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_sha256 IS DISTINCT FROM (SELECT source_sha256 FROM practice.code_snapshots WHERE id = NEW.code_snapshot_id)
     OR NEW.test_bundle_sha256 IS DISTINCT FROM expected_bundle_hash
     OR NEW.runtime_image_digest IS DISTINCT FROM expected_runtime_image
     OR NEW.cpu_limit_ms IS DISTINCT FROM expected_cpu_limit
     OR NEW.wall_limit_ms IS DISTINCT FROM expected_wall_limit
     OR NEW.memory_limit_bytes IS DISTINCT FROM expected_memory_limit THEN
    RAISE EXCEPTION 'execution policy or content hash does not match trusted inputs' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF session_user NOT IN ('learnspace_app', 'learnspace_migrator') THEN
      RAISE EXCEPTION 'only the application enqueue boundary may create execution requests' USING ERRCODE = '42501';
    END IF;
    IF session_user = 'learnspace_app' AND (
      NEW.runner_pool IS DISTINCT FROM 'learnspace-default'
      OR NEW.status IS DISTINCT FROM 'queued'
      OR NEW.result IS DISTINCT FROM '{}'::jsonb
      OR NEW.exit_code IS NOT NULL OR NEW.signal IS NOT NULL OR NEW.cpu_time_ms IS NOT NULL
      OR NEW.wall_time_ms IS NOT NULL OR NEW.peak_memory_bytes IS NOT NULL
      OR NEW.passed_case_count IS NOT NULL OR NEW.total_case_count IS NOT NULL
      OR NEW.stdout_excerpt IS NOT NULL OR NEW.stderr_excerpt IS NOT NULL
      OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'execution request contains runner-owned fields' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF session_user NOT IN ('learnspace_runner', 'learnspace_migrator') THEN
      RAISE EXCEPTION 'only the runner may mutate execution results' USING ERRCODE = '42501';
    END IF;
    IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.code_snapshot_id IS DISTINCT FROM OLD.code_snapshot_id
       OR NEW.test_bundle_id IS DISTINCT FROM OLD.test_bundle_id
       OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.runner_pool IS DISTINCT FROM OLD.runner_pool
       OR NEW.runtime_image_digest IS DISTINCT FROM OLD.runtime_image_digest
       OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
       OR NEW.test_bundle_sha256 IS DISTINCT FROM OLD.test_bundle_sha256
       OR NEW.cpu_limit_ms IS DISTINCT FROM OLD.cpu_limit_ms
       OR NEW.wall_limit_ms IS DISTINCT FROM OLD.wall_limit_ms
       OR NEW.memory_limit_bytes IS DISTINCT FROM OLD.memory_limit_bytes
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'execution request policy is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS execution_runs_hashes_trg ON practice.execution_runs;
CREATE TRIGGER execution_runs_hashes_trg
BEFORE INSERT OR UPDATE ON practice.execution_runs
FOR EACH ROW
EXECUTE FUNCTION practice.validate_execution_run_hashes();
CREATE OR REPLACE FUNCTION practice.validate_attempt_binding_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, practice
AS $$
DECLARE
  binding_session_id uuid;
  binding_version_id uuid;
BEGIN
  SELECT eb.study_session_id, eb.exercise_version_id
    INTO binding_session_id, binding_version_id
  FROM practice.exercise_bindings AS eb
  WHERE eb.id = NEW.exercise_binding_id;
  IF NOT FOUND OR binding_version_id IS DISTINCT FROM NEW.exercise_version_id THEN
    RAISE EXCEPTION 'attempt binding and exercise version do not match' USING ERRCODE = '23514';
  END IF;
  IF binding_session_id IS NOT NULL AND binding_session_id IS DISTINCT FROM NEW.study_session_id THEN
    RAISE EXCEPTION 'attempt session does not match exercise binding session' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS exercise_attempts_binding_context_trg ON practice.exercise_attempts;
CREATE TRIGGER exercise_attempts_binding_context_trg
BEFORE INSERT OR UPDATE OF exercise_binding_id, exercise_version_id, study_session_id ON practice.exercise_attempts
FOR EACH ROW
EXECUTE FUNCTION practice.validate_attempt_binding_context();
CREATE OR REPLACE FUNCTION knowledge.validate_mastery_signal_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, knowledge, activity
AS $$
DECLARE
  source_user_id uuid;
  source_session_id uuid;
BEGIN
  SELECT ae.user_id, ae.study_session_id
    INTO source_user_id, source_session_id
  FROM activity.activity_events AS ae
  WHERE ae.id = NEW.source_event_id;
  IF NOT FOUND OR source_user_id IS DISTINCT FROM NEW.user_id OR source_session_id IS DISTINCT FROM NEW.study_session_id THEN
    RAISE EXCEPTION 'mastery signal source event does not match user and session' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mastery_signals_source_trg ON knowledge.mastery_signals;
CREATE TRIGGER mastery_signals_source_trg
BEFORE INSERT OR UPDATE ON knowledge.mastery_signals
FOR EACH ROW
EXECUTE FUNCTION knowledge.validate_mastery_signal_source();
CREATE OR REPLACE FUNCTION ops.enforce_outbox_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ops
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF session_user NOT IN ('learnspace_app', 'learnspace_migrator') THEN
      RAISE EXCEPTION 'only the application may append outbox events' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'pending'
       OR NEW.attempts IS DISTINCT FROM 0
       OR NEW.locked_by IS NOT NULL
       OR NEW.locked_at IS NOT NULL
       OR NEW.published_at IS NOT NULL
       OR NEW.last_error IS NOT NULL THEN
      RAISE EXCEPTION 'outbox events must start pending and unlocked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF session_user NOT IN ('learnspace_worker', 'learnspace_migrator') THEN
    RAISE EXCEPTION 'only the outbox worker may mutate delivery state' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
     OR NEW.aggregate_version IS DISTINCT FROM OLD.aggregate_version
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.study_session_id IS DISTINCT FROM OLD.study_session_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbox event payload is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS outbox_events_append_only_trg ON ops.outbox_events;
CREATE TRIGGER outbox_events_append_only_trg
BEFORE INSERT OR UPDATE ON ops.outbox_events
FOR EACH ROW
EXECUTE FUNCTION ops.enforce_outbox_append_only();
CREATE OR REPLACE FUNCTION practice.enqueue_execution(
  p_attempt_id uuid,
  p_code_snapshot_id uuid,
  p_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, practice
AS $$
DECLARE
  caller_user_id uuid;
  attempt_user_id uuid;
  attempt_version_id uuid;
  snapshot_attempt_id uuid;
  bundle_id uuid;
  bundle_runtime_image text;
  bundle_hash char(64);
  bundle_cpu_limit integer;
  bundle_wall_limit integer;
  bundle_memory_limit bigint;
  resolved_request_id uuid;
  execution_id uuid;
  existing_attempt_id uuid;
  existing_snapshot_id uuid;
BEGIN
  IF session_user <> 'learnspace_app' THEN
    RAISE EXCEPTION 'execution requests must use the application enqueue boundary' USING ERRCODE = '42501';
  END IF;
  caller_user_id := NULLIF(current_setting('app.user_id', true), '')::uuid;
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'app.user_id is required to enqueue execution' USING ERRCODE = '42501';
  END IF;
  SELECT a.user_id, a.exercise_version_id, cs.attempt_id
    INTO attempt_user_id, attempt_version_id, snapshot_attempt_id
  FROM practice.exercise_attempts AS a
  JOIN practice.code_snapshots AS cs ON cs.id = p_code_snapshot_id
  WHERE a.id = p_attempt_id;
  IF NOT FOUND OR attempt_user_id IS DISTINCT FROM caller_user_id OR snapshot_attempt_id IS DISTINCT FROM p_attempt_id THEN
    RAISE EXCEPTION 'execution attempt is not owned by the current user or snapshot is unrelated' USING ERRCODE = '42501';
  END IF;
  SELECT tb.id,
         tb.runtime_image_digest,
         tb.sha256,
         (tb.resource_limits ->> 'cpuLimitMs')::integer,
         (tb.resource_limits ->> 'wallLimitMs')::integer,
         (tb.resource_limits ->> 'memoryLimitBytes')::bigint
    INTO bundle_id,
         bundle_runtime_image,
         bundle_hash,
         bundle_cpu_limit,
         bundle_wall_limit,
         bundle_memory_limit
  FROM practice.test_bundles AS tb
  WHERE tb.exercise_version_id = attempt_version_id
    AND tb.kind = 'hidden'
  ORDER BY tb.created_at DESC, tb.id DESC
  LIMIT 1;
  IF NOT FOUND OR bundle_cpu_limit IS NULL OR bundle_wall_limit IS NULL OR bundle_memory_limit IS NULL
     OR bundle_cpu_limit <= 0 OR bundle_wall_limit <= 0 OR bundle_memory_limit <= 0 THEN
    RAISE EXCEPTION 'a valid hidden execution policy is unavailable' USING ERRCODE = '42501';
  END IF;
  resolved_request_id := coalesce(p_request_id, public.gen_random_uuid());
  INSERT INTO practice.execution_runs (
    attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool,
    runtime_image_digest, source_sha256, test_bundle_sha256,
    cpu_limit_ms, wall_limit_ms, memory_limit_bytes, result
  )
  SELECT p_attempt_id,
         p_code_snapshot_id,
         bundle_id,
         resolved_request_id,
         'queued',
         'learnspace-default',
         bundle_runtime_image,
         cs.source_sha256,
         bundle_hash,
         bundle_cpu_limit,
         bundle_wall_limit,
         bundle_memory_limit,
         '{}'::jsonb
  FROM practice.code_snapshots AS cs
  WHERE cs.id = p_code_snapshot_id
  ON CONFLICT (request_id) DO NOTHING
  RETURNING id INTO execution_id;
  IF execution_id IS NULL THEN
    SELECT er.id, er.attempt_id, er.code_snapshot_id
      INTO execution_id, existing_attempt_id, existing_snapshot_id
    FROM practice.execution_runs AS er
    WHERE er.request_id = resolved_request_id;
    IF NOT FOUND OR existing_attempt_id IS DISTINCT FROM p_attempt_id OR existing_snapshot_id IS DISTINCT FROM p_code_snapshot_id THEN
      RAISE EXCEPTION 'execution request id was reused for a different request' USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN execution_id;
END;
$$;
REVOKE ALL ON FUNCTION practice.enqueue_execution(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION practice.enqueue_execution(uuid, uuid, uuid) TO learnspace_app;
REVOKE ALL ON TABLE catalog.resources, catalog.resource_versions, catalog.resource_assets, catalog.authors,
  catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.paper_authors,
  catalog.paper_references, catalog.resource_concepts, catalog.collections, catalog.collection_sections,
  catalog.collection_items, catalog.collection_enrollments, catalog.library_items
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.resources, catalog.collections TO learnspace_app;
GRANT SELECT ON TABLE catalog.resources, catalog.collections, catalog.resource_versions, catalog.resource_assets,
  catalog.authors, catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details,
  catalog.paper_authors, catalog.paper_references, catalog.resource_concepts TO learnspace_app, learnspace_ai;
GRANT SELECT, INSERT, UPDATE ON TABLE catalog.resources, catalog.collections, catalog.resource_versions,
  catalog.resource_assets, catalog.authors, catalog.video_details, catalog.video_metric_snapshots,
  catalog.paper_details, catalog.paper_authors, catalog.paper_references, catalog.resource_concepts TO learnspace_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog.collection_sections, catalog.collection_items,
  catalog.collection_enrollments, catalog.library_items TO learnspace_app;
GRANT SELECT ON TABLE catalog.collection_sections, catalog.collection_items TO learnspace_app, learnspace_ai;
GRANT SELECT, INSERT, UPDATE ON TABLE catalog.collection_sections, catalog.collection_items TO learnspace_worker;
REVOKE INSERT, UPDATE, DELETE ON TABLE catalog.resource_versions, catalog.resource_assets, catalog.authors,
  catalog.video_details, catalog.video_metric_snapshots, catalog.paper_details, catalog.paper_authors,
  catalog.paper_references FROM learnspace_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE catalog.resources, catalog.collections FROM learnspace_ai;
ALTER TABLE catalog.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY resources_owner_or_visible_policy ON catalog.resources
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (owner_user_id::text = current_setting('app.user_id', true) OR visibility IN ('public', 'unlisted'));
CREATE POLICY resources_owner_insert_policy ON catalog.resources
  FOR INSERT TO learnspace_app
  WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY resources_owner_update_policy ON catalog.resources
  FOR UPDATE TO learnspace_app
  USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true))
  WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY resources_owner_delete_policy ON catalog.resources
  FOR DELETE TO learnspace_app
  USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY resources_worker_policy ON catalog.resources
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resources_worker_insert_policy ON catalog.resources
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resources_worker_update_policy ON catalog.resources
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.resource_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_versions_visible_policy ON catalog.resource_versions
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY resource_versions_worker_policy ON catalog.resource_versions
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resource_versions_worker_insert_policy ON catalog.resource_versions
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resource_versions_worker_update_policy ON catalog.resource_versions
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.resource_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_assets_visible_policy ON catalog.resource_assets
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resource_versions AS rv JOIN catalog.resources AS r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY resource_assets_worker_policy ON catalog.resource_assets
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resource_assets_worker_insert_policy ON catalog.resource_assets
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resource_assets_worker_update_policy ON catalog.resource_assets
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY authors_visible_policy ON catalog.authors
  FOR SELECT TO learnspace_app, learnspace_ai USING (true);
CREATE POLICY authors_worker_policy ON catalog.authors
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY authors_worker_insert_policy ON catalog.authors
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY authors_worker_update_policy ON catalog.authors
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.video_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY video_details_visible_policy ON catalog.video_details
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY video_details_worker_policy ON catalog.video_details
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY video_details_worker_insert_policy ON catalog.video_details
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY video_details_worker_update_policy ON catalog.video_details
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.video_metric_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY video_metric_snapshots_visible_policy ON catalog.video_metric_snapshots
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.video_details AS vd JOIN catalog.resources AS r ON r.id = vd.resource_id WHERE vd.resource_id = catalog.video_metric_snapshots.resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY video_metric_snapshots_worker_policy ON catalog.video_metric_snapshots
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY video_metric_snapshots_worker_insert_policy ON catalog.video_metric_snapshots
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY video_metric_snapshots_worker_update_policy ON catalog.video_metric_snapshots
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY paper_details_visible_policy ON catalog.paper_details
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY paper_details_worker_policy ON catalog.paper_details
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY paper_details_worker_insert_policy ON catalog.paper_details
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY paper_details_worker_update_policy ON catalog.paper_details
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY paper_authors_visible_policy ON catalog.paper_authors
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.paper_details AS p JOIN catalog.resources AS r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY paper_authors_worker_policy ON catalog.paper_authors
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY paper_authors_worker_insert_policy ON catalog.paper_authors
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY paper_authors_worker_update_policy ON catalog.paper_authors
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.paper_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY paper_references_visible_policy ON catalog.paper_references
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.paper_details AS p JOIN catalog.resources AS r ON r.id = p.resource_id WHERE p.resource_id = paper_resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY paper_references_worker_policy ON catalog.paper_references
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY paper_references_worker_insert_policy ON catalog.paper_references
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY paper_references_worker_update_policy ON catalog.paper_references
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.resource_concepts ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_concepts_visible_policy ON catalog.resource_concepts
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY resource_concepts_owner_insert_policy ON catalog.resource_concepts
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY resource_concepts_owner_update_policy ON catalog.resource_concepts
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY resource_concepts_owner_delete_policy ON catalog.resource_concepts
  FOR DELETE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND r.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY resource_concepts_worker_policy ON catalog.resource_concepts
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resource_concepts_worker_insert_policy ON catalog.resource_concepts
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resource_concepts_worker_update_policy ON catalog.resource_concepts
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY collections_owner_or_visible_policy ON catalog.collections
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (owner_user_id::text = current_setting('app.user_id', true) OR visibility IN ('public', 'unlisted'));
CREATE POLICY collections_owner_insert_policy ON catalog.collections
  FOR INSERT TO learnspace_app
  WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY collections_owner_update_policy ON catalog.collections
  FOR UPDATE TO learnspace_app
  USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true))
  WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY collections_owner_delete_policy ON catalog.collections
  FOR DELETE TO learnspace_app
  USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY collections_worker_policy ON catalog.collections
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY collections_worker_insert_policy ON catalog.collections
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY collections_worker_update_policy ON catalog.collections
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.collection_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_sections_visible_policy ON catalog.collection_sections
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (
    SELECT 1 FROM catalog.collections AS c
    WHERE c.id = collection_id
      AND (c.owner_user_id::text = current_setting('app.user_id', true) OR c.visibility IN ('public', 'unlisted'))
  ));
CREATE POLICY collection_sections_owner_insert_policy ON catalog.collection_sections
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (
    SELECT 1 FROM catalog.collections AS c
    WHERE c.id = collection_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ));
CREATE POLICY collection_sections_owner_update_policy ON catalog.collection_sections
  FOR UPDATE TO learnspace_app
  USING (EXISTS (
    SELECT 1 FROM catalog.collections AS c
    WHERE c.id = collection_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM catalog.collections AS c
    WHERE c.id = collection_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ));
CREATE POLICY collection_sections_owner_delete_policy ON catalog.collection_sections
  FOR DELETE TO learnspace_app
  USING (EXISTS (
    SELECT 1 FROM catalog.collections AS c
    WHERE c.id = collection_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ));
CREATE POLICY collection_sections_worker_policy ON catalog.collection_sections
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY collection_sections_worker_insert_policy ON catalog.collection_sections
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY collection_sections_worker_update_policy ON catalog.collection_sections
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.collection_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_items_visible_policy ON catalog.collection_items
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (
    SELECT 1
    FROM catalog.collection_sections AS cs
    JOIN catalog.collections AS c ON c.id = cs.collection_id
    JOIN catalog.resources AS r ON r.id = collection_items.resource_id
    WHERE cs.id = section_id
      AND (c.owner_user_id::text = current_setting('app.user_id', true) OR c.visibility IN ('public', 'unlisted'))
      AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))
  ));
CREATE POLICY collection_items_owner_insert_policy ON catalog.collection_items
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (
    SELECT 1 FROM catalog.collection_sections AS cs
    JOIN catalog.collections AS c ON c.id = cs.collection_id
    WHERE cs.id = section_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ));
CREATE POLICY collection_items_owner_update_policy ON catalog.collection_items
  FOR UPDATE TO learnspace_app
  USING (EXISTS (
    SELECT 1 FROM catalog.collection_sections AS cs
    JOIN catalog.collections AS c ON c.id = cs.collection_id
    WHERE cs.id = section_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM catalog.collection_sections AS cs
    JOIN catalog.collections AS c ON c.id = cs.collection_id
    WHERE cs.id = section_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ));
CREATE POLICY collection_items_owner_delete_policy ON catalog.collection_items
  FOR DELETE TO learnspace_app
  USING (EXISTS (
    SELECT 1 FROM catalog.collection_sections AS cs
    JOIN catalog.collections AS c ON c.id = cs.collection_id
    WHERE cs.id = section_id AND c.owner_user_id IS NOT NULL
      AND c.owner_user_id::text = current_setting('app.user_id', true)
  ));
CREATE POLICY collection_items_worker_policy ON catalog.collection_items
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY collection_items_worker_insert_policy ON catalog.collection_items
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY collection_items_worker_update_policy ON catalog.collection_items
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE catalog.collection_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_enrollments_owner_policy ON catalog.collection_enrollments
  FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY collection_enrollments_owner_insert_policy ON catalog.collection_enrollments
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY collection_enrollments_owner_update_policy ON catalog.collection_enrollments
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY collection_enrollments_owner_delete_policy ON catalog.collection_enrollments
  FOR DELETE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE catalog.library_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY library_items_owner_policy ON catalog.library_items
  FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY library_items_owner_insert_policy ON catalog.library_items
  FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY library_items_owner_update_policy ON catalog.library_items
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY library_items_owner_delete_policy ON catalog.library_items
  FOR DELETE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
REVOKE ALL ON TABLE study.learning_goals, study.study_sessions, study.session_resources,
  study.session_context_snapshots, study.session_checkpoints, study.user_resource_progress,
  study.focus_sessions, study.schedule_items, study.tutor_threads, study.tutor_messages
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE study.learning_goals TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE study.study_sessions, study.session_resources,
  study.session_context_snapshots, study.session_checkpoints, study.tutor_threads, study.tutor_messages TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE study.user_resource_progress, study.focus_sessions, study.schedule_items TO learnspace_app;
GRANT SELECT ON TABLE study.learning_goals, study.study_sessions, study.session_resources,
  study.session_context_snapshots, study.session_checkpoints, study.user_resource_progress,
  study.focus_sessions, study.schedule_items, study.tutor_threads, study.tutor_messages TO learnspace_ai;
GRANT SELECT ON TABLE study.study_sessions, study.session_resources, study.session_context_snapshots,
  study.session_checkpoints, study.tutor_threads, study.tutor_messages TO learnspace_worker;
ALTER TABLE study.learning_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY learning_goals_owner_policy ON study.learning_goals
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY learning_goals_owner_insert_policy ON study.learning_goals
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY learning_goals_owner_update_policy ON study.learning_goals
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY learning_goals_owner_delete_policy ON study.learning_goals
  FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY study_sessions_owner_policy ON study.study_sessions
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY study_sessions_owner_insert_policy ON study.study_sessions
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY study_sessions_owner_update_policy ON study.study_sessions
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY study_sessions_worker_policy ON study.study_sessions
  FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.session_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_resources_owner_policy ON study.session_resources
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_resources_owner_insert_policy ON study.session_resources
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_resources_owner_update_policy ON study.session_resources
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_resources_worker_policy ON study.session_resources
  FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.session_context_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_snapshots_owner_policy ON study.session_context_snapshots
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_snapshots_owner_insert_policy ON study.session_context_snapshots
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_snapshots_owner_update_policy ON study.session_context_snapshots
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_snapshots_worker_policy ON study.session_context_snapshots
  FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.session_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_checkpoints_owner_policy ON study.session_checkpoints
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_checkpoints_owner_insert_policy ON study.session_checkpoints
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_checkpoints_owner_update_policy ON study.session_checkpoints
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY session_checkpoints_worker_policy ON study.session_checkpoints
  FOR SELECT TO learnspace_worker USING (true);
ALTER TABLE study.user_resource_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_resource_progress_owner_policy ON study.user_resource_progress
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_resource_progress_owner_insert_policy ON study.user_resource_progress
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_resource_progress_owner_update_policy ON study.user_resource_progress
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_resource_progress_owner_delete_policy ON study.user_resource_progress
  FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.focus_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY focus_sessions_owner_policy ON study.focus_sessions
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY focus_sessions_owner_insert_policy ON study.focus_sessions
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY focus_sessions_owner_update_policy ON study.focus_sessions
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY focus_sessions_owner_delete_policy ON study.focus_sessions
  FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.schedule_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedule_items_owner_policy ON study.schedule_items
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY schedule_items_owner_insert_policy ON study.schedule_items
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY schedule_items_owner_update_policy ON study.schedule_items
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY schedule_items_owner_delete_policy ON study.schedule_items
  FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.tutor_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tutor_threads_owner_policy ON study.tutor_threads
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY tutor_threads_owner_insert_policy ON study.tutor_threads
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY tutor_threads_owner_update_policy ON study.tutor_threads
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE study.tutor_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tutor_messages_owner_policy ON study.tutor_messages
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM study.tutor_threads AS t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY tutor_messages_owner_insert_policy ON study.tutor_messages
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM study.tutor_threads AS t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY tutor_messages_owner_update_policy ON study.tutor_messages
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM study.tutor_threads AS t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM study.tutor_threads AS t WHERE t.id = thread_id AND t.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE activity.activity_events ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE ON TABLE activity.activity_events FROM learnspace_app, learnspace_ai, learnspace_worker;
GRANT SELECT, INSERT ON TABLE activity.activity_events TO learnspace_app, learnspace_worker;
GRANT SELECT ON TABLE activity.activity_events TO learnspace_ai;
CREATE POLICY activity_events_owner_policy ON activity.activity_events
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY activity_events_owner_insert_policy ON activity.activity_events
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY activity_events_worker_policy ON activity.activity_events
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY activity_events_worker_insert_policy ON activity.activity_events
  FOR INSERT TO learnspace_worker WITH CHECK (true);
REVOKE ALL ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles,
  retrieval.chunk_concepts, retrieval.ingestion_runs, retrieval.retrieval_runs,
  retrieval.retrieved_chunks, retrieval.citations
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings, retrieval.embedding_profiles,
  retrieval.chunk_concepts, retrieval.ingestion_runs, retrieval.retrieval_runs,
  retrieval.retrieved_chunks, retrieval.citations TO learnspace_app, learnspace_ai;
GRANT INSERT ON TABLE retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations TO learnspace_app, learnspace_ai;
GRANT SELECT, INSERT, UPDATE ON TABLE retrieval.resource_chunks, retrieval.chunk_embeddings,
  retrieval.embedding_profiles, retrieval.chunk_concepts, retrieval.ingestion_runs,
  retrieval.retrieval_runs, retrieval.retrieved_chunks, retrieval.citations TO learnspace_worker;
ALTER TABLE retrieval.resource_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_chunks_visible_policy ON retrieval.resource_chunks
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resource_versions AS rv JOIN catalog.resources AS r ON r.id = rv.resource_id WHERE rv.id = resource_version_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY resource_chunks_worker_policy ON retrieval.resource_chunks
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resource_chunks_worker_insert_policy ON retrieval.resource_chunks
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resource_chunks_worker_update_policy ON retrieval.resource_chunks
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.chunk_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY chunk_embeddings_visible_policy ON retrieval.chunk_embeddings
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM retrieval.resource_chunks AS c JOIN catalog.resource_versions AS rv ON rv.id = c.resource_version_id JOIN catalog.resources AS r ON r.id = rv.resource_id WHERE c.id = chunk_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY chunk_embeddings_worker_policy ON retrieval.chunk_embeddings
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY chunk_embeddings_worker_insert_policy ON retrieval.chunk_embeddings
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY chunk_embeddings_worker_update_policy ON retrieval.chunk_embeddings
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.embedding_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY embedding_profiles_visible_policy ON retrieval.embedding_profiles
  FOR SELECT TO learnspace_app, learnspace_ai USING (true);
CREATE POLICY embedding_profiles_worker_policy ON retrieval.embedding_profiles
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY embedding_profiles_worker_insert_policy ON retrieval.embedding_profiles
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY embedding_profiles_worker_update_policy ON retrieval.embedding_profiles
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.chunk_concepts ENABLE ROW LEVEL SECURITY;
CREATE POLICY chunk_concepts_visible_policy ON retrieval.chunk_concepts
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM retrieval.resource_chunks AS c JOIN catalog.resource_versions AS rv ON rv.id = c.resource_version_id JOIN catalog.resources AS r ON r.id = rv.resource_id WHERE c.id = chunk_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY chunk_concepts_worker_policy ON retrieval.chunk_concepts
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY chunk_concepts_worker_insert_policy ON retrieval.chunk_concepts
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY chunk_concepts_worker_update_policy ON retrieval.chunk_concepts
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.ingestion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ingestion_runs_visible_policy ON retrieval.ingestion_runs
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY ingestion_runs_worker_policy ON retrieval.ingestion_runs
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY ingestion_runs_worker_insert_policy ON retrieval.ingestion_runs
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY ingestion_runs_worker_update_policy ON retrieval.ingestion_runs
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.retrieval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY retrieval_runs_owner_policy ON retrieval.retrieval_runs
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY retrieval_runs_owner_insert_policy ON retrieval.retrieval_runs
  FOR INSERT TO learnspace_app, learnspace_ai
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY retrieval_runs_worker_policy ON retrieval.retrieval_runs
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY retrieval_runs_worker_insert_policy ON retrieval.retrieval_runs
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY retrieval_runs_worker_update_policy ON retrieval.retrieval_runs
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.retrieved_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY retrieved_chunks_owner_policy ON retrieval.retrieved_chunks
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY retrieved_chunks_owner_insert_policy ON retrieval.retrieved_chunks
  FOR INSERT TO learnspace_app, learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY retrieved_chunks_worker_policy ON retrieval.retrieved_chunks
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY retrieved_chunks_worker_insert_policy ON retrieval.retrieved_chunks
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY retrieved_chunks_worker_update_policy ON retrieval.retrieved_chunks
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE retrieval.citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY citations_owner_policy ON retrieval.citations
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY citations_owner_insert_policy ON retrieval.citations
  FOR INSERT TO learnspace_app, learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM retrieval.retrieval_runs AS r WHERE r.id = retrieval_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY citations_worker_policy ON retrieval.citations
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY citations_worker_insert_policy ON retrieval.citations
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY citations_worker_update_policy ON retrieval.citations
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE practice.exercises, practice.exercise_versions, practice.exercise_bindings,
  practice.exercise_examples, practice.exercise_attempts, practice.code_snapshots,
  practice.test_bundles, practice.execution_runs, practice.observer_diagnostics, practice.hint_events
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE practice.exercises, practice.exercise_bindings,
  practice.exercise_examples TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE practice.exercise_attempts, practice.code_snapshots TO learnspace_app;
GRANT SELECT, INSERT ON TABLE practice.hint_events TO learnspace_app;
GRANT SELECT ON TABLE practice.observer_diagnostics TO learnspace_app;
GRANT SELECT ON TABLE practice.exercises, practice.exercise_bindings, practice.exercise_examples,
  practice.exercise_attempts, practice.code_snapshots, practice.observer_diagnostics, practice.hint_events TO learnspace_ai;
GRANT SELECT (id, exercise_id, version_no, language, runtime_family, difficulty, prompt_md, starter_code,
  function_signature, constraints, content_sha256, generator_model, generator_version,
  validation_status, created_at) ON TABLE practice.exercise_versions TO learnspace_app, learnspace_ai;
GRANT SELECT, INSERT, UPDATE ON TABLE practice.exercises, practice.exercise_versions,
  practice.exercise_bindings, practice.exercise_examples, practice.exercise_attempts,
  practice.code_snapshots, practice.test_bundles, practice.observer_diagnostics, practice.hint_events TO learnspace_worker;
GRANT SELECT ON TABLE practice.test_bundles, practice.exercise_attempts, practice.code_snapshots TO learnspace_runner;
GRANT SELECT ON TABLE practice.execution_runs TO learnspace_runner;
GRANT UPDATE (status, exit_code, signal, cpu_time_ms, wall_time_ms, peak_memory_bytes,
  passed_case_count, total_case_count, stdout_excerpt, stderr_excerpt, result,
  started_at, completed_at) ON TABLE practice.execution_runs TO learnspace_runner;
GRANT SELECT (id, request_id, status, exit_code, signal, cpu_time_ms, wall_time_ms,
  peak_memory_bytes, passed_case_count, total_case_count, stdout_excerpt,
  stderr_excerpt, result, started_at, completed_at, created_at) ON TABLE practice.execution_runs TO learnspace_app, learnspace_ai;
ALTER TABLE practice.exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY exercises_select_policy ON practice.exercises
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (owner_user_id IS NULL OR owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_insert_policy ON practice.exercises
  FOR INSERT TO learnspace_app
  WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_update_policy ON practice.exercises
  FOR UPDATE TO learnspace_app
  USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true))
  WITH CHECK (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_delete_policy ON practice.exercises
  FOR DELETE TO learnspace_app
  USING (owner_user_id IS NOT NULL AND owner_user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercises_worker_publication_policy ON practice.exercises
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY exercises_worker_insert_policy ON practice.exercises
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY exercises_worker_update_policy ON practice.exercises
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.exercise_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY exercise_versions_visible_policy ON practice.exercise_versions
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM practice.exercises AS e WHERE e.id = exercise_id AND (e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true))));
CREATE POLICY exercise_versions_worker_policy ON practice.exercise_versions
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY exercise_versions_worker_insert_policy ON practice.exercise_versions
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY exercise_versions_worker_update_policy ON practice.exercise_versions
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.test_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY test_bundles_worker_policy ON practice.test_bundles
  FOR SELECT TO learnspace_worker, learnspace_runner USING (true);
CREATE POLICY test_bundles_worker_insert_policy ON practice.test_bundles
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY test_bundles_worker_update_policy ON practice.test_bundles
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.exercise_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY exercise_bindings_owner_policy ON practice.exercise_bindings
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_bindings_owner_insert_policy ON practice.exercise_bindings
  FOR INSERT TO learnspace_app
  WITH CHECK (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_bindings_owner_update_policy ON practice.exercise_bindings
  FOR UPDATE TO learnspace_app
  USING (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_bindings_owner_delete_policy ON practice.exercise_bindings
  FOR DELETE TO learnspace_app
  USING (study_session_id IS NULL OR EXISTS (SELECT 1 FROM study.study_sessions AS s WHERE s.id = study_session_id AND s.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_bindings_worker_policy ON practice.exercise_bindings
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY exercise_bindings_worker_insert_policy ON practice.exercise_bindings
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY exercise_bindings_worker_update_policy ON practice.exercise_bindings
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.exercise_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY exercise_examples_visible_policy ON practice.exercise_examples
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND (e.owner_user_id IS NULL OR e.owner_user_id::text = current_setting('app.user_id', true))));
CREATE POLICY exercise_examples_owner_insert_policy ON practice.exercise_examples
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND e.owner_user_id IS NOT NULL AND e.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_examples_owner_update_policy ON practice.exercise_examples
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND e.owner_user_id IS NOT NULL AND e.owner_user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND e.owner_user_id IS NOT NULL AND e.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_examples_owner_delete_policy ON practice.exercise_examples
  FOR DELETE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM practice.exercise_versions AS ev JOIN practice.exercises AS e ON e.id = ev.exercise_id WHERE ev.id = exercise_version_id AND e.owner_user_id IS NOT NULL AND e.owner_user_id::text = current_setting('app.user_id', true)));
CREATE POLICY exercise_examples_worker_policy ON practice.exercise_examples
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY exercise_examples_worker_insert_policy ON practice.exercise_examples
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY exercise_examples_worker_update_policy ON practice.exercise_examples
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.exercise_attempts ENABLE ROW LEVEL SECURITY;
REVOKE DELETE ON TABLE practice.exercise_attempts, practice.code_snapshots, practice.hint_events FROM learnspace_app, learnspace_ai, learnspace_worker;
CREATE POLICY exercise_attempts_owner_policy ON practice.exercise_attempts
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercise_attempts_owner_insert_policy ON practice.exercise_attempts
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercise_attempts_owner_update_policy ON practice.exercise_attempts
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY exercise_attempts_worker_policy ON practice.exercise_attempts
  FOR SELECT TO learnspace_worker, learnspace_runner USING (true);
ALTER TABLE practice.code_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY code_snapshots_owner_policy ON practice.code_snapshots
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY code_snapshots_owner_insert_policy ON practice.code_snapshots
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY code_snapshots_owner_update_policy ON practice.code_snapshots
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY code_snapshots_worker_policy ON practice.code_snapshots
  FOR SELECT TO learnspace_worker, learnspace_runner USING (true);
ALTER TABLE practice.observer_diagnostics ENABLE ROW LEVEL SECURITY;
CREATE POLICY observer_diagnostics_owner_policy ON practice.observer_diagnostics
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY observer_diagnostics_ai_insert_policy ON practice.observer_diagnostics
  FOR INSERT TO learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY observer_diagnostics_worker_policy ON practice.observer_diagnostics
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY observer_diagnostics_worker_insert_policy ON practice.observer_diagnostics
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY observer_diagnostics_worker_update_policy ON practice.observer_diagnostics
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE practice.hint_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY hint_events_owner_policy ON practice.hint_events
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY hint_events_owner_insert_policy ON practice.hint_events
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY hint_events_worker_policy ON practice.hint_events
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY hint_events_worker_insert_policy ON practice.hint_events
  FOR INSERT TO learnspace_worker WITH CHECK (true);
ALTER TABLE practice.execution_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY execution_runs_app_select_policy ON practice.execution_runs
  FOR SELECT TO learnspace_app
  USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY execution_runs_ai_select_policy ON practice.execution_runs
  FOR SELECT TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM practice.exercise_attempts AS a WHERE a.id = attempt_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY execution_runs_runner_select_policy ON practice.execution_runs
  FOR SELECT TO learnspace_runner USING (true);
CREATE POLICY execution_runs_runner_update_policy ON practice.execution_runs
  FOR UPDATE TO learnspace_runner USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE knowledge.concepts, knowledge.concept_aliases, knowledge.concept_relations,
  knowledge.mastery_signals, knowledge.concept_mastery, knowledge.review_schedules,
  knowledge.artifact_details, knowledge.artifact_sources, knowledge.artifact_concepts
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT ON TABLE knowledge.concepts, knowledge.concept_aliases, knowledge.concept_relations,
  knowledge.mastery_signals, knowledge.concept_mastery, knowledge.review_schedules,
  knowledge.artifact_details, knowledge.artifact_sources, knowledge.artifact_concepts TO learnspace_app, learnspace_ai;
GRANT INSERT, UPDATE, DELETE ON TABLE knowledge.review_schedules TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE knowledge.artifact_details, knowledge.artifact_sources,
  knowledge.artifact_concepts TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE knowledge.concepts, knowledge.concept_aliases,
  knowledge.concept_relations, knowledge.mastery_signals, knowledge.concept_mastery,
  knowledge.review_schedules, knowledge.artifact_details, knowledge.artifact_sources,
  knowledge.artifact_concepts TO learnspace_worker;
ALTER TABLE knowledge.concepts ENABLE ROW LEVEL SECURITY;
CREATE POLICY concepts_visible_policy ON knowledge.concepts
  FOR SELECT TO learnspace_app, learnspace_ai, learnspace_worker USING (true);
CREATE POLICY concepts_worker_insert_policy ON knowledge.concepts
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY concepts_worker_update_policy ON knowledge.concepts
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.concept_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY concept_aliases_visible_policy ON knowledge.concept_aliases
  FOR SELECT TO learnspace_app, learnspace_ai, learnspace_worker USING (true);
CREATE POLICY concept_aliases_worker_insert_policy ON knowledge.concept_aliases
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY concept_aliases_worker_update_policy ON knowledge.concept_aliases
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.concept_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY concept_relations_visible_policy ON knowledge.concept_relations
  FOR SELECT TO learnspace_app, learnspace_ai, learnspace_worker USING (true);
CREATE POLICY concept_relations_worker_insert_policy ON knowledge.concept_relations
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY concept_relations_worker_update_policy ON knowledge.concept_relations
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.mastery_signals ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON TABLE knowledge.mastery_signals FROM learnspace_app, learnspace_ai;
REVOKE UPDATE, DELETE ON TABLE knowledge.mastery_signals FROM learnspace_worker;
CREATE POLICY mastery_signals_owner_policy ON knowledge.mastery_signals
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY mastery_signals_worker_policy ON knowledge.mastery_signals
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY mastery_signals_worker_insert_policy ON knowledge.mastery_signals
  FOR INSERT TO learnspace_worker WITH CHECK (true);
ALTER TABLE knowledge.concept_mastery ENABLE ROW LEVEL SECURITY;
CREATE POLICY concept_mastery_owner_policy ON knowledge.concept_mastery
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY concept_mastery_worker_policy ON knowledge.concept_mastery
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY concept_mastery_worker_insert_policy ON knowledge.concept_mastery
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY concept_mastery_worker_update_policy ON knowledge.concept_mastery
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.review_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_schedules_owner_policy ON knowledge.review_schedules
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY review_schedules_owner_insert_policy ON knowledge.review_schedules
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY review_schedules_owner_update_policy ON knowledge.review_schedules
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY review_schedules_owner_delete_policy ON knowledge.review_schedules
  FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY review_schedules_worker_policy ON knowledge.review_schedules
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY review_schedules_worker_insert_policy ON knowledge.review_schedules
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY review_schedules_worker_update_policy ON knowledge.review_schedules
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.artifact_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY artifact_details_owner_policy ON knowledge.artifact_details
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY artifact_details_owner_insert_policy ON knowledge.artifact_details
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY artifact_details_owner_update_policy ON knowledge.artifact_details
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY artifact_details_worker_policy ON knowledge.artifact_details
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY artifact_details_worker_insert_policy ON knowledge.artifact_details
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY artifact_details_worker_update_policy ON knowledge.artifact_details
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.artifact_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY artifact_sources_owner_policy ON knowledge.artifact_sources
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY artifact_sources_owner_insert_policy ON knowledge.artifact_sources
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY artifact_sources_owner_update_policy ON knowledge.artifact_sources
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY artifact_sources_worker_policy ON knowledge.artifact_sources
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY artifact_sources_worker_insert_policy ON knowledge.artifact_sources
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY artifact_sources_worker_update_policy ON knowledge.artifact_sources
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE knowledge.artifact_concepts ENABLE ROW LEVEL SECURITY;
CREATE POLICY artifact_concepts_owner_policy ON knowledge.artifact_concepts
  FOR SELECT TO learnspace_app, learnspace_ai
  USING (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY artifact_concepts_owner_insert_policy ON knowledge.artifact_concepts
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY artifact_concepts_owner_update_policy ON knowledge.artifact_concepts
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM knowledge.artifact_details AS a WHERE a.resource_id = artifact_resource_id AND a.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY artifact_concepts_worker_policy ON knowledge.artifact_concepts
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY artifact_concepts_worker_insert_policy ON knowledge.artifact_concepts
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY artifact_concepts_worker_update_policy ON knowledge.artifact_concepts
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE agent.agent_runs, agent.agent_steps, agent.tool_invocations,
  agent.model_invocations, agent.agent_artifacts
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE ON TABLE agent.agent_runs, agent.agent_steps,
  agent.tool_invocations, agent.model_invocations, agent.agent_artifacts TO learnspace_ai;
ALTER TABLE agent.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_runs_owner_policy ON agent.agent_runs
  FOR SELECT TO learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY agent_runs_owner_insert_policy ON agent.agent_runs
  FOR INSERT TO learnspace_ai
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY agent_runs_owner_update_policy ON agent.agent_runs
  FOR UPDATE TO learnspace_ai
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE agent.agent_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_steps_owner_policy ON agent.agent_steps
  FOR SELECT TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY agent_steps_owner_insert_policy ON agent.agent_steps
  FOR INSERT TO learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY agent_steps_owner_update_policy ON agent.agent_steps
  FOR UPDATE TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE agent.tool_invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tool_invocations_owner_policy ON agent.tool_invocations
  FOR SELECT TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY tool_invocations_owner_insert_policy ON agent.tool_invocations
  FOR INSERT TO learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY tool_invocations_owner_update_policy ON agent.tool_invocations
  FOR UPDATE TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE agent.model_invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_invocations_owner_policy ON agent.model_invocations
  FOR SELECT TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY model_invocations_owner_insert_policy ON agent.model_invocations
  FOR INSERT TO learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY model_invocations_owner_update_policy ON agent.model_invocations
  FOR UPDATE TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
ALTER TABLE agent.agent_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_artifacts_owner_policy ON agent.agent_artifacts
  FOR SELECT TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY agent_artifacts_owner_insert_policy ON agent.agent_artifacts
  FOR INSERT TO learnspace_ai
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY agent_artifacts_owner_update_policy ON agent.agent_artifacts
  FOR UPDATE TO learnspace_ai
  USING (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent.agent_runs AS r WHERE r.id = agent_run_id AND r.user_id::text = current_setting('app.user_id', true)));
REVOKE ALL ON TABLE discovery.recommendation_runs, discovery.recommendation_candidates,
  discovery.recommendation_impressions, discovery.discovery_interactions,
  discovery.user_concept_affinity, discovery.resource_quality_snapshots
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT, INSERT, UPDATE ON TABLE discovery.recommendation_runs, discovery.recommendation_candidates,
  discovery.recommendation_impressions, discovery.discovery_interactions TO learnspace_app;
GRANT DELETE ON TABLE discovery.user_concept_affinity TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE discovery.user_concept_affinity TO learnspace_app;
GRANT SELECT, INSERT, UPDATE ON TABLE discovery.recommendation_runs, discovery.recommendation_candidates,
  discovery.recommendation_impressions, discovery.discovery_interactions,
  discovery.user_concept_affinity, discovery.resource_quality_snapshots TO learnspace_worker;
GRANT SELECT ON TABLE discovery.resource_quality_snapshots TO learnspace_app;
ALTER TABLE discovery.recommendation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY recommendation_runs_owner_policy ON discovery.recommendation_runs
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY recommendation_runs_owner_insert_policy ON discovery.recommendation_runs
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY recommendation_runs_owner_update_policy ON discovery.recommendation_runs
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY recommendation_runs_worker_policy ON discovery.recommendation_runs
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY recommendation_runs_worker_insert_policy ON discovery.recommendation_runs
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY recommendation_runs_worker_update_policy ON discovery.recommendation_runs
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE discovery.recommendation_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY recommendation_candidates_owner_policy ON discovery.recommendation_candidates
  FOR SELECT TO learnspace_app
  USING (EXISTS (SELECT 1 FROM discovery.recommendation_runs AS r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY recommendation_candidates_owner_insert_policy ON discovery.recommendation_candidates
  FOR INSERT TO learnspace_app
  WITH CHECK (EXISTS (SELECT 1 FROM discovery.recommendation_runs AS r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY recommendation_candidates_owner_update_policy ON discovery.recommendation_candidates
  FOR UPDATE TO learnspace_app
  USING (EXISTS (SELECT 1 FROM discovery.recommendation_runs AS r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM discovery.recommendation_runs AS r WHERE r.id = recommendation_run_id AND r.user_id::text = current_setting('app.user_id', true)));
CREATE POLICY recommendation_candidates_worker_policy ON discovery.recommendation_candidates
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY recommendation_candidates_worker_insert_policy ON discovery.recommendation_candidates
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY recommendation_candidates_worker_update_policy ON discovery.recommendation_candidates
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE discovery.recommendation_impressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY recommendation_impressions_owner_policy ON discovery.recommendation_impressions
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY recommendation_impressions_owner_insert_policy ON discovery.recommendation_impressions
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY recommendation_impressions_owner_update_policy ON discovery.recommendation_impressions
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY recommendation_impressions_worker_policy ON discovery.recommendation_impressions
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY recommendation_impressions_worker_insert_policy ON discovery.recommendation_impressions
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY recommendation_impressions_worker_update_policy ON discovery.recommendation_impressions
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE discovery.discovery_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_interactions_owner_policy ON discovery.discovery_interactions
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY discovery_interactions_owner_insert_policy ON discovery.discovery_interactions
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY discovery_interactions_owner_update_policy ON discovery.discovery_interactions
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY discovery_interactions_worker_policy ON discovery.discovery_interactions
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY discovery_interactions_worker_insert_policy ON discovery.discovery_interactions
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY discovery_interactions_worker_update_policy ON discovery.discovery_interactions
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE discovery.user_concept_affinity ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_concept_affinity_owner_policy ON discovery.user_concept_affinity
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_concept_affinity_owner_insert_policy ON discovery.user_concept_affinity
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_concept_affinity_owner_update_policy ON discovery.user_concept_affinity
  FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_concept_affinity_owner_delete_policy ON discovery.user_concept_affinity
  FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_concept_affinity_worker_policy ON discovery.user_concept_affinity
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY user_concept_affinity_worker_insert_policy ON discovery.user_concept_affinity
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY user_concept_affinity_worker_update_policy ON discovery.user_concept_affinity
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE discovery.resource_quality_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_quality_visible_policy ON discovery.resource_quality_snapshots
  FOR SELECT TO learnspace_app
  USING (EXISTS (SELECT 1 FROM catalog.resources AS r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted'))));
CREATE POLICY resource_quality_worker_policy ON discovery.resource_quality_snapshots
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resource_quality_worker_insert_policy ON discovery.resource_quality_snapshots
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resource_quality_worker_update_policy ON discovery.resource_quality_snapshots
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE projection.dashboard_state, projection.user_learning_daily, projection.session_summary
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT ON TABLE projection.dashboard_state, projection.user_learning_daily, projection.session_summary TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE projection.dashboard_state,
  projection.user_learning_daily, projection.session_summary TO learnspace_worker;
ALTER TABLE projection.dashboard_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY dashboard_state_owner_policy ON projection.dashboard_state
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY dashboard_state_worker_policy ON projection.dashboard_state
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY dashboard_state_worker_insert_policy ON projection.dashboard_state
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY dashboard_state_worker_update_policy ON projection.dashboard_state
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY dashboard_state_worker_delete_policy ON projection.dashboard_state
  FOR DELETE TO learnspace_worker USING (true);
ALTER TABLE projection.user_learning_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_learning_daily_owner_policy ON projection.user_learning_daily
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY user_learning_daily_worker_policy ON projection.user_learning_daily
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY user_learning_daily_worker_insert_policy ON projection.user_learning_daily
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY user_learning_daily_worker_update_policy ON projection.user_learning_daily
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY user_learning_daily_worker_delete_policy ON projection.user_learning_daily
  FOR DELETE TO learnspace_worker USING (true);
ALTER TABLE projection.session_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_summary_owner_policy ON projection.session_summary
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_summary_worker_policy ON projection.session_summary
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY session_summary_worker_insert_policy ON projection.session_summary
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY session_summary_worker_update_policy ON projection.session_summary
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY session_summary_worker_delete_policy ON projection.session_summary
  FOR DELETE TO learnspace_worker USING (true);
REVOKE ALL ON TABLE ops.idempotency_records, ops.outbox_events, ops.jobs
FROM learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT SELECT ON TABLE ops.idempotency_records TO learnspace_app;
GRANT SELECT, INSERT ON TABLE ops.outbox_events TO learnspace_app;
GRANT SELECT ON TABLE ops.outbox_events TO learnspace_worker;
GRANT UPDATE (status, attempts, available_at, locked_by, locked_at, published_at, last_error)
  ON TABLE ops.outbox_events TO learnspace_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ops.jobs TO learnspace_worker;
ALTER TABLE ops.idempotency_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_records_select_policy ON ops.idempotency_records
  FOR SELECT TO learnspace_app
  USING (user_id IS NOT NULL AND user_id::text = current_setting('app.user_id', true));
ALTER TABLE ops.outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_owner_policy ON ops.outbox_events
  FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY outbox_events_owner_insert_policy ON ops.outbox_events
  FOR INSERT TO learnspace_app
  WITH CHECK (user_id IS NOT NULL AND user_id::text = current_setting('app.user_id', true));
CREATE POLICY outbox_events_worker_policy ON ops.outbox_events
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY outbox_events_worker_update_policy ON ops.outbox_events
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
ALTER TABLE ops.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_worker_policy ON ops.jobs
  FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY jobs_worker_insert_policy ON ops.jobs
  FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY jobs_worker_update_policy ON ops.jobs
  FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY jobs_worker_delete_policy ON ops.jobs
  FOR DELETE TO learnspace_worker USING (true);

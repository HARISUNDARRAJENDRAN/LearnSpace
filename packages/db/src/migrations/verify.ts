import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATOR_URL is required");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

const migrationsFolder = fileURLToPath(new URL("../../../../infra/migrations/drizzle", import.meta.url));

type CountRow = { count: string };
type NameRow = { name: string };
type RlsRow = { relation: string; enabled: boolean; policy_name: string | null };
type DrizzleMigrationRow = { hash: string };
type ManifestRow = { migration_order: number; migration_name: string; checksum: string; drizzle_hash: string };

const sensitiveRlsManifest: Record<string, readonly string[]> = {
  "identity.users": ["identity_users_select_policy", "identity_users_insert_policy", "identity_users_update_policy", "identity_users_delete_policy"],
  "identity.auth_accounts": ["identity_auth_accounts_select_policy", "identity_auth_accounts_insert_policy", "identity_auth_accounts_update_policy", "identity_auth_accounts_delete_policy"],
  "identity.auth_sessions": ["identity_auth_sessions_select_policy", "identity_auth_sessions_insert_policy", "identity_auth_sessions_update_policy", "identity_auth_sessions_delete_policy"],
  "identity.user_settings": ["user_settings_owner_policy"],
  "identity.auth_challenges": ["identity_auth_challenges_auth_role_select_policy", "identity_auth_challenges_auth_role_insert_policy", "identity_auth_challenges_auth_role_update_policy"],
  "catalog.resources": ["resources_owner_or_visible_policy", "resources_owner_insert_policy", "resources_owner_update_policy", "resources_owner_delete_policy", "resources_worker_policy", "resources_worker_insert_policy", "resources_worker_update_policy"],
  "catalog.resource_versions": ["resource_versions_visible_policy", "resource_versions_worker_policy", "resource_versions_worker_insert_policy", "resource_versions_worker_update_policy"],
  "catalog.resource_assets": ["resource_assets_visible_policy", "resource_assets_worker_policy", "resource_assets_worker_insert_policy", "resource_assets_worker_update_policy"],
  "catalog.authors": ["authors_visible_policy", "authors_worker_policy", "authors_worker_insert_policy", "authors_worker_update_policy"],
  "catalog.library_items": ["library_items_owner_policy", "library_items_owner_insert_policy", "library_items_owner_update_policy", "library_items_owner_delete_policy"],
  "catalog.collections": ["collections_owner_or_visible_policy", "collections_owner_insert_policy", "collections_owner_update_policy", "collections_owner_delete_policy", "collections_worker_policy", "collections_worker_insert_policy", "collections_worker_update_policy"],
  "catalog.collection_sections": ["collection_sections_visible_policy", "collection_sections_owner_insert_policy", "collection_sections_owner_update_policy", "collection_sections_owner_delete_policy", "collection_sections_worker_policy", "collection_sections_worker_insert_policy", "collection_sections_worker_update_policy"],
  "catalog.collection_items": ["collection_items_visible_policy", "collection_items_owner_insert_policy", "collection_items_owner_update_policy", "collection_items_owner_delete_policy", "collection_items_worker_policy", "collection_items_worker_insert_policy", "collection_items_worker_update_policy"],
  "catalog.collection_enrollments": ["collection_enrollments_owner_policy", "collection_enrollments_owner_insert_policy", "collection_enrollments_owner_update_policy", "collection_enrollments_owner_delete_policy"],
  "catalog.video_details": ["video_details_visible_policy", "video_details_worker_policy"],
  "catalog.video_metric_snapshots": ["video_metric_snapshots_visible_policy", "video_metric_snapshots_worker_policy"],
  "catalog.paper_details": ["paper_details_visible_policy", "paper_details_worker_policy"],
  "catalog.paper_authors": ["paper_authors_visible_policy", "paper_authors_worker_policy"],
  "catalog.paper_references": ["paper_references_visible_policy", "paper_references_worker_policy"],
  "catalog.resource_concepts": ["resource_concepts_visible_policy", "resource_concepts_worker_policy"],
  "study.learning_goals": ["learning_goals_owner_policy"],
  "study.study_sessions": ["study_sessions_owner_policy", "study_sessions_worker_policy"],
  "study.session_resources": ["session_resources_owner_policy", "session_resources_worker_policy"],
  "study.session_context_snapshots": ["session_snapshots_owner_policy", "session_snapshots_worker_policy"],
  "study.session_checkpoints": ["session_checkpoints_owner_policy", "session_checkpoints_worker_policy"],
  "study.user_resource_progress": ["user_resource_progress_owner_policy"],
  "study.focus_sessions": ["focus_sessions_owner_policy"],
  "study.schedule_items": ["schedule_items_owner_policy"],
  "study.tutor_threads": ["tutor_threads_owner_policy"],
  "study.tutor_messages": ["tutor_messages_owner_policy"],
  "activity.activity_events": ["activity_events_owner_policy", "activity_events_worker_policy"],
  "retrieval.resource_chunks": ["resource_chunks_visible_policy", "resource_chunks_worker_policy", "resource_chunks_worker_insert_policy", "resource_chunks_worker_update_policy"],
  "retrieval.chunk_embeddings": ["chunk_embeddings_visible_policy", "chunk_embeddings_worker_policy", "chunk_embeddings_worker_insert_policy", "chunk_embeddings_worker_update_policy"],
  "retrieval.embedding_profiles": ["embedding_profiles_visible_policy", "embedding_profiles_worker_policy", "embedding_profiles_worker_insert_policy", "embedding_profiles_worker_update_policy"],
  "retrieval.chunk_concepts": ["chunk_concepts_visible_policy", "chunk_concepts_worker_policy", "chunk_concepts_worker_insert_policy", "chunk_concepts_worker_update_policy"],
  "retrieval.ingestion_runs": ["ingestion_runs_visible_policy", "ingestion_runs_worker_policy", "ingestion_runs_worker_insert_policy", "ingestion_runs_worker_update_policy"],
  "retrieval.retrieval_runs": ["retrieval_runs_owner_policy", "retrieval_runs_owner_insert_policy", "retrieval_runs_worker_policy", "retrieval_runs_worker_insert_policy", "retrieval_runs_worker_update_policy"],
  "retrieval.retrieved_chunks": ["retrieved_chunks_owner_policy", "retrieved_chunks_worker_policy"],
  "retrieval.citations": ["citations_owner_policy", "citations_worker_policy"],
  "practice.exercise_attempts": ["exercise_attempts_owner_policy"],
  "practice.exercises": ["exercises_select_policy", "exercises_insert_policy", "exercises_update_policy", "exercises_delete_policy", "exercises_worker_publication_policy"],
  "practice.exercise_bindings": ["exercise_bindings_owner_policy", "exercise_bindings_owner_insert_policy", "exercise_bindings_owner_update_policy", "exercise_bindings_owner_delete_policy", "exercise_bindings_worker_policy", "exercise_bindings_worker_insert_policy", "exercise_bindings_worker_update_policy"],
  "practice.exercise_examples": ["exercise_examples_visible_policy"],
  "practice.code_snapshots": ["code_snapshots_owner_policy"],
  "practice.observer_diagnostics": ["observer_diagnostics_owner_policy"],
  "practice.hint_events": ["hint_events_owner_policy"],
  "practice.exercise_versions": ["exercise_versions_visible_policy", "exercise_versions_worker_policy", "exercise_versions_worker_insert_policy", "exercise_versions_worker_update_policy"],
  "practice.test_bundles": ["test_bundles_worker_policy", "test_bundles_worker_insert_policy", "test_bundles_worker_update_policy"],
  "practice.execution_runs": ["execution_runs_app_select_policy", "execution_runs_ai_select_policy", "execution_runs_runner_select_policy", "execution_runs_runner_update_policy"],
  "knowledge.concepts": ["concepts_visible_policy", "concepts_worker_insert_policy", "concepts_worker_update_policy"],
  "knowledge.concept_aliases": ["concept_aliases_visible_policy", "concept_aliases_worker_insert_policy", "concept_aliases_worker_update_policy"],
  "knowledge.concept_relations": ["concept_relations_visible_policy", "concept_relations_worker_insert_policy", "concept_relations_worker_update_policy"],
  "knowledge.user_knowledge_edges": ["user_knowledge_edges_owner_policy"],
  "knowledge.mastery_signals": ["mastery_signals_owner_policy", "mastery_signals_worker_policy"],
  "knowledge.concept_mastery": ["concept_mastery_owner_policy", "concept_mastery_worker_policy"],
  "knowledge.review_schedules": ["review_schedules_owner_policy", "review_schedules_worker_policy"],
  "knowledge.unresolved_questions": ["unresolved_questions_owner_policy"],
  "knowledge.artifact_details": ["artifact_details_owner_policy"],
  "knowledge.artifact_sources": ["artifact_sources_owner_policy"],
  "knowledge.artifact_concepts": ["artifact_concepts_owner_policy"],
  "agent.agent_runs": ["agent_runs_owner_policy"],
  "agent.agent_steps": ["agent_steps_owner_policy"],
  "agent.tool_invocations": ["tool_invocations_owner_policy"],
  "agent.model_invocations": ["model_invocations_owner_policy"],
  "agent.agent_artifacts": ["agent_artifacts_owner_select_policy", "agent_artifacts_owner_insert_policy", "agent_artifacts_owner_update_policy", "agent_artifacts_owner_delete_policy"],
  "discovery.recommendation_runs": ["recommendation_runs_owner_policy"],
  "discovery.recommendation_candidates": ["recommendation_candidates_owner_policy"],
  "discovery.recommendation_impressions": ["recommendation_impressions_owner_policy"],
  "discovery.discovery_interactions": ["discovery_interactions_owner_policy"],
  "discovery.resource_quality_snapshots": ["resource_quality_visible_policy", "resource_quality_worker_policy", "resource_quality_worker_insert_policy", "resource_quality_worker_update_policy"],
  "discovery.user_concept_affinity": ["user_concept_affinity_owner_policy", "user_concept_affinity_owner_insert_policy", "user_concept_affinity_owner_update_policy", "user_concept_affinity_owner_delete_policy", "user_concept_affinity_worker_policy", "user_concept_affinity_worker_insert_policy", "user_concept_affinity_worker_update_policy"],
  "projection.dashboard_state": ["dashboard_state_owner_policy", "dashboard_state_worker_policy"],
  "projection.user_learning_daily": ["user_learning_daily_owner_policy", "user_learning_daily_worker_policy"],
  "projection.session_summary": ["session_summary_owner_policy", "session_summary_worker_policy"],
  "ops.idempotency_records": ["idempotency_records_select_policy"],
  "ops.outbox_events": ["outbox_events_owner_policy", "outbox_events_owner_insert_policy", "outbox_events_worker_policy", "outbox_events_worker_update_policy"],
  "ops.jobs": ["jobs_worker_policy", "jobs_worker_insert_policy", "jobs_worker_update_policy", "jobs_worker_delete_policy"],
};

const requiredConstraints = [
  "auth_sessions_rotated_user_fkey",
  "auth_challenges_user_id_users_id_fk",
  "study_sessions_goal_user_fkey",
  "study_sessions_active_resource_version_fkey",
  "study_sessions_active_version_chunk_fkey",
  "session_checkpoints_resource_version_fkey",
  "session_checkpoints_version_chunk_fkey",
  "activity_events_user_session_fkey",
  "activity_events_session_resource_fkey",
  "activity_events_resource_version_fkey",
  "activity_events_version_chunk_fkey",
  "resource_chunks_parent_version_fkey",
  "ingestion_runs_resource_version_fkey",
  "citations_retrieved_chunk_fkey",
  "citations_version_chunk_fkey",
  "retrieval_runs_user_session_fkey",
  "exercise_attempts_user_session_fkey",
  "exercise_attempts_binding_version_fkey",
  "code_snapshots_parent_attempt_fkey",
  "execution_runs_attempt_snapshot_fkey",
  "exercise_bindings_resource_version_fkey",
  "exercise_bindings_version_chunk_fkey",
  "exercise_bindings_session_resource_fkey",
  "execution_runs_attempt_id_uq",
  "observer_diagnostics_attempt_id_uq",
  "observer_diagnostics_attempt_snapshot_fkey",
  "observer_diagnostics_attempt_execution_fkey",
  "hint_events_attempt_diagnostic_fkey",
  "artifact_details_source_agent_user_fkey",
  "artifact_details_source_agent_session_fkey",
  "agent_runs_thread_id_uq",
  "tutor_messages_thread_id_uq",
  "tutor_messages_source_message_fkey",
  "tutor_messages_agent_run_fkey",
  "tutor_threads_user_session_fkey",
  "embedding_profiles_active_dimensions_chk",
  "embedding_profiles_distance_metric_chk",
];

async function count(query: string): Promise<number> {
  const [row] = await sql.unsafe<CountRow[]>(query);
  return Number(row?.count ?? 0);
}

async function requireCondition(condition: boolean, message: string): Promise<void> {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyMigrationLedger(): Promise<void> {
  const names = (await readdir(migrationsFolder))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const drizzleRows = await sql<DrizzleMigrationRow[]>`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `;
  const manifestRows = await sql<ManifestRow[]>`
    SELECT migration_order, migration_name, checksum, drizzle_hash
    FROM drizzle.migration_manifest
    ORDER BY migration_order
  `;
  await requireCondition(drizzleRows.length === names.length, "Drizzle migration ledger is incomplete");
  await requireCondition(manifestRows.length === names.length, "migration manifest is incomplete");
  for (const [migrationOrder, migrationName] of names.entries()) {
    const contents = await readFile(resolve(migrationsFolder, migrationName), "utf8");
    const checksum = createHash("sha256").update(contents).digest("hex");
    const drizzleRow = drizzleRows[migrationOrder];
    const manifestRow = manifestRows[migrationOrder];
    await requireCondition(
      drizzleRow !== undefined &&
        manifestRow !== undefined &&
        manifestRow.migration_order === migrationOrder &&
        manifestRow.migration_name === migrationName &&
        manifestRow.checksum === checksum &&
        manifestRow.drizzle_hash === drizzleRow.hash,
      `migration ledger mismatch for ${migrationName}`,
    );
  }
}

try {
  await verifyMigrationLedger();

  const extensions = await sql<{ extname: string }[]>`
    SELECT extname
    FROM pg_extension
    WHERE extname IN ('pgcrypto', 'pg_trgm', 'vector')
    ORDER BY extname
  `;
  await requireCondition(
    extensions.map((row) => row.extname).join(",") === "pg_trgm,pgcrypto,vector",
    "required PostgreSQL extensions are missing",
  );

  const schemas = await sql<NameRow[]>`
    SELECT nspname AS name
    FROM pg_namespace
    WHERE nspname IN ('identity', 'catalog', 'study', 'activity', 'retrieval', 'practice', 'knowledge', 'agent', 'discovery', 'ops', 'projection')
    ORDER BY nspname
  `;
  await requireCondition(schemas.length === 11, "target schemas are incomplete");

  const tableCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('identity', 'catalog', 'study', 'activity', 'retrieval', 'practice', 'knowledge', 'agent', 'discovery', 'ops', 'projection')
      AND c.relkind IN ('r', 'p')
  `);
  await requireCondition(tableCount === 80, `expected 80 target tables, found ${tableCount}`);

  const onboardingColumnCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'identity'
      AND c.relname = 'user_settings'
      AND a.attname IN ('onboarding_completed_at', 'onboarding_version')
      AND NOT a.attisdropped
  `);
  await requireCondition(onboardingColumnCount === 2, "onboarding settings columns are incomplete");

  const generatedFtsCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('catalog', 'retrieval', 'knowledge')
      AND a.attname = 'search_tsv'
      AND a.attgenerated = 's'
  `);
  await requireCondition(generatedFtsCount === 3, "generated full-text search columns are incomplete");

  const constraintRows = await sql<{ name: string }[]>`
    SELECT conname::text AS name
    FROM pg_constraint
  `;
  const constraintNames = new Set(constraintRows.map((row) => row.name));
  await requireCondition(requiredConstraints.every((name) => constraintNames.has(name)), "cross-row integrity constraints are incomplete");

  const triggerRows = await sql<{ name: string }[]>`
    SELECT t.tgname AS name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname, t.tgname) IN (
      ('catalog', 'resource_versions', 'resource_versions_immutable_trg'),
      ('catalog', 'resources', 'resources_current_version_ready_trg'),
      ('practice', 'execution_runs', 'execution_runs_hashes_trg'),
      ('practice', 'exercise_attempts', 'exercise_attempts_binding_context_trg'),
      ('knowledge', 'mastery_signals', 'mastery_signals_source_trg'),
      ('ops', 'outbox_events', 'outbox_events_append_only_trg'),
      ('study', 'user_resource_progress', 'user_resource_progress_chunk_resource_trg'),
      ('practice', 'observer_diagnostics', 'observer_diagnostics_model_invocation_trg'),
      ('practice', 'hint_events', 'hint_events_model_invocation_trg'),
      ('retrieval', 'citations', 'citations_message_context_trg')
    )
      AND NOT t.tgisinternal
  `;
  await requireCondition(triggerRows.length === 10, "target integrity triggers are incomplete");

  const validationFunctionRows = await sql<{ name: string; security_definer: boolean; settings: string[] | null }[]>`
    SELECT
      p.proname AS name,
      p.prosecdef AS security_definer,
      p.proconfig AS settings
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) IN (
      ('study', 'validate_user_resource_progress_chunk', ''),
      ('practice', 'validate_model_invocation_attempt', ''),
      ('retrieval', 'validate_citation_message_context', '')
    )
  `;
  await requireCondition(
    validationFunctionRows.length === 3 &&
      validationFunctionRows.every((row) => row.security_definer && row.settings?.some((setting) => setting.startsWith("search_path=pg_catalog")) === true),
    "validation functions are not safely configured",
  );

  const rlsRows = await sql<RlsRow[]>`
    SELECT n.nspname || '.' || c.relname AS relation, c.relrowsecurity AS enabled, p.policyname AS policy_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
    WHERE n.nspname IN ('identity', 'catalog', 'study', 'activity', 'retrieval', 'practice', 'knowledge', 'agent', 'discovery', 'ops', 'projection')
      AND c.relkind IN ('r', 'p')
    ORDER BY relation, policy_name
  `;
  const rlsMap = new Map<string, { enabled: boolean; policies: Set<string> }>();
  for (const row of rlsRows) {
    const current = rlsMap.get(row.relation) ?? { enabled: row.enabled, policies: new Set<string>() };
    current.enabled = row.enabled;
    if (row.policy_name) {
      current.policies.add(row.policy_name);
    }
    rlsMap.set(row.relation, current);
  }
  for (const [relation, expectedPolicies] of Object.entries(sensitiveRlsManifest)) {
    const current = rlsMap.get(relation);
    if (!current) {
      throw new Error(`RLS manifest relation is missing: ${relation}`);
    }
    await requireCondition(current.enabled === true, `RLS is disabled on ${relation}`);
    await requireCondition(expectedPolicies.every((policy) => current.policies.has(policy)), `RLS policy manifest is incomplete on ${relation}`);
  }
  const allPolicies = await count(`
    SELECT count(*)::text AS count
    FROM pg_policies
    WHERE schemaname IN ('identity', 'catalog', 'study', 'activity', 'retrieval', 'practice', 'knowledge', 'agent', 'discovery', 'ops', 'projection')
      AND cmd = 'ALL'
  `);
  await requireCondition(allPolicies === 0, `found ${allPolicies} FOR ALL RLS policies`);

  const invalidBindingWritePolicies = await count(`
    SELECT count(*)::text AS count
    FROM pg_policies
    WHERE schemaname = 'practice'
      AND tablename = 'exercise_bindings'
      AND policyname IN ('exercise_bindings_owner_insert_policy', 'exercise_bindings_owner_update_policy', 'exercise_bindings_owner_delete_policy')
      AND CASE
        WHEN cmd IN ('INSERT', 'UPDATE') THEN position('study_session_id IS NOT NULL' IN coalesce(with_check, '')) = 0
        WHEN cmd = 'DELETE' THEN position('study_session_id IS NOT NULL' IN coalesce(qual, '')) = 0
        ELSE true
      END
  `);
  await requireCondition(invalidBindingWritePolicies === 0, "exercise binding writes are not session-scoped");

  const invalidArtifactWritePolicies = await count(`
    SELECT count(*)::text AS count
    FROM pg_policies
    WHERE schemaname = 'agent'
      AND tablename = 'agent_artifacts'
      AND policyname IN ('agent_artifacts_owner_insert_policy', 'agent_artifacts_owner_update_policy', 'agent_artifacts_owner_delete_policy')
      AND CASE
        WHEN cmd IN ('INSERT', 'UPDATE') THEN position('resource.visibility' IN coalesce(with_check, '')) = 0 OR position('resource.owner_user_id' IN coalesce(with_check, '')) = 0
        WHEN cmd = 'DELETE' THEN position('resource.visibility' IN coalesce(qual, '')) = 0 OR position('resource.owner_user_id' IN coalesce(qual, '')) = 0
        ELSE true
      END
  `);
  await requireCondition(invalidArtifactWritePolicies === 0, "agent artifact writes do not enforce resource authorization");

  const roleCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_roles
    WHERE rolname IN ('learnspace_migrator', 'learnspace_app', 'learnspace_auth', 'learnspace_ai', 'learnspace_worker', 'learnspace_runner', 'learnspace_readonly')
      AND NOT rolsuper
      AND NOT rolcreatedb
      AND NOT rolcreaterole
  `);
  await requireCondition(roleCount === 7, "least-privilege database roles are incomplete");

  const views = await sql<NameRow[]>`
    SELECT schemaname || '.' || viewname AS name
    FROM pg_views
    WHERE (schemaname, viewname) IN (
      ('retrieval', 'authorized_chunk_metadata'),
      ('practice', 'learner_exercise_versions'),
      ('practice', 'runner_execution_payload'),
      ('identity', 'support_user_summary'),
      ('agent', 'cost_metrics_redacted')
    )
    ORDER BY name
  `;
  await requireCondition(views.length === 5, "security views are incomplete");

  const privilegeRows = await sql<{
    app_can_read_solutions: boolean;
    app_can_read_tests: boolean;
    ai_can_read_tests: boolean;
    app_can_update_execution: boolean;
    app_can_insert_execution: boolean;
    app_can_enqueue_execution: boolean;
    runner_can_read_tests: boolean;
    runner_can_update_execution: boolean;
    runner_can_update_execution_result: boolean;
    worker_can_update_events: boolean;
    app_can_update_outbox: boolean;
    worker_can_update_outbox_status: boolean;
    app_can_update_mastery: boolean;
    ai_can_update_mastery: boolean;
    app_can_create_public_schema: boolean;
    app_can_use_vector: boolean;
    app_can_execute_vector_distance: boolean;
    runtime_vector_roles: string;
    embedding_storage_type: string;
    worker_can_publish_collections: boolean;
  }[]>`
    SELECT
      has_column_privilege('learnspace_app', 'practice.exercise_versions', 'solution_outline', 'SELECT') AS app_can_read_solutions,
      has_table_privilege('learnspace_app', 'practice.test_bundles', 'SELECT') AS app_can_read_tests,
      has_table_privilege('learnspace_ai', 'practice.test_bundles', 'SELECT') AS ai_can_read_tests,
      has_table_privilege('learnspace_app', 'practice.execution_runs', 'UPDATE') AS app_can_update_execution,
      has_table_privilege('learnspace_app', 'practice.execution_runs', 'INSERT') AS app_can_insert_execution,
      has_function_privilege('learnspace_app', 'practice.enqueue_execution(uuid,uuid,uuid)', 'EXECUTE') AS app_can_enqueue_execution,
      has_table_privilege('learnspace_runner', 'practice.test_bundles', 'SELECT') AS runner_can_read_tests,
      has_column_privilege('learnspace_runner', 'practice.execution_runs', 'status', 'UPDATE') AS runner_can_update_execution,
      has_column_privilege('learnspace_runner', 'practice.execution_runs', 'result', 'UPDATE') AS runner_can_update_execution_result,
      has_table_privilege('learnspace_worker', 'activity.activity_events', 'UPDATE') AS worker_can_update_events,
      has_table_privilege('learnspace_app', 'ops.outbox_events', 'UPDATE') AS app_can_update_outbox,
      has_column_privilege('learnspace_worker', 'ops.outbox_events', 'status', 'UPDATE') AS worker_can_update_outbox_status,
      has_table_privilege('learnspace_app', 'knowledge.mastery_signals', 'UPDATE') AS app_can_update_mastery,
      has_table_privilege('learnspace_ai', 'knowledge.mastery_signals', 'UPDATE') AS ai_can_update_mastery,
      has_schema_privilege('learnspace_app', 'public', 'CREATE') AS app_can_create_public_schema,
      has_type_privilege('learnspace_app', 'public.vector', 'USAGE') AS app_can_use_vector,
      has_function_privilege('learnspace_app', 'public.cosine_distance(vector,vector)', 'EXECUTE') AS app_can_execute_vector_distance,
      (
        SELECT count(*)::text
        FROM pg_roles AS runtime_role
        WHERE runtime_role.rolname IN ('learnspace_app', 'learnspace_ai', 'learnspace_worker', 'learnspace_runner', 'learnspace_readonly')
          AND has_schema_privilege(runtime_role.rolname, 'public', 'USAGE')
          AND NOT has_schema_privilege(runtime_role.rolname, 'public', 'CREATE')
          AND has_type_privilege(runtime_role.rolname, 'public.vector', 'USAGE')
          AND has_function_privilege(runtime_role.rolname, 'public.cosine_distance(vector,vector)', 'EXECUTE')
      ) AS runtime_vector_roles,
      (
        SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute AS a
        JOIN pg_class AS c ON c.oid = a.attrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'retrieval' AND c.relname = 'chunk_embeddings' AND a.attname = 'embedding' AND NOT a.attisdropped
      ) AS embedding_storage_type
      ,has_table_privilege('learnspace_worker', 'catalog.collection_sections', 'INSERT')
       AND has_table_privilege('learnspace_worker', 'catalog.collection_items', 'INSERT') AS worker_can_publish_collections
  `;
  await requireCondition(privilegeRows[0]?.app_can_read_solutions === false, "application role can read hidden exercise solutions");
  await requireCondition(privilegeRows[0]?.app_can_read_tests === false, "application role can read hidden test bundles");
  await requireCondition(privilegeRows[0]?.ai_can_read_tests === false, "AI role can read hidden test bundles");
  await requireCondition(privilegeRows[0]?.app_can_update_execution === false, "application role can forge execution results");
  await requireCondition(privilegeRows[0]?.app_can_insert_execution === false, "application role can insert execution rows directly");
  await requireCondition(privilegeRows[0]?.app_can_enqueue_execution === true, "application role cannot enqueue executions through the trusted boundary");
  await requireCondition(privilegeRows[0]?.runner_can_read_tests === true, "runner role cannot read execution fixtures");
  await requireCondition(privilegeRows[0]?.runner_can_update_execution === true, "runner role cannot update execution results");
  await requireCondition(privilegeRows[0]?.runner_can_update_execution_result === true, "runner role cannot update execution result columns");
  await requireCondition(privilegeRows[0]?.worker_can_update_events === false, "worker role can mutate append-only activity events");
  await requireCondition(privilegeRows[0]?.app_can_update_outbox === false, "application role can mutate outbox delivery state");
  await requireCondition(privilegeRows[0]?.worker_can_update_outbox_status === true, "worker role cannot claim outbox delivery state");
  await requireCondition(privilegeRows[0]?.app_can_update_mastery === false, "application role can mutate append-only mastery signals");
  await requireCondition(privilegeRows[0]?.ai_can_update_mastery === false, "AI role can mutate append-only mastery signals");
  await requireCondition(privilegeRows[0]?.app_can_create_public_schema === false, "application role can create objects in public schema");
  await requireCondition(privilegeRows[0]?.app_can_use_vector === true, "application role cannot use vector types");
  await requireCondition(privilegeRows[0]?.app_can_execute_vector_distance === true, "application role cannot execute vector distance functions");
  await requireCondition(privilegeRows[0]?.runtime_vector_roles === "5", "runtime roles do not have the required vector privileges");
  await requireCondition(privilegeRows[0]?.embedding_storage_type === "vector(1536)", "physical embedding storage is not vector(1536)");
  await requireCondition(privilegeRows[0]?.worker_can_publish_collections === true, "worker role cannot publish collection content");

  const longIdentifiers = await count(`
    SELECT count(*)::text AS count
    FROM (
      SELECT conname::text AS name FROM pg_constraint
      UNION ALL
      SELECT indexrelname::text AS name FROM pg_stat_user_indexes
    ) AS identifiers
    WHERE length(name) > 63
  `);
  await requireCondition(longIdentifiers === 0, `found ${longIdentifiers} PostgreSQL identifiers longer than 63 bytes`);

  const invalidCurrentVersions = await count(`
    SELECT count(*)::text AS count
    FROM catalog.resources r
    LEFT JOIN catalog.resource_versions rv ON rv.id = r.current_version_id AND rv.resource_id = r.id AND rv.processing_status = 'ready'
    WHERE r.current_version_id IS NOT NULL AND rv.id IS NULL
  `);
  await requireCondition(invalidCurrentVersions === 0, `found ${invalidCurrentVersions} invalid current resource versions`);

  const invalidEmbeddingProfiles = await count(`
    SELECT count(*)::text AS count
    FROM retrieval.embedding_profiles
    WHERE dimensions <> 1536 OR distance_metric <> 'cosine'
  `);
  await requireCondition(invalidEmbeddingProfiles === 0, `found ${invalidEmbeddingProfiles} incompatible embedding profiles`);

  const invalidSessionPins = await count(`
    SELECT count(*)::text AS count
    FROM study.study_sessions s
    LEFT JOIN catalog.resources r ON r.id = s.active_resource_id
    LEFT JOIN catalog.resource_versions rv ON rv.resource_id = s.active_resource_id AND rv.id = s.active_version_id
    LEFT JOIN retrieval.resource_chunks c ON c.resource_version_id = s.active_version_id AND c.id = s.active_chunk_id
    WHERE (s.active_resource_id IS NULL AND s.active_version_id IS NOT NULL)
      OR (s.active_version_id IS NOT NULL AND rv.id IS NULL)
      OR (s.active_chunk_id IS NOT NULL AND c.id IS NULL)
  `);
  await requireCondition(invalidSessionPins === 0, `found ${invalidSessionPins} invalid active session resource pins`);

  const invalidCheckpoints = await count(`
    SELECT count(*)::text AS count
    FROM study.session_checkpoints sc
    LEFT JOIN catalog.resource_versions rv ON rv.resource_id = sc.resource_id AND rv.id = sc.resource_version_id
    LEFT JOIN retrieval.resource_chunks c ON c.resource_version_id = sc.resource_version_id AND c.id = sc.resource_chunk_id
    WHERE (sc.resource_id IS NULL) <> (sc.resource_version_id IS NULL)
      OR (sc.resource_version_id IS NOT NULL AND rv.id IS NULL)
      OR (sc.resource_chunk_id IS NOT NULL AND c.id IS NULL)
  `);
  await requireCondition(invalidCheckpoints === 0, `found ${invalidCheckpoints} invalid session checkpoints`);

  const invalidActivityEvents = await count(`
    SELECT count(*)::text AS count
    FROM activity.activity_events ae
    WHERE (ae.study_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = ae.study_session_id AND s.user_id = ae.user_id))
       OR (ae.study_session_id IS NOT NULL AND ae.resource_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM study.session_resources sr WHERE sr.study_session_id = ae.study_session_id AND sr.resource_id = ae.resource_id))
       OR (ae.resource_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalog.resource_versions rv WHERE rv.resource_id = ae.resource_id AND rv.id = ae.resource_version_id))
       OR (ae.resource_chunk_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM retrieval.resource_chunks c WHERE c.resource_version_id = ae.resource_version_id AND c.id = ae.resource_chunk_id))
  `);
  await requireCondition(invalidActivityEvents === 0, `found ${invalidActivityEvents} inconsistent activity events`);

  const orphanChunks = await count(`
    SELECT count(*)::text AS count
    FROM retrieval.resource_chunks c
    LEFT JOIN catalog.resource_versions rv ON rv.id = c.resource_version_id
    WHERE rv.id IS NULL
       OR (c.parent_chunk_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM retrieval.resource_chunks p WHERE p.resource_version_id = c.resource_version_id AND p.id = c.parent_chunk_id))
  `);
  await requireCondition(orphanChunks === 0, `found ${orphanChunks} invalid retrieval chunks`);

  const invalidCitations = await count(`
    SELECT count(*)::text AS count
    FROM retrieval.citations c
    WHERE NOT EXISTS (SELECT 1 FROM retrieval.retrieved_chunks rc WHERE rc.retrieval_run_id = c.retrieval_run_id AND rc.chunk_id = c.chunk_id)
       OR NOT EXISTS (SELECT 1 FROM retrieval.resource_chunks ch WHERE ch.resource_version_id = c.resource_version_id AND ch.id = c.chunk_id)
  `);
  await requireCondition(invalidCitations === 0, `found ${invalidCitations} invalid citation provenance rows`);

  const invalidAttempts = await count(`
    SELECT count(*)::text AS count
    FROM practice.exercise_attempts a
    WHERE NOT EXISTS (SELECT 1 FROM practice.exercise_bindings b WHERE b.id = a.exercise_binding_id AND b.exercise_version_id = a.exercise_version_id)
       OR NOT EXISTS (SELECT 1 FROM study.study_sessions s WHERE s.id = a.study_session_id AND s.user_id = a.user_id)
  `);
  await requireCondition(invalidAttempts === 0, `found ${invalidAttempts} invalid exercise attempts`);

  const invalidBindingSessions = await count(`
    SELECT count(*)::text AS count
    FROM practice.exercise_bindings b
    WHERE b.study_session_id IS NOT NULL
      AND b.resource_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM study.session_resources sr
        WHERE sr.study_session_id = b.study_session_id
          AND sr.resource_id = b.resource_id
      )
  `);
  await requireCondition(invalidBindingSessions === 0, `found ${invalidBindingSessions} exercise bindings outside their study session`);

  const invalidDiagnostics = await count(`
    SELECT count(*)::text AS count
    FROM practice.observer_diagnostics d
    LEFT JOIN practice.code_snapshots snapshot ON snapshot.id = d.code_snapshot_id AND snapshot.attempt_id = d.attempt_id
    LEFT JOIN practice.execution_runs execution ON execution.id = d.execution_run_id AND execution.attempt_id = d.attempt_id
    WHERE snapshot.id IS NULL
       OR (d.execution_run_id IS NOT NULL AND execution.id IS NULL)
  `);
  await requireCondition(invalidDiagnostics === 0, `found ${invalidDiagnostics} observer diagnostics with incompatible attempts`);

  const invalidHints = await count(`
    SELECT count(*)::text AS count
    FROM practice.hint_events h
    LEFT JOIN practice.observer_diagnostics d ON d.id = h.diagnostic_id AND d.attempt_id = h.attempt_id
    WHERE h.diagnostic_id IS NOT NULL AND d.id IS NULL
  `);
  await requireCondition(invalidHints === 0, `found ${invalidHints} hints with incompatible diagnostics`);

  const invalidProgressChunks = await count(`
    SELECT count(*)::text AS count
    FROM study.user_resource_progress p
    LEFT JOIN retrieval.resource_chunks c ON c.id = p.last_chunk_id
    LEFT JOIN catalog.resource_versions v ON v.id = c.resource_version_id AND v.resource_id = p.resource_id
    WHERE p.last_chunk_id IS NOT NULL AND v.id IS NULL
  `);
  await requireCondition(invalidProgressChunks === 0, `found ${invalidProgressChunks} progress rows with incompatible chunks`);

  const invalidArtifactRuns = await count(`
    SELECT count(*)::text AS count
    FROM knowledge.artifact_details a
    LEFT JOIN agent.agent_runs r
      ON r.id = a.source_agent_run_id
     AND r.user_id = a.user_id
     AND (a.study_session_id IS NULL OR r.study_session_id IS NOT DISTINCT FROM a.study_session_id)
    WHERE a.source_agent_run_id IS NOT NULL AND r.id IS NULL
  `);
  await requireCondition(invalidArtifactRuns === 0, `found ${invalidArtifactRuns} artifacts with incompatible source agent runs`);

  const invalidTutorProvenance = await count(`
    SELECT count(*)::text AS count
    FROM study.tutor_messages m
    LEFT JOIN study.tutor_messages source ON source.id = m.source_message_id AND source.thread_id = m.thread_id
    LEFT JOIN agent.agent_runs run ON run.id = m.agent_run_id AND run.tutor_thread_id = m.thread_id
    WHERE (m.source_message_id IS NOT NULL AND source.id IS NULL)
       OR (m.agent_run_id IS NOT NULL AND run.id IS NULL)
  `);
  await requireCondition(invalidTutorProvenance === 0, `found ${invalidTutorProvenance} tutor messages with incompatible provenance`);

  const invalidModelInvocations = await count(`
    SELECT count(*)::text AS count
    FROM (
      SELECT d.attempt_id, d.model_invocation_id
      FROM practice.observer_diagnostics d
      UNION ALL
      SELECT h.attempt_id, h.model_invocation_id
      FROM practice.hint_events h
    ) AS provenance_refs
    JOIN practice.exercise_attempts a ON a.id = provenance_refs.attempt_id
    LEFT JOIN agent.model_invocations invocation ON invocation.id = provenance_refs.model_invocation_id
    LEFT JOIN agent.agent_runs run ON run.id = invocation.agent_run_id
    WHERE provenance_refs.model_invocation_id IS NOT NULL
      AND (
        invocation.id IS NULL
        OR run.user_id <> a.user_id
        OR run.study_session_id IS DISTINCT FROM a.study_session_id
      )
  `);
  await requireCondition(invalidModelInvocations === 0, `found ${invalidModelInvocations} model invocations with incompatible attempts`);

  const invalidCitationMessages = await count(`
    SELECT count(*)::text AS count
    FROM retrieval.citations c
    JOIN retrieval.retrieval_runs r ON r.id = c.retrieval_run_id
    LEFT JOIN study.tutor_messages m ON m.id = c.message_id
    LEFT JOIN study.tutor_threads t ON t.id = m.thread_id
    WHERE c.message_id IS NOT NULL
      AND (
        m.id IS NULL
        OR t.user_id <> r.user_id
        OR t.study_session_id IS DISTINCT FROM r.study_session_id
      )
  `);
  await requireCondition(invalidCitationMessages === 0, `found ${invalidCitationMessages} citations with incompatible tutor messages`);

  const invalidSnapshots = await count(`
    SELECT count(*)::text AS count
    FROM practice.code_snapshots cs
    WHERE cs.parent_snapshot_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM practice.code_snapshots parent WHERE parent.attempt_id = cs.attempt_id AND parent.id = cs.parent_snapshot_id)
  `);
  await requireCondition(invalidSnapshots === 0, `found ${invalidSnapshots} invalid code snapshot ancestry rows`);

  const invalidExecutions = await count(`
    SELECT count(*)::text AS count
    FROM practice.execution_runs er
    LEFT JOIN practice.exercise_attempts a ON a.id = er.attempt_id
    LEFT JOIN practice.code_snapshots cs ON cs.id = er.code_snapshot_id AND cs.attempt_id = er.attempt_id
    LEFT JOIN practice.test_bundles tb ON tb.id = er.test_bundle_id AND tb.exercise_version_id = a.exercise_version_id
    WHERE a.id IS NULL OR cs.id IS NULL OR tb.id IS NULL
  `);
  await requireCondition(invalidExecutions === 0, `found ${invalidExecutions} invalid execution provenance rows`);

  const invalidTutorThreads = await count(`
    SELECT count(*)::text AS count
    FROM study.tutor_threads t
    LEFT JOIN study.study_sessions s ON s.id = t.study_session_id AND s.user_id = t.user_id
    WHERE s.id IS NULL
  `);
  await requireCondition(invalidTutorThreads === 0, `found ${invalidTutorThreads} tutor threads owned by another user`);

  const invalidVideoDetails = await count(`
    SELECT count(*)::text AS count
    FROM catalog.video_details vd
    LEFT JOIN catalog.resources r ON r.id = vd.resource_id
    WHERE r.id IS NULL OR r.type <> 'video'
  `);
  await requireCondition(invalidVideoDetails === 0, `found ${invalidVideoDetails} invalid video resource rows`);

  const orphanMasteryEvidence = await count(`
    SELECT count(*)::text AS count
    FROM knowledge.mastery_signals ms
    LEFT JOIN activity.activity_events ae ON ae.id = ms.source_event_id
    WHERE ae.id IS NULL
  `);
  await requireCondition(orphanMasteryEvidence === 0, `found ${orphanMasteryEvidence} mastery signals without evidence`);

  const staleProjectionCount = await count(`
    SELECT count(*)::text AS count
    FROM projection.dashboard_state
    WHERE updated_at < now() - interval '15 minutes'
      AND source_event_at > updated_at
  `);
  await requireCondition(staleProjectionCount === 0, `found ${staleProjectionCount} stale dashboard projections`);

  process.stdout.write(JSON.stringify({
    extensions: extensions.map((row) => row.extname),
    schemas: schemas.length,
    tables: tableCount,
    onboardingColumns: onboardingColumnCount,
    sensitiveRlsTables: Object.keys(sensitiveRlsManifest).length,
    constraints: requiredConstraints.length,
    securityViews: views.length,
  }) + "\n");
} finally {
  await sql.end({ timeout: 5 });
}

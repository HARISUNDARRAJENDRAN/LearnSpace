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
  "catalog.video_metric_snapshots": ["video_metric_snapshots_visible_policy", "video_metric_snapshots_worker_policy", "video_metric_snapshots_worker_delete"],
  "catalog.youtube_channels": ["youtube_channels_worker_select", "youtube_channels_worker_insert", "youtube_channels_worker_update", "youtube_channels_worker_delete"],
  "catalog.paper_details": ["paper_details_visible_policy", "paper_details_worker_policy"],
  "catalog.paper_authors": ["paper_authors_visible_policy", "paper_authors_worker_policy"],
  "catalog.paper_references": ["paper_references_visible_policy", "paper_references_worker_policy"],
  "catalog.resource_concepts": ["resource_concepts_visible_policy", "resource_concepts_worker_policy", "resource_concepts_curated_worker_delete"],
  "study.learning_goals": ["learning_goals_owner_policy"],
  "study.study_sessions": ["study_sessions_owner_policy", "study_sessions_worker_policy"],
  "study.session_folders": ["session_folders_owner_select", "session_folders_owner_insert", "session_folders_owner_update", "session_folders_owner_delete"],
  "study.session_folder_memberships": ["session_folder_memberships_owner_select", "session_folder_memberships_owner_insert", "session_folder_memberships_owner_update", "session_folder_memberships_owner_delete"],
  "study.session_folder_resources": ["session_folder_resources_owner_select", "session_folder_resources_owner_insert", "session_folder_resources_owner_update", "session_folder_resources_owner_delete"],
  "study.session_folder_shares": ["session_folder_shares_owner_select", "session_folder_shares_owner_insert", "session_folder_shares_owner_update", "session_folder_shares_owner_delete"],
  "study.session_folder_share_imports": ["session_folder_imports_owner_select", "session_folder_imports_owner_insert", "session_folder_imports_owner_delete"],
  "study.session_resources": ["session_resources_owner_policy", "session_resources_worker_policy"],
  "study.session_context_snapshots": ["session_snapshots_owner_policy", "session_snapshots_worker_policy"],
  "study.session_checkpoints": ["session_checkpoints_owner_policy", "session_checkpoints_worker_policy"],
  "study.user_resource_progress": ["user_resource_progress_owner_policy"],
  "study.focus_sessions": ["focus_sessions_owner_policy"],
  "study.schedule_items": ["schedule_items_owner_policy"],
  "study.tutor_threads": ["tutor_threads_owner_policy"],
  "study.tutor_messages": ["tutor_messages_owner_policy"],
  "study.mastery_checks": ["mastery_checks_owner_policy", "mastery_checks_owner_insert_policy", "mastery_checks_owner_update_policy"],
  "study.video_notes": ["video_notes_owner_policy", "video_notes_owner_insert_policy", "video_notes_owner_update_policy"],
  "study.session_transcript": ["session_transcript_owner_policy", "session_transcript_owner_insert_policy"],
  "activity.activity_events": ["activity_events_owner_policy", "activity_events_worker_policy"],
  "retrieval.resource_chunks": ["resource_chunks_visible_policy", "resource_chunks_worker_policy", "resource_chunks_worker_insert_policy", "resource_chunks_worker_update_policy"],
  "retrieval.chunk_embeddings": ["chunk_embeddings_visible_policy", "chunk_embeddings_worker_policy", "chunk_embeddings_worker_insert_policy", "chunk_embeddings_worker_update_policy"],
  "retrieval.embedding_profiles": ["embedding_profiles_visible_policy", "embedding_profiles_worker_policy", "embedding_profiles_worker_insert_policy", "embedding_profiles_worker_update_policy"],
  "retrieval.chunk_concepts": ["chunk_concepts_visible_policy", "chunk_concepts_worker_policy", "chunk_concepts_worker_insert_policy", "chunk_concepts_worker_update_policy"],
  "retrieval.ingestion_runs": ["ingestion_runs_visible_policy", "ingestion_runs_worker_policy", "ingestion_runs_worker_insert_policy", "ingestion_runs_worker_update_policy"],
  "retrieval.retrieval_runs": ["retrieval_runs_owner_policy", "retrieval_runs_owner_insert_policy", "retrieval_runs_worker_policy", "retrieval_runs_worker_insert_policy", "retrieval_runs_worker_update_policy"],
  "retrieval.retrieved_chunks": ["retrieved_chunks_owner_policy", "retrieved_chunks_worker_policy"],
  "retrieval.citations": ["citations_owner_policy", "citations_worker_policy"],
  "discovery.favorite_authors": ["favorite_authors_owner_policy", "favorite_authors_owner_insert_policy", "favorite_authors_owner_delete_policy"],
  "discovery.research_topics": ["research_topics_owner_policy", "research_topics_owner_insert_policy", "research_topics_owner_delete_policy"],
  "practice.video_coding_profiles": ["video_coding_profiles_app_select", "video_coding_profiles_app_insert", "video_coding_profiles_app_update"],
  "practice.paper_coding_profiles": ["paper_coding_profiles_app_select", "paper_coding_profiles_app_insert", "paper_coding_profiles_app_update"],
  "practice.coding_problems": ["coding_problems_app_select", "coding_problems_app_insert", "coding_problems_app_update", "coding_problems_runner_select", "coding_problems_runner_update"],
  "practice.coding_problem_secrets": ["coding_problem_secrets_app_insert", "coding_problem_secrets_runner_select", "coding_problem_secrets_runner_update"],
  "practice.coding_attempts": ["coding_attempts_owner_select", "coding_attempts_owner_insert", "coding_attempts_owner_update"],
  "practice.coding_submissions": ["coding_submissions_owner_select", "coding_submissions_owner_insert"],
  "practice.coding_events": ["coding_events_owner_select", "coding_events_owner_insert"],
  "practice.coding_mastery": ["coding_mastery_owner_select", "coding_mastery_owner_insert", "coding_mastery_owner_update"],
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
  "agent.agent_runs": ["agent_runs_owner_policy", "agent_runs_owner_insert_policy", "agent_runs_owner_update_policy"],
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
  "discovery.resource_embeddings": ["resource_embeddings_visible", "resource_embeddings_worker_select", "resource_embeddings_worker_insert", "resource_embeddings_worker_update", "resource_embeddings_worker_delete"],
  "discovery.learner_profiles": ["learner_profiles_owner", "learner_profiles_worker_select", "learner_profiles_worker_insert", "learner_profiles_worker_update", "learner_profiles_worker_delete"],
  "projection.dashboard_state": ["dashboard_state_owner_policy", "dashboard_state_worker_policy"],
  "projection.user_learning_daily": ["user_learning_daily_owner_policy", "user_learning_daily_worker_policy"],
  "projection.session_summary": ["session_summary_owner_policy", "session_summary_worker_policy"],
  "ops.idempotency_records": ["idempotency_records_select_policy"],
  "ops.outbox_events": ["outbox_events_owner_policy", "outbox_events_owner_insert_policy", "outbox_events_worker_policy", "outbox_events_worker_update_policy"],
  "ops.api_usage_daily": ["api_usage_daily_worker_select", "api_usage_daily_worker_insert", "api_usage_daily_worker_update", "api_usage_daily_app_select", "api_usage_daily_app_insert", "api_usage_daily_app_update"],
  "retrieval.answer_cache": ["answer_cache_public_select", "answer_cache_public_insert", "answer_cache_worker_select", "answer_cache_worker_delete"],
  "ops.rate_limit_counters": ["rate_limit_counters_auth_select", "rate_limit_counters_auth_insert", "rate_limit_counters_auth_update", "rate_limit_counters_worker_delete", "rate_limit_counters_worker_select"],
  "ops.jobs": ["jobs_worker_policy", "jobs_worker_insert_policy", "jobs_worker_update_policy", "jobs_worker_delete_policy"],
  "ops.transcript_requests": ["transcript_requests_app_select", "transcript_requests_app_insert", "transcript_requests_app_requeue", "transcript_requests_worker_select", "transcript_requests_worker_update"],
  "catalog.transcript_submissions": ["transcript_submissions_owner_select", "transcript_submissions_owner_insert", "transcript_submissions_owner_update", "transcript_submissions_worker_select", "transcript_submissions_worker_update", "transcript_submissions_worker_delete"],
};

const requiredConstraints = [
  "resource_embeddings_nonzero_chk",
  "coding_attempts_user_session_fkey",
  "coding_problems_verified_chk",
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
  await requireCondition(tableCount === 96, `expected 96 target tables, found ${tableCount}`);

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
      ('knowledge', 'mastery_signals', 'mastery_signals_source_trg'),
      ('ops', 'outbox_events', 'outbox_events_append_only_trg'),
      ('ops', 'outbox_events', 'outbox_events_discovery_wake'),
      ('study', 'user_resource_progress', 'user_resource_progress_chunk_resource_trg'),
      ('retrieval', 'citations', 'citations_message_context_trg')
    )
      AND NOT t.tgisinternal
  `;
  await requireCondition(triggerRows.length === 7, "target integrity triggers are incomplete");

  const validationFunctionRows = await sql<{ name: string; security_definer: boolean; settings: string[] | null }[]>`
    SELECT
      p.proname AS name,
      p.prosecdef AS security_definer,
      p.proconfig AS settings
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) IN (
      ('study', 'validate_user_resource_progress_chunk', ''),
      ('study', 'resolve_shared_folder', 'p_token_hash text'),
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
      ('identity', 'support_user_summary'),
      ('agent', 'cost_metrics_redacted')
    )
    ORDER BY name
  `;
  await requireCondition(views.length === 3, "security views are incomplete");

  const privilegeRows = await sql<{
    app_can_read_problem_secrets: boolean;
    app_can_write_problem_secrets: boolean;
    app_can_update_problem_secrets: boolean;
    ai_can_read_problem_secrets: boolean;
    runner_can_read_problem_secrets: boolean;
    runner_can_write_problem_tests: boolean;
    runner_can_rewrite_authored_secrets: boolean;
    runner_can_mark_verified: boolean;
    runner_can_rewrite_problem_spec: boolean;
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
      has_table_privilege('learnspace_app', 'practice.coding_problem_secrets', 'SELECT') AS app_can_read_problem_secrets,
      has_table_privilege('learnspace_app', 'practice.coding_problem_secrets', 'INSERT') AS app_can_write_problem_secrets,
      has_table_privilege('learnspace_app', 'practice.coding_problem_secrets', 'UPDATE') AS app_can_update_problem_secrets,
      has_table_privilege('learnspace_ai', 'practice.coding_problem_secrets', 'SELECT') AS ai_can_read_problem_secrets,
      has_table_privilege('learnspace_runner', 'practice.coding_problem_secrets', 'SELECT') AS runner_can_read_problem_secrets,
      has_column_privilege('learnspace_runner', 'practice.coding_problem_secrets', 'tests', 'UPDATE') AS runner_can_write_problem_tests,
      has_column_privilege('learnspace_runner', 'practice.coding_problem_secrets', 'authored', 'UPDATE') AS runner_can_rewrite_authored_secrets,
      has_column_privilege('learnspace_runner', 'practice.coding_problems', 'status', 'UPDATE') AS runner_can_mark_verified,
      has_column_privilege('learnspace_runner', 'practice.coding_problems', 'spec', 'UPDATE') AS runner_can_rewrite_problem_spec,
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
  await requireCondition(privilegeRows[0]?.app_can_read_problem_secrets === false, "application role can read hidden tests and reference solutions");
  await requireCondition(privilegeRows[0]?.app_can_write_problem_secrets === true, "application role cannot store an authored problem's tests");
  await requireCondition(privilegeRows[0]?.app_can_update_problem_secrets === false, "application role can rewrite hidden tests");
  await requireCondition(privilegeRows[0]?.ai_can_read_problem_secrets === false, "AI role can read hidden tests and reference solutions");
  await requireCondition(privilegeRows[0]?.runner_can_read_problem_secrets === true, "runner role cannot read the tests it grades with");
  await requireCondition(privilegeRows[0]?.runner_can_write_problem_tests === true, "runner role cannot store verified tests");
  await requireCondition(privilegeRows[0]?.runner_can_rewrite_authored_secrets === false, "runner role can rewrite authored references");
  await requireCondition(privilegeRows[0]?.runner_can_mark_verified === true, "runner role cannot publish verified problems");
  await requireCondition(privilegeRows[0]?.runner_can_rewrite_problem_spec === false, "runner role can rewrite a problem's statement");
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

  const invalidVerifiedProblems = await count(`
    SELECT count(*)::text AS count
    FROM practice.coding_problems p
    LEFT JOIN practice.coding_problem_secrets s ON s.problem_id = p.id
    WHERE p.status = 'verified' AND (s.problem_id IS NULL OR s.tests IS NULL OR s.perf_limit_ms IS NULL)
  `);
  await requireCondition(invalidVerifiedProblems === 0, `found ${invalidVerifiedProblems} verified coding problems without verified tests`);

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

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
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
  "catalog.resources": ["resources_owner_or_visible_policy", "resources_worker_policy"],
  "catalog.resource_versions": ["resource_versions_visible_policy", "resource_versions_worker_policy"],
  "catalog.resource_assets": ["resource_assets_visible_policy", "resource_assets_worker_policy"],
  "catalog.library_items": ["library_items_owner_policy"],
  "catalog.collections": ["collections_owner_or_visible_policy"],
  "catalog.collection_sections": ["collection_sections_owner_policy"],
  "catalog.collection_items": ["collection_items_owner_policy"],
  "catalog.collection_enrollments": ["collection_enrollments_owner_policy"],
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
  "retrieval.resource_chunks": ["resource_chunks_visible_policy", "resource_chunks_worker_policy"],
  "retrieval.chunk_embeddings": ["chunk_embeddings_visible_policy", "chunk_embeddings_worker_policy"],
  "retrieval.retrieval_runs": ["retrieval_runs_owner_policy", "retrieval_runs_worker_policy"],
  "retrieval.retrieved_chunks": ["retrieved_chunks_owner_policy", "retrieved_chunks_worker_policy"],
  "retrieval.citations": ["citations_owner_policy", "citations_worker_policy"],
  "practice.exercise_attempts": ["exercise_attempts_owner_policy"],
  "practice.exercises": ["exercises_select_policy", "exercises_insert_policy", "exercises_update_policy", "exercises_delete_policy", "exercises_worker_publication_policy"],
  "practice.exercise_bindings": ["exercise_bindings_owner_policy"],
  "practice.exercise_examples": ["exercise_examples_visible_policy"],
  "practice.code_snapshots": ["code_snapshots_owner_policy"],
  "practice.observer_diagnostics": ["observer_diagnostics_owner_policy"],
  "practice.hint_events": ["hint_events_owner_policy"],
  "practice.execution_runs": ["execution_runs_app_select_policy", "execution_runs_app_enqueue_policy", "execution_runs_ai_select_policy", "execution_runs_runner_select_policy", "execution_runs_runner_update_policy"],
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
  "agent.agent_artifacts": ["agent_artifacts_owner_policy"],
  "discovery.recommendation_runs": ["recommendation_runs_owner_policy"],
  "discovery.recommendation_candidates": ["recommendation_candidates_owner_policy"],
  "discovery.recommendation_impressions": ["recommendation_impressions_owner_policy"],
  "discovery.discovery_interactions": ["discovery_interactions_owner_policy"],
  "discovery.user_concept_affinity": ["user_concept_affinity_owner_policy", "user_concept_affinity_worker_policy"],
  "projection.dashboard_state": ["dashboard_state_owner_policy", "dashboard_state_worker_policy"],
  "projection.user_learning_daily": ["user_learning_daily_owner_policy", "user_learning_daily_worker_policy"],
  "projection.session_summary": ["session_summary_owner_policy", "session_summary_worker_policy"],
  "ops.idempotency_records": ["idempotency_records_select_policy"],
  "ops.outbox_events": ["outbox_events_owner_policy", "outbox_events_worker_policy"],
};

const requiredConstraints = [
  "auth_sessions_rotated_user_fkey",
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
  await requireCondition(tableCount === 79, `expected 79 target tables, found ${tableCount}`);

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
      ('practice', 'execution_runs', 'execution_runs_hashes_trg')
    )
      AND NOT t.tgisinternal
  `;
  await requireCondition(triggerRows.length === 3, "target integrity triggers are incomplete");

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

  const roleCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_roles
    WHERE rolname IN ('learnspace_migrator', 'learnspace_app', 'learnspace_ai', 'learnspace_worker', 'learnspace_runner', 'learnspace_readonly')
      AND NOT rolsuper
      AND NOT rolcreatedb
      AND NOT rolcreaterole
  `);
  await requireCondition(roleCount === 6, "least-privilege database roles are incomplete");

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

  const privilegeRows = await sql<{ app_can_read_solutions: boolean; app_can_read_tests: boolean; ai_can_read_tests: boolean; app_can_update_execution: boolean; app_can_insert_execution: boolean; runner_can_read_tests: boolean; runner_can_update_execution: boolean; worker_can_update_events: boolean }[]>`
    SELECT
      has_table_privilege('learnspace_app', 'practice.exercise_versions', 'SELECT') AS app_can_read_solutions,
      has_table_privilege('learnspace_app', 'practice.test_bundles', 'SELECT') AS app_can_read_tests,
      has_table_privilege('learnspace_ai', 'practice.test_bundles', 'SELECT') AS ai_can_read_tests,
      has_table_privilege('learnspace_app', 'practice.execution_runs', 'UPDATE') AS app_can_update_execution,
      has_table_privilege('learnspace_app', 'practice.execution_runs', 'INSERT') AS app_can_insert_execution,
      has_table_privilege('learnspace_runner', 'practice.test_bundles', 'SELECT') AS runner_can_read_tests,
      has_table_privilege('learnspace_runner', 'practice.execution_runs', 'UPDATE') AS runner_can_update_execution,
      has_table_privilege('learnspace_worker', 'activity.activity_events', 'UPDATE') AS worker_can_update_events
  `;
  await requireCondition(privilegeRows[0]?.app_can_read_solutions === false, "application role can read hidden exercise solutions");
  await requireCondition(privilegeRows[0]?.app_can_read_tests === false, "application role can read hidden test bundles");
  await requireCondition(privilegeRows[0]?.ai_can_read_tests === false, "AI role can read hidden test bundles");
  await requireCondition(privilegeRows[0]?.app_can_update_execution === false, "application role can forge execution results");
  await requireCondition(privilegeRows[0]?.app_can_insert_execution === true, "application role cannot enqueue executions");
  await requireCondition(privilegeRows[0]?.runner_can_read_tests === true, "runner role cannot read execution fixtures");
  await requireCondition(privilegeRows[0]?.runner_can_update_execution === true, "runner role cannot update execution results");
  await requireCondition(privilegeRows[0]?.worker_can_update_events === false, "worker role can mutate append-only activity events");

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
    WHERE (s.active_resource_id IS NULL) <> (s.active_version_id IS NULL)
      OR (s.active_resource_id IS NOT NULL AND rv.id IS NULL)
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
    sensitiveRlsTables: Object.keys(sensitiveRlsManifest).length,
    constraints: requiredConstraints.length,
    securityViews: views.length,
  }) + "\n");
} finally {
  await sql.end({ timeout: 5 });
}

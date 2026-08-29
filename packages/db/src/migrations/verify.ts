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

type CountRow = { count: string };
type NameRow = { name: string };

async function count(query: string): Promise<number> {
  const [row] = await sql.unsafe<CountRow[]>(query);
  return Number(row?.count ?? 0);
}

async function requireCondition(condition: boolean, message: string): Promise<void> {
  if (!condition) {
    throw new Error(message);
  }
}

try {
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

  const constraintCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_constraint
    WHERE conname IN (
      'auth_sessions_rotated_from_fkey',
      'concepts_canonical_parent_fkey',
      'resource_chunks_parent_fkey',
      'code_snapshots_parent_fkey',
      'tutor_messages_source_message_fkey',
      'resources_current_version_fkey',
      'activity_events_resource_version_owner_fkey',
      'ingestion_runs_resource_version_owner_fkey',
      'exercise_bindings_resource_version_owner_fkey'
    )
  `);
  await requireCondition(constraintCount === 9, "cross-row integrity constraints are incomplete");

  const triggerCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname, t.tgname) IN (
      ('catalog', 'resource_versions', 'resource_versions_immutable_trg'),
      ('practice', 'execution_runs', 'execution_runs_hashes_trg')
    )
      AND NOT t.tgisinternal
  `);
  await requireCondition(triggerCount === 2, "target integrity triggers are incomplete");

  const rlsTableCount = await count(`
    SELECT count(*)::text AS count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('identity', 'catalog', 'study', 'activity', 'retrieval', 'practice', 'knowledge', 'agent', 'projection')
      AND c.relrowsecurity
  `);
  await requireCondition(rlsTableCount >= 30, `expected row-level security on domain tables, found ${rlsTableCount}`);

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

  const hiddenPrivilegeRows = await sql<{ app_can_read: boolean; runner_can_read: boolean; worker_can_update_events: boolean }[]>`
    SELECT
      has_table_privilege('learnspace_app', 'practice.exercise_versions', 'SELECT') AS app_can_read,
      has_table_privilege('learnspace_runner', 'practice.test_bundles', 'SELECT') AS runner_can_read,
      has_table_privilege('learnspace_worker', 'activity.activity_events', 'UPDATE') AS worker_can_update_events
  `;
  await requireCondition(hiddenPrivilegeRows[0]?.app_can_read === false, "application role can read hidden exercise solutions");
  await requireCondition(hiddenPrivilegeRows[0]?.runner_can_read === true, "runner role cannot read execution fixtures");
  await requireCondition(hiddenPrivilegeRows[0]?.worker_can_update_events === false, "worker role can mutate append-only activity events");

  const orphanSessionPins = await count(`
    SELECT count(*)::text AS count
    FROM study.study_sessions s
    LEFT JOIN catalog.resources r ON r.id = s.active_resource_id
    LEFT JOIN catalog.resource_versions rv ON rv.resource_id = s.active_resource_id AND rv.id = s.active_version_id
    WHERE s.active_resource_id IS NOT NULL
      AND (r.id IS NULL OR rv.id IS NULL)
  `);
  await requireCondition(orphanSessionPins === 0, `found ${orphanSessionPins} invalid active session resource pins`);

  const invalidVideoDetails = await count(`
    SELECT count(*)::text AS count
    FROM catalog.video_details vd
    LEFT JOIN catalog.resources r ON r.id = vd.resource_id
    WHERE r.id IS NULL OR r.type <> 'video'
  `);
  await requireCondition(invalidVideoDetails === 0, `found ${invalidVideoDetails} invalid video resource rows`);

  const invalidCurrentVersions = await count(`
    SELECT count(*)::text AS count
    FROM catalog.resources r
    LEFT JOIN catalog.resource_versions rv ON rv.id = r.current_version_id AND rv.resource_id = r.id
    WHERE r.current_version_id IS NOT NULL AND rv.id IS NULL
  `);
  await requireCondition(invalidCurrentVersions === 0, `found ${invalidCurrentVersions} invalid current resource versions`);

  const invalidSessionPins = await count(`
    SELECT count(*)::text AS count
    FROM study.session_resources sr
    JOIN catalog.resource_versions rv ON rv.id = sr.resource_version_id
    WHERE rv.resource_id <> sr.resource_id
  `);
  await requireCondition(invalidSessionPins === 0, `found ${invalidSessionPins} invalid session resource pins`);

  const orphanChunks = await count(`
    SELECT count(*)::text AS count
    FROM retrieval.resource_chunks c
    LEFT JOIN catalog.resource_versions rv ON rv.id = c.resource_version_id
    WHERE rv.id IS NULL
  `);
  await requireCondition(orphanChunks === 0, `found ${orphanChunks} orphaned retrieval chunks`);

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
    rlsTables: rlsTableCount,
    securityViews: views.length,
  }) + "\n");
} finally {
  await sql.end({ timeout: 5 });
}

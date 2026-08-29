import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const requiredDatabaseUrl = databaseUrl;

type SqlClient = ReturnType<typeof postgres>;

const ids = {
  userA: "00000000-0000-0000-0000-000000000001",
  userB: "00000000-0000-0000-0000-000000000002",
  concept: "00000000-0000-0000-0000-000000000101",
  publicResource: "00000000-0000-0000-0000-000000000201",
  privateResourceA: "00000000-0000-0000-0000-000000000202",
  privateResourceB: "00000000-0000-0000-0000-000000000203",
  publicVersion: "00000000-0000-0000-0000-000000000301",
  privateVersionA: "00000000-0000-0000-0000-000000000302",
  privateVersionB: "00000000-0000-0000-0000-000000000303",
  publicChunk: "00000000-0000-0000-0000-000000000401",
  sessionA: "00000000-0000-0000-0000-000000000501",
  sessionB: "00000000-0000-0000-0000-000000000502",
  exerciseVersion: "00000000-0000-0000-0000-000000000602",
  binding: "00000000-0000-0000-0000-000000000603",
  attemptA: "00000000-0000-0000-0000-000000000604",
  snapshotA: "00000000-0000-0000-0000-000000000605",
  testBundle: "00000000-0000-0000-0000-000000000606",
  executionRun: "00000000-0000-0000-0000-000000000607",
};

const seededVector = `[${Array.from({ length: 1536 }, (_, index) => index === 0 ? "1" : "0").join(",")}]`;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function roleUrl(environmentName: string, role: string): string {
  const configured = process.env[environmentName];
  if (configured) {
    return configured;
  }
  const parsed = new URL(requiredDatabaseUrl);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(`${environmentName} is required for non-local database tests`);
  }
  parsed.username = role;
  parsed.password = role;
  return parsed.toString();
}

function client(url: string): SqlClient {
  return postgres(url, { max: 2, prepare: false, connect_timeout: 10 });
}

async function expectRejected(operation: () => Promise<unknown>, label: string): Promise<void> {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${label} unexpectedly succeeded`);
}

async function visibleIds(database: SqlClient, userId: string | null, relation: string, column: string): Promise<string[]> {
  return database.begin(async (tx) => {
    if (userId) {
      await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    }
    const rows = await tx.unsafe<{ id: string }[]>(`SELECT ${column} AS id FROM ${relation} ORDER BY ${column}`);
    return rows.map((row) => row.id);
  });
}

const migrator = client(databaseUrl);
const app = client(roleUrl("DATABASE_APP_URL", "learnspace_app"));
const ai = client(roleUrl("DATABASE_AI_URL", "learnspace_ai"));
const runner = client(roleUrl("DATABASE_RUNNER_URL", "learnspace_runner"));

const tests: Array<[string, () => Promise<void>]> = [
  ["cross-user RLS isolation", async () => {
    assert.deepEqual(await visibleIds(app, ids.userA, "study.study_sessions", "id"), [ids.sessionA]);
    assert.deepEqual(await visibleIds(app, ids.userB, "study.study_sessions", "id"), [ids.sessionB]);
    assert.deepEqual(await visibleIds(app, null, "study.study_sessions", "id"), []);
    assert.deepEqual(
      await visibleIds(app, ids.userA, "catalog.resources", "id"),
      [ids.privateResourceA, ids.publicResource].sort(),
    );
    assert.deepEqual(
      await visibleIds(app, ids.userB, "catalog.resources", "id"),
      [ids.privateResourceB, ids.publicResource].sort(),
    );
  }],
  ["restricted service access and redacted execution views", async () => {
    await expectRejected(
      () => app`SELECT solution_outline FROM practice.exercise_versions WHERE id = ${ids.exerciseVersion}`,
      "application solution access",
    );
    await expectRejected(
      () => ai`SELECT object_key FROM practice.test_bundles WHERE id = ${ids.testBundle}`,
      "AI test bundle access",
    );
    await expectRejected(
      () => ai`INSERT INTO study.study_sessions (id, user_id, mode) VALUES ('00000000-0000-0000-0000-000000000699', ${ids.userA}, 'practice')`,
      "AI session mutation",
    );
    const payload = await runner<{ execution_run_id: string; source_code: string; test_bundle_object_key: string }[]>`
      SELECT execution_run_id, source_code, test_bundle_object_key
      FROM practice.runner_execution_payload
      WHERE execution_run_id = ${ids.executionRun}
    `;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]?.source_code.includes("enqueue"), true);
    assert.equal(payload[0]?.test_bundle_object_key, "seed/test-bundles/queue.json");
  }],
  ["StudySession resource-version integrity", async () => {
    await expectRejected(
      () => migrator`
        INSERT INTO study.session_resources (study_session_id, resource_id, resource_version_id, role, position, added_by, state)
        VALUES (${ids.sessionA}, ${ids.privateResourceA}, ${ids.publicVersion}, 'invalid', 99, 'db-test', '{}'::jsonb)
      `,
      "mismatched session resource version",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.resource_chunks (id, resource_version_id, ordinal, chunk_type, content, content_sha256, token_count)
        VALUES ('00000000-0000-0000-0000-000000000499', ${ids.publicVersion}, 99, 'paragraph', 'invalid', '9999999999999999999999999999999999999999999999999999999999999999', 0)
      `,
      "invalid retrieval chunk check",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, raw_object_key, mime_type, processing_status)
        VALUES ('00000000-0000-0000-0000-000000000398', ${ids.publicResource}, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'seed/duplicate', 'text/plain', 'ready')
      `,
      "duplicate resource version",
    );
    await expectRejected(
      () => migrator`UPDATE catalog.resource_versions SET raw_object_key = 'seed/tampered' WHERE id = ${ids.publicVersion}`,
      "ready resource version mutation",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO practice.execution_runs (id, attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool, runtime_image_digest, source_sha256, test_bundle_sha256, cpu_limit_ms, wall_limit_ms, memory_limit_bytes, result)
        VALUES ('00000000-0000-0000-0000-000000000399', ${ids.attemptA}, ${ids.snapshotA}, ${ids.testBundle}, '00000000-0000-0000-0000-000000000400', 'queued', 'db-test', 'sha256:seed-runtime', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '8888888888888888888888888888888888888888888888888888888888888888', 1000, 2000, 134217728, '{}'::jsonb)
      `,
      "execution source hash mismatch",
    );
  }],
  ["pgvector insertion and similarity search", async () => {
    const rows = await ai<{ chunk_id: string; similarity: number }[]>`
      SELECT chunk_id, 1 - (embedding <=> ${seededVector}::vector) AS similarity
      FROM retrieval.chunk_embeddings
      WHERE embedding_profile_id = 'seed-1536'
      ORDER BY embedding <=> ${seededVector}::vector
      LIMIT 1
    `;
    assert.equal(rows[0]?.chunk_id, ids.publicChunk);
    assert.equal(Number(rows[0]?.similarity), 1);
  }],
  ["transaction rollback", async () => {
    const resourceId = "00000000-0000-0000-0000-000000000709";
    let rolledBack = false;
    try {
      await migrator.begin(async (tx) => {
        await tx`
          INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, title, visibility, status, metadata)
          VALUES (${resourceId}, ${ids.userA}, 'note', 'db-test', 'rollback-resource', 'Rollback resource', 'private', 'ready', '{}'::jsonb)
        `;
        await tx`
          INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, payload)
          VALUES ('00000000-0000-0000-0000-000000000710', 'resource', ${resourceId}, 'resource.created', 1, '{}'::jsonb)
        `;
        throw new Error("intentional rollback");
      });
    } catch {
      rolledBack = true;
    }
    assert.equal(rolledBack, true);
    const rows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM catalog.resources WHERE id = ${resourceId}`;
    const outboxRows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM ops.outbox_events WHERE id = '00000000-0000-0000-0000-000000000710'`;
    assert.equal(rows[0]?.count, "0");
    assert.equal(outboxRows[0]?.count, "0");
  }],
  ["domain mutation and outbox atomicity", async () => {
    const eventId = "00000000-0000-0000-0000-000000000711";
    const outboxId = "00000000-0000-0000-0000-000000000712";
    await migrator`DELETE FROM activity.activity_events WHERE id = ${eventId}`;
    await migrator`DELETE FROM ops.outbox_events WHERE id = ${outboxId}`;
    await migrator.begin(async (tx) => {
      await tx`
        INSERT INTO activity.activity_events (id, schema_version, user_id, study_session_id, resource_id, resource_version_id, event_type, actor_type, source, idempotency_key, occurred_at, payload)
        VALUES (${eventId}, 1, ${ids.userA}, ${ids.sessionA}, ${ids.publicResource}, ${ids.publicVersion}, 'resource.opened', 'user', 'db-test', 'atomic-event-1', '2026-01-01T00:00:00.000Z', '{"test":true}'::jsonb)
      `;
      await tx`
        INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, aggregate_version, event_type, schema_version, user_id, study_session_id, payload)
        VALUES (${outboxId}, 'study_session', ${ids.sessionA}, 1, 'activity.recorded', 1, ${ids.userA}, ${ids.sessionA}, '{"test":true}'::jsonb)
      `;
    });
    const eventRows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM activity.activity_events WHERE id = ${eventId}`;
    const outboxRows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM ops.outbox_events WHERE id = ${outboxId}`;
    assert.equal(eventRows[0]?.count, "1");
    assert.equal(outboxRows[0]?.count, "1");
    await migrator`DELETE FROM activity.activity_events WHERE id = ${eventId}`;
    await migrator`DELETE FROM ops.outbox_events WHERE id = ${outboxId}`;
  }],
  ["durable job claiming with FOR UPDATE SKIP LOCKED", async () => {
    const jobOne = "00000000-0000-0000-0000-000000000713";
    const jobTwo = "00000000-0000-0000-0000-000000000714";
    await migrator`DELETE FROM ops.jobs WHERE id IN (${jobOne}, ${jobTwo})`;
    await migrator`
      INSERT INTO ops.jobs (id, queue, job_type, payload, status, priority, max_attempts)
      VALUES (${jobOne}, 'db-test', 'claim', '{}'::jsonb, 'pending', 10, 3),
             (${jobTwo}, 'db-test', 'claim', '{}'::jsonb, 'pending', 9, 3)
    `;
    const first = client(databaseUrl);
    const second = client(databaseUrl);
    let release!: () => void;
    let unlock!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const lockedPromise = new Promise<void>((resolve) => { unlock = resolve; });
    const firstClaim = first.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id
        FROM ops.jobs
        WHERE queue = 'db-test' AND status = 'pending' AND available_at <= now()
        ORDER BY priority DESC, available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      assert.equal(rows.length, 1);
      unlock();
      await releasePromise;
      await tx`UPDATE ops.jobs SET status = 'running', lease_owner = 'claim-a', attempts = attempts + 1 WHERE id = ${rows[0]!.id}`;
      return rows[0]!.id;
    });
    await lockedPromise;
    let secondRows: Array<{ id: string }> = [];
    try {
      secondRows = await second.begin(async (tx) => tx<{ id: string }[]>`
        SELECT id
        FROM ops.jobs
        WHERE queue = 'db-test' AND status = 'pending' AND available_at <= now()
        ORDER BY priority DESC, available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
    } finally {
      release();
    }
    const firstId = await firstClaim;
    assert.equal(firstId, jobOne);
    assert.equal(secondRows[0]?.id, jobTwo);
    await first.end({ timeout: 5 });
    await second.end({ timeout: 5 });
    await migrator`UPDATE ops.jobs SET status = 'done', finished_at = now(), updated_at = now() WHERE id IN (${jobOne}, ${jobTwo})`;
  }],
  ["idempotency and deduplication", async () => {
    const jobOne = "00000000-0000-0000-0000-000000000715";
    const jobTwo = "00000000-0000-0000-0000-000000000716";
    await migrator`DELETE FROM ops.jobs WHERE id IN (${jobOne}, ${jobTwo})`;
    await migrator`
      INSERT INTO ops.jobs (id, queue, job_type, payload, status, dedup_key, max_attempts)
      VALUES (${jobOne}, 'db-dedup', 'dedup', '{}'::jsonb, 'pending', 'same-key', 3)
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO ops.jobs (id, queue, job_type, payload, status, dedup_key, max_attempts)
        VALUES (${jobTwo}, 'db-dedup', 'dedup', '{}'::jsonb, 'pending', 'same-key', 3)
      `,
      "active job deduplication",
    );
    await migrator`DELETE FROM ops.idempotency_records WHERE scope = 'db-test' AND idempotency_key = 'same-request'`;
    await migrator`
      INSERT INTO ops.idempotency_records (scope, idempotency_key, user_id, request_sha256, status, expires_at)
      VALUES ('db-test', 'same-request', ${ids.userA}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'completed', '2027-01-01T00:00:00.000Z')
      ON CONFLICT (scope, idempotency_key) DO NOTHING
    `;
    await migrator`
      INSERT INTO ops.idempotency_records (scope, idempotency_key, user_id, request_sha256, status, expires_at)
      VALUES ('db-test', 'same-request', ${ids.userA}, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'completed', '2027-01-01T00:00:00.000Z')
      ON CONFLICT (scope, idempotency_key) DO NOTHING
    `;
    const rows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM ops.idempotency_records WHERE scope = 'db-test' AND idempotency_key = 'same-request'`;
    assert.equal(rows[0]?.count, "1");
  }],
];

let failures = 0;

try {
  for (const [name, test] of tests) {
    try {
      await test();
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
} finally {
  await Promise.all([
    migrator.end({ timeout: 5 }),
    app.end({ timeout: 5 }),
    ai.end({ timeout: 5 }),
    runner.end({ timeout: 5 }),
  ]);
}

if (failures > 0) {
  throw new Error(`${failures} database test(s) failed`);
}

process.stdout.write(`Database tests passed: ${tests.length}\n`);

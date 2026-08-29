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
  goalA: "00000000-0000-0000-0000-000000000111",
  goalB: "00000000-0000-0000-0000-000000000112",
  concept: "00000000-0000-0000-0000-000000000101",
  publicResource: "00000000-0000-0000-0000-000000000201",
  privateResourceA: "00000000-0000-0000-0000-000000000202",
  privateResourceB: "00000000-0000-0000-0000-000000000203",
  publicVersion: "00000000-0000-0000-0000-000000000301",
  privateVersionA: "00000000-0000-0000-0000-000000000302",
  privateVersionB: "00000000-0000-0000-0000-000000000303",
  publicChunk: "00000000-0000-0000-0000-000000000401",
  privateChunkA: "00000000-0000-0000-0000-000000000402",
  privateChunkB: "00000000-0000-0000-0000-000000000403",
  sessionA: "00000000-0000-0000-0000-000000000501",
  sessionB: "00000000-0000-0000-0000-000000000502",
  exercise: "00000000-0000-0000-0000-000000000601",
  exerciseVersion: "00000000-0000-0000-0000-000000000602",
  binding: "00000000-0000-0000-0000-000000000603",
  attemptA: "00000000-0000-0000-0000-000000000604",
  snapshotA: "00000000-0000-0000-0000-000000000605",
  testBundle: "00000000-0000-0000-0000-000000000606",
  executionRun: "00000000-0000-0000-0000-000000000607",
  exerciseB: "00000000-0000-0000-0000-000000000608",
  exerciseVersionB: "00000000-0000-0000-0000-000000000609",
  testBundleB: "00000000-0000-0000-0000-000000000610",
  authAccountA: "00000000-0000-0000-0000-000000000801",
  authAccountB: "00000000-0000-0000-0000-000000000802",
  authSessionA: "00000000-0000-0000-0000-000000000803",
  authSessionB: "00000000-0000-0000-0000-000000000804",
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
const worker = client(roleUrl("DATABASE_WORKER_URL", "learnspace_worker"));
const runner = client(roleUrl("DATABASE_RUNNER_URL", "learnspace_runner"));

const tests: Array<[string, () => Promise<void>]> = [
  ["identity and domain RLS isolation", async () => {
    assert.deepEqual(await visibleIds(app, ids.userA, "identity.users", "id"), [ids.userA]);
    assert.deepEqual(await visibleIds(app, ids.userA, "identity.auth_accounts", "id"), [ids.authAccountA]);
    assert.deepEqual(await visibleIds(app, ids.userA, "identity.auth_sessions", "id"), [ids.authSessionA]);
    assert.deepEqual(await visibleIds(app, ids.userB, "identity.auth_sessions", "id"), [ids.authSessionB]);
    assert.deepEqual(await visibleIds(app, null, "identity.auth_sessions", "id"), []);
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
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO identity.auth_accounts (id, user_id, provider, provider_account_id, profile)
          VALUES ('00000000-0000-0000-0000-000000000821', ${ids.userB}, 'db-test', 'cross-user', '{}'::jsonb)
        `;
      }),
      "cross-user auth account insert",
    );
  }],
  ["restricted service access and execution authority", async () => {
    await expectRejected(
      () => app`SELECT solution_outline FROM practice.exercise_versions WHERE id = ${ids.exerciseVersion}`,
      "application solution access",
    );
    await expectRejected(
      () => app`SELECT object_key FROM practice.test_bundles WHERE id = ${ids.testBundle}`,
      "application test bundle access",
    );
    await expectRejected(
      () => ai`SELECT object_key FROM practice.test_bundles WHERE id = ${ids.testBundle}`,
      "AI test bundle access",
    );
    await expectRejected(
      () => ai`INSERT INTO study.study_sessions (id, user_id, mode) VALUES ('00000000-0000-0000-0000-000000000699', ${ids.userA}, 'practice')`,
      "AI session mutation",
    );
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO practice.execution_runs (id, attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool, runtime_image_digest, source_sha256, test_bundle_sha256, cpu_limit_ms, wall_limit_ms, memory_limit_bytes, result)
          VALUES ('00000000-0000-0000-0000-000000000822', ${ids.attemptA}, ${ids.snapshotA}, ${ids.testBundle}, '00000000-0000-0000-0000-000000000823', 'succeeded', 'app', 'sha256:seed-runtime', '7777777777777777777777777777777777777777777777777777777777777777', '8888888888888888888888888888888888888888888888888888888888888888', 1000, 2000, 134217728, '{"forged":true}'::jsonb)
        `;
      }),
      "application forged execution result",
    );
    await expectRejected(
      () => app`UPDATE practice.execution_runs SET result = '{"forged":true}'::jsonb, status = 'failed' WHERE id = ${ids.executionRun}`,
      "application execution result update",
    );
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO practice.exercises (id, kind, canonical_concept_id, title, status, created_by, owner_user_id, metadata)
          VALUES ('00000000-0000-0000-0000-000000000826', 'code', ${ids.concept}, 'User global publication', 'active', 'app', NULL, '{}'::jsonb)
        `;
      }),
      "user publishing global exercise",
    );
    const enqueueId = "00000000-0000-0000-0000-000000000824";
    const enqueueRequestId = "00000000-0000-0000-0000-000000000825";
    await migrator`DELETE FROM practice.execution_runs WHERE id = ${enqueueId}`;
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      await tx`
        INSERT INTO practice.execution_runs (id, attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool, runtime_image_digest, source_sha256, test_bundle_sha256, cpu_limit_ms, wall_limit_ms, memory_limit_bytes)
        VALUES (${enqueueId}, ${ids.attemptA}, ${ids.snapshotA}, ${ids.testBundle}, ${enqueueRequestId}, 'queued', 'app', 'sha256:seed-runtime', '7777777777777777777777777777777777777777777777777777777777777777', '8888888888888888888888888888888888888888888888888888888888888888', 1000, 2000, 134217728)
      `;
    });
    const queued = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return tx<{ status: string; result: Record<string, unknown> }[]>`SELECT status, result FROM practice.execution_runs WHERE id = ${enqueueId}`;
    });
    assert.equal(queued[0]?.status, "queued");
    await runner`UPDATE practice.execution_runs SET status = 'succeeded', result = '{"passed":true}', started_at = now(), completed_at = now() WHERE id = ${enqueueId}`;
    const result = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return tx<{ status: string; result: Record<string, unknown> }[]>`SELECT status, result FROM practice.execution_runs WHERE id = ${enqueueId}`;
    });
    assert.equal(result[0]?.status, "succeeded");
    assert.equal(result[0]?.result.passed, true);
    await migrator`DELETE FROM practice.execution_runs WHERE id = ${enqueueId}`;
    const payload = await runner<{ execution_run_id: string; source_code: string; test_bundle_object_key: string }[]>`
      SELECT execution_run_id, source_code, test_bundle_object_key
      FROM practice.runner_execution_payload
      WHERE execution_run_id = ${ids.executionRun}
    `;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]?.source_code.includes("enqueue"), true);
    assert.equal(payload[0]?.test_bundle_object_key, "seed/test-bundles/queue.json");
    const publishedExercise = "00000000-0000-0000-0000-000000000826";
    await worker`
      INSERT INTO practice.exercises (id, kind, canonical_concept_id, title, status, created_by, owner_user_id, metadata)
      VALUES (${publishedExercise}, 'code', ${ids.concept}, 'Worker publication', 'active', 'worker', NULL, '{}'::jsonb)
    `;
    await migrator`DELETE FROM practice.exercises WHERE id = ${publishedExercise}`;
  }],
  ["StudySession, checkpoint, and resource-version integrity", async () => {
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO study.study_sessions (id, user_id, learning_goal_id, mode, status)
          VALUES ('00000000-0000-0000-0000-000000000827', ${ids.userA}, ${ids.goalB}, 'practice', 'active')
        `;
      }),
      "session using another user's goal",
    );
    await expectRejected(
      () => migrator`UPDATE study.study_sessions SET active_chunk_id = ${ids.privateChunkB} WHERE id = ${ids.sessionA}`,
      "session active chunk from wrong version",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.session_resources (study_session_id, resource_id, resource_version_id, role, added_by)
        VALUES (${ids.sessionA}, ${ids.publicResource}, ${ids.privateVersionA}, 'invalid-version', 'db-test')
      `,
      "session resource version mismatch",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.session_checkpoints (id, study_session_id, kind, resource_id, resource_version_id, resource_chunk_id, state)
        VALUES ('00000000-0000-0000-0000-000000000828', ${ids.sessionA}, 'invalid-version', ${ids.publicResource}, ${ids.privateVersionA}, NULL, '{}'::jsonb)
      `,
      "checkpoint resource version mismatch",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.session_checkpoints (id, study_session_id, kind, resource_id, resource_version_id, resource_chunk_id, state)
        VALUES ('00000000-0000-0000-0000-000000000829', ${ids.sessionA}, 'invalid-chunk', ${ids.publicResource}, ${ids.publicVersion}, ${ids.privateChunkB}, '{}'::jsonb)
      `,
      "checkpoint chunk version mismatch",
    );
    const pendingVersion = "00000000-0000-0000-0000-000000000830";
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, raw_object_key, mime_type, processing_status)
      VALUES (${pendingVersion}, ${ids.publicResource}, 2, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'seed/pending', 'text/plain', 'processing')
    `;
    await expectRejected(
      () => migrator`UPDATE catalog.resources SET current_version_id = ${pendingVersion} WHERE id = ${ids.publicResource}`,
      "current version points to non-ready version",
    );
    await migrator`UPDATE catalog.resource_versions SET processing_status = 'ready', ready_at = now() WHERE id = ${pendingVersion}`;
    await expectRejected(
      () => migrator`UPDATE catalog.resource_versions SET raw_object_key = 'seed/immutable' WHERE id = ${pendingVersion}`,
      "ready resource version mutation",
    );
    await migrator`UPDATE catalog.resources SET current_version_id = ${pendingVersion} WHERE id = ${ids.publicResource}`;
    await migrator`UPDATE catalog.resources SET current_version_id = ${ids.publicVersion} WHERE id = ${ids.publicResource}`;
    await expectRejected(
      () => migrator`UPDATE catalog.resources SET current_version_id = ${ids.privateVersionA} WHERE id = ${ids.publicResource}`,
      "current version points to another resource",
    );
    await migrator`DELETE FROM catalog.resource_versions WHERE id = ${pendingVersion}`;
  }],
  ["activity, retrieval, and citation provenance", async () => {
    const retrievalRun = "00000000-0000-0000-0000-000000000831";
    const retrievedChunk = ids.publicChunk;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${retrievalRun}`;
    await migrator`
      INSERT INTO retrieval.retrieval_runs (id, user_id, study_session_id, query_text, query_sha256, embedding_profile_id, scope, strategy_version, status)
      VALUES (${retrievalRun}, ${ids.userA}, ${ids.sessionA}, 'db test', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'seed-1536', '{}'::jsonb, 'db-test', 'completed')
    `;
    await migrator`
      INSERT INTO retrieval.retrieved_chunks (retrieval_run_id, chunk_id, candidate_rank, selected, reason_codes)
      VALUES (${retrievalRun}, ${retrievedChunk}, 1, true, '[]'::jsonb)
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.citations (id, retrieval_run_id, chunk_id, resource_version_id, ordinal, anchor_snapshot)
        VALUES ('00000000-0000-0000-0000-000000000832', ${retrievalRun}, ${ids.privateChunkA}, ${ids.privateVersionA}, 1, '{}'::jsonb)
      `,
      "citation for chunk not retrieved",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.citations (id, retrieval_run_id, chunk_id, resource_version_id, ordinal, anchor_snapshot)
        VALUES ('00000000-0000-0000-0000-000000000833', ${retrievalRun}, ${ids.publicChunk}, ${ids.privateVersionA}, 1, '{}'::jsonb)
      `,
      "citation with incorrect resource version",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO activity.activity_events (id, schema_version, user_id, study_session_id, resource_id, resource_version_id, event_type, actor_type, source, occurred_at, payload)
        VALUES ('00000000-0000-0000-0000-000000000834', 1, ${ids.userB}, ${ids.sessionA}, ${ids.publicResource}, ${ids.publicVersion}, 'resource.opened', 'user', 'db-test', '2026-01-01T00:00:00.000Z', '{}'::jsonb)
      `,
      "activity event with mismatched session user",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO activity.activity_events (id, schema_version, user_id, study_session_id, resource_id, resource_version_id, resource_chunk_id, event_type, actor_type, source, occurred_at, payload)
        VALUES ('00000000-0000-0000-0000-000000000835', 1, ${ids.userA}, ${ids.sessionA}, ${ids.publicResource}, ${ids.publicVersion}, ${ids.privateChunkA}, 'resource.opened', 'user', 'db-test', '2026-01-01T00:00:00.000Z', '{}'::jsonb)
      `,
      "activity chunk from wrong version",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.resource_chunks (id, resource_version_id, parent_chunk_id, ordinal, chunk_type, content, content_sha256, token_count)
        VALUES ('00000000-0000-0000-0000-000000000836', ${ids.privateVersionA}, ${ids.publicChunk}, 9, 'paragraph', 'invalid parent', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 3)
      `,
      "cross-resource parent chunk",
    );
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${retrievalRun}`;
  }],
  ["practice provenance and tutor ownership", async () => {
    await expectRejected(
      () => migrator`
        INSERT INTO practice.exercise_attempts (id, user_id, study_session_id, exercise_binding_id, exercise_version_id, status, language, metadata)
        VALUES ('00000000-0000-0000-0000-000000000837', ${ids.userA}, ${ids.sessionA}, ${ids.binding}, ${ids.exerciseVersionB}, 'started', 'typescript', '{}'::jsonb)
      `,
      "attempt using wrong exercise version",
    );
    const attemptB = "00000000-0000-0000-0000-000000000838";
    const snapshotB = "00000000-0000-0000-0000-000000000839";
    await migrator`DELETE FROM practice.exercise_attempts WHERE id = ${attemptB}`;
    await migrator`
      INSERT INTO practice.exercise_attempts (id, user_id, study_session_id, exercise_binding_id, exercise_version_id, status, language, metadata)
      VALUES (${attemptB}, ${ids.userA}, ${ids.sessionA}, ${ids.binding}, ${ids.exerciseVersion}, 'started', 'typescript', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO practice.code_snapshots (id, attempt_id, sequence_no, kind, source_code, source_sha256)
      VALUES (${snapshotB}, ${attemptB}, 0, 'edit', 'export const retry = true;', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO practice.code_snapshots (id, attempt_id, sequence_no, kind, source_code, source_sha256, parent_snapshot_id)
        VALUES ('00000000-0000-0000-0000-000000000840', ${ids.attemptA}, 10, 'edit', 'invalid parent', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', ${snapshotB})
      `,
      "code snapshot from another attempt",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO practice.execution_runs (id, attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool, runtime_image_digest, source_sha256, test_bundle_sha256, cpu_limit_ms, wall_limit_ms, memory_limit_bytes)
        VALUES ('00000000-0000-0000-0000-000000000841', ${ids.attemptA}, ${snapshotB}, ${ids.testBundle}, '00000000-0000-0000-0000-000000000842', 'queued', 'db-test', 'sha256:seed-runtime', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '8888888888888888888888888888888888888888888888888888888888888888', 1000, 2000, 134217728)
      `,
      "execution using snapshot from another attempt",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO practice.execution_runs (id, attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool, runtime_image_digest, source_sha256, test_bundle_sha256, cpu_limit_ms, wall_limit_ms, memory_limit_bytes)
        VALUES ('00000000-0000-0000-0000-000000000843', ${ids.attemptA}, ${ids.snapshotA}, ${ids.testBundleB}, '00000000-0000-0000-0000-000000000844', 'queued', 'db-test', 'sha256:seed-runtime', '7777777777777777777777777777777777777777777777777777777777777777', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1000, 2000, 134217728)
      `,
      "execution using test bundle from another exercise",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.tutor_threads (id, user_id, study_session_id, mode, status, metadata)
        VALUES ('00000000-0000-0000-0000-000000000845', ${ids.userB}, ${ids.sessionA}, 'guided', 'active', '{}'::jsonb)
      `,
      "tutor thread user mismatch",
    );
    await migrator`DELETE FROM practice.exercise_attempts WHERE id = ${attemptB}`;
  }],
  ["embedding integrity and vector similarity", async () => {
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.embedding_profiles (id, provider, model_name, dimensions, distance_metric, status)
        VALUES ('db-test-bad-dim', 'db-test', 'bad-dim', 3072, 'cosine', 'active')
      `,
      "embedding profile dimension mismatch",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.embedding_profiles (id, provider, model_name, dimensions, distance_metric, status)
        VALUES ('db-test-bad-distance', 'db-test', 'bad-distance', 1536, 'euclidean', 'active')
      `,
      "embedding profile distance mismatch",
    );
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
    const resourceId = "00000000-0000-0000-0000-000000000846";
    let rolledBack = false;
    try {
      await migrator.begin(async (tx) => {
        await tx`
          INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, title, visibility, status, metadata)
          VALUES (${resourceId}, ${ids.userA}, 'note', 'db-test', 'rollback-resource', 'Rollback resource', 'private', 'ready', '{}'::jsonb)
        `;
        await tx`
          INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, payload)
          VALUES ('00000000-0000-0000-0000-000000000847', 'resource', ${resourceId}, 'resource.created', 1, '{}'::jsonb)
        `;
        throw new Error("intentional rollback");
      });
    } catch {
      rolledBack = true;
    }
    assert.equal(rolledBack, true);
    const rows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM catalog.resources WHERE id = ${resourceId}`;
    const outboxRows = await migrator<{ count: string }[]>`SELECT count(*)::text AS count FROM ops.outbox_events WHERE id = '00000000-0000-0000-0000-000000000847'`;
    assert.equal(rows[0]?.count, "0");
    assert.equal(outboxRows[0]?.count, "0");
  }],
  ["domain mutation and outbox atomicity", async () => {
    const eventId = "00000000-0000-0000-0000-000000000848";
    const outboxId = "00000000-0000-0000-0000-000000000849";
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
    const jobOne = "00000000-0000-0000-0000-000000000850";
    const jobTwo = "00000000-0000-0000-0000-000000000851";
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
  ["idempotency conflict and replay semantics", async () => {
    const scope = "db-test";
    const key = "same-request";
    await migrator`DELETE FROM ops.idempotency_records WHERE scope = ${scope} AND idempotency_key = ${key}`;
    const first = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      const claimed = await tx<{ scope: string; idempotency_key: string; status: string; response_body: Record<string, unknown> | null }[]>`
        SELECT scope, idempotency_key, status, response_body
        FROM ops.claim_idempotency(${scope}, ${key}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2027-01-01T00:00:00.000Z')
      `;
      const completed = await tx<{ response_body: Record<string, unknown> | null }[]>`
        SELECT response_body
        FROM ops.complete_idempotency(${scope}, ${key}, 'completed', 200, '{"ok":true}'::jsonb)
      `;
      return { claimed, completed };
    });
    assert.equal(first.claimed[0]?.status, "in_progress");
    assert.deepEqual(first.completed[0]?.response_body, { ok: true });
    const replay = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return tx<{ status: string; response_body: Record<string, unknown> | null }[]>`
        SELECT status, response_body
        FROM ops.claim_idempotency(${scope}, ${key}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2027-01-01T00:00:00.000Z')
      `;
    });
    assert.equal(replay[0]?.status, "completed");
    assert.deepEqual(replay[0]?.response_body, { ok: true });
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          SELECT *
          FROM ops.claim_idempotency(${scope}, ${key}, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2027-01-01T00:00:00.000Z')
        `;
      }),
      "idempotency key reused with different request hash",
    );
    await migrator`DELETE FROM ops.idempotency_records WHERE scope = ${scope} AND idempotency_key = ${key}`;
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
    worker.end({ timeout: 5 }),
    runner.end({ timeout: 5 }),
  ]);
}

if (failures > 0) {
  throw new Error(`${failures} database test(s) failed`);
}

process.stdout.write(`Database tests passed: ${tests.length}\n`);

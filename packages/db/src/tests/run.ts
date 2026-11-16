import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATOR_URL is required");
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
  authAccountA: "00000000-0000-0000-0000-000000000801",
  authAccountB: "00000000-0000-0000-0000-000000000802",
  authSessionA: "00000000-0000-0000-0000-000000000803",
  authSessionB: "00000000-0000-0000-0000-000000000804",
  hardeningProgress: "00000000-0000-0000-0000-000000000964",
  hardeningThreadA: "00000000-0000-0000-0000-000000000970",
  hardeningThreadB: "00000000-0000-0000-0000-000000000971",
  hardeningAgentRunA: "00000000-0000-0000-0000-000000000972",
  hardeningAgentRunB: "00000000-0000-0000-0000-000000000973",
  hardeningModelInvocationA: "00000000-0000-0000-0000-000000000974",
  hardeningModelInvocationB: "00000000-0000-0000-0000-000000000975",
  hardeningMessageA: "00000000-0000-0000-0000-000000000976",
  hardeningMessageB: "00000000-0000-0000-0000-000000000977",
  hardeningCrossSourceMessage: "00000000-0000-0000-0000-000000000978",
  hardeningArtifactResource: "00000000-0000-0000-0000-000000000979",
  hardeningArtifactSourceRun: "00000000-0000-0000-0000-000000000980",
  hardeningCitationRun: "00000000-0000-0000-0000-000000000981",
  hardeningCitation: "00000000-0000-0000-0000-000000000982",
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
const auth = client(roleUrl("DATABASE_AUTH_URL", "learnspace_auth"));
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
    const userAResources = await visibleIds(app, ids.userA, "catalog.resources", "id");
    assert.ok(userAResources.includes(ids.privateResourceA));
    assert.ok(userAResources.includes(ids.publicResource));
    assert.equal(userAResources.includes(ids.privateResourceB), false);
    const userBResources = await visibleIds(app, ids.userB, "catalog.resources", "id");
    assert.ok(userBResources.includes(ids.privateResourceB));
    assert.ok(userBResources.includes(ids.publicResource));
    assert.equal(userBResources.includes(ids.privateResourceA), false);
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
    const crossUserAuthSessionUpdate = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return tx<{ id: string }[]>`
        UPDATE identity.auth_sessions
        SET revocation_reason = 'cross-user'
        WHERE id = ${ids.authSessionB}
        RETURNING id
      `;
    });
    assert.equal(crossUserAuthSessionUpdate.length, 0);
    const crossUserAuthSessionDelete = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return tx<{ id: string }[]>`
        DELETE FROM identity.auth_sessions
        WHERE id = ${ids.authSessionB}
        RETURNING id
      `;
    });
    assert.equal(crossUserAuthSessionDelete.length, 0);
  }],
  ["auth role has only auth privileges", async () => {
    const [privileges] = await auth<{
      users_select: boolean;
      users_email_insert: boolean;
      users_delete: boolean;
      users_password_update: boolean;
      users_email_update: boolean;
      sessions_user_insert: boolean;
      sessions_revoke_update: boolean;
      sessions_user_update: boolean;
      challenges_user_insert: boolean;
      challenges_consume_update: boolean;
      challenges_user_update: boolean;
    }[]>`SELECT
      has_table_privilege(current_user, 'identity.users', 'SELECT') AS users_select,
      has_column_privilege(current_user, 'identity.users', 'email', 'INSERT') AS users_email_insert,
      has_table_privilege(current_user, 'identity.users', 'DELETE') AS users_delete,
      has_column_privilege(current_user, 'identity.users', 'password_hash', 'UPDATE') AS users_password_update,
      has_column_privilege(current_user, 'identity.users', 'email', 'UPDATE') AS users_email_update,
      has_column_privilege(current_user, 'identity.auth_sessions', 'user_id', 'INSERT') AS sessions_user_insert,
      has_column_privilege(current_user, 'identity.auth_sessions', 'revoked_at', 'UPDATE') AS sessions_revoke_update,
      has_column_privilege(current_user, 'identity.auth_sessions', 'user_id', 'UPDATE') AS sessions_user_update,
      has_column_privilege(current_user, 'identity.auth_challenges', 'user_id', 'INSERT') AS challenges_user_insert,
      has_column_privilege(current_user, 'identity.auth_challenges', 'consumed_at', 'UPDATE') AS challenges_consume_update,
      has_column_privilege(current_user, 'identity.auth_challenges', 'user_id', 'UPDATE') AS challenges_user_update
    `;
    assert.equal(privileges?.users_select, true);
    assert.equal(privileges?.users_email_insert, true);
    assert.equal(privileges?.users_delete, false);
    assert.equal(privileges?.users_password_update, true);
    assert.equal(privileges?.users_email_update, false);
    assert.equal(privileges?.sessions_user_insert, true);
    assert.equal(privileges?.sessions_revoke_update, true);
    assert.equal(privileges?.sessions_user_update, false);
    assert.equal(privileges?.challenges_user_insert, true);
    assert.equal(privileges?.challenges_consume_update, true);
    assert.equal(privileges?.challenges_user_update, false);

    for (const relation of [
      "catalog.resources",
      "study.study_sessions",
      "activity.activity_events",
      "retrieval.resource_chunks",
      "practice.coding_attempts",
      "practice.coding_problem_secrets",
      "knowledge.concepts",
      "agent.agent_runs",
      "discovery.recommendation_runs",
      "ops.jobs",
    ]) {
      await expectRejected(
        () => auth.unsafe(`SELECT 1 FROM ${relation} LIMIT 1`),
        `auth role unrelated access: ${relation}`,
      );
    }
    await expectRejected(
      () => auth`DELETE FROM identity.users WHERE false`,
      "auth role deleting users",
    );
    await expectRejected(
      () => auth`UPDATE identity.users SET email = email WHERE false`,
      "auth role changing user email",
    );
    await expectRejected(
      () => auth`UPDATE identity.auth_challenges SET user_id = user_id WHERE false`,
      "auth role changing challenge owner",
    );
  }],
  ["worker catalogue importer privileges are bounded", async () => {
    const [privileges] = await worker<{
      resources_insert: boolean;
      resources_update: boolean;
      resources_delete: boolean;
      video_insert: boolean;
      video_update: boolean;
      metrics_insert: boolean;
      concepts_insert: boolean;
      quality_insert: boolean;
      quality_update: boolean;
      quality_delete: boolean;
      knowledge_select: boolean;
      aliases_select: boolean;
    }[]>`SELECT
      has_table_privilege(current_user, 'catalog.resources', 'INSERT') AS resources_insert,
      has_table_privilege(current_user, 'catalog.resources', 'UPDATE') AS resources_update,
      has_table_privilege(current_user, 'catalog.resources', 'DELETE') AS resources_delete,
      has_table_privilege(current_user, 'catalog.video_details', 'INSERT') AS video_insert,
      has_table_privilege(current_user, 'catalog.video_details', 'UPDATE') AS video_update,
      has_table_privilege(current_user, 'catalog.video_metric_snapshots', 'INSERT') AS metrics_insert,
      has_table_privilege(current_user, 'catalog.resource_concepts', 'INSERT') AS concepts_insert,
      has_table_privilege(current_user, 'discovery.resource_quality_snapshots', 'INSERT') AS quality_insert,
      has_table_privilege(current_user, 'discovery.resource_quality_snapshots', 'UPDATE') AS quality_update,
      has_table_privilege(current_user, 'discovery.resource_quality_snapshots', 'DELETE') AS quality_delete,
      has_table_privilege(current_user, 'knowledge.concepts', 'SELECT') AS knowledge_select,
      has_table_privilege(current_user, 'knowledge.concept_aliases', 'SELECT') AS aliases_select
    `;
    assert.equal(privileges?.resources_insert, true);
    assert.equal(privileges?.resources_update, true);
    assert.equal(privileges?.resources_delete, false);
    assert.equal(privileges?.video_insert, true);
    assert.equal(privileges?.video_update, true);
    assert.equal(privileges?.metrics_insert, true);
    assert.equal(privileges?.concepts_insert, true);
    assert.equal(privileges?.quality_insert, true);
    assert.equal(privileges?.quality_update, true);
    assert.equal(privileges?.quality_delete, false);
    assert.equal(privileges?.knowledge_select, true);
    assert.equal(privileges?.aliases_select, true);
  }],
  ["restricted service access and grading authority", async () => {
    const problemId = "00000000-0000-0000-0000-000000000821";
    await migrator`DELETE FROM practice.coding_problems WHERE id = ${problemId}`;
    const asLearner = <T>(work: (tx: postgres.TransactionSql) => Promise<T>) => app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return work(tx);
    });
    await expectRejected(
      () => ai`INSERT INTO study.study_sessions (id, user_id, mode) VALUES ('00000000-0000-0000-0000-000000000699', ${ids.userA}, 'practice')`,
      "AI session mutation",
    );
    await expectRejected(
      () => asLearner((tx) => tx`INSERT INTO practice.coding_problems (id, concept, difficulty, status, contract_version) VALUES (${problemId}, 'arrays', 'easy', 'verified', 'db-test')`),
      "application publishing a verified problem",
    );
    // The app authors a problem: it may write its hidden half, never read it back.
    await asLearner(async (tx) => {
      await tx`INSERT INTO practice.coding_problems (id, concept, difficulty, status, title, spec, tutor, contract_version) VALUES (${problemId}, 'arrays', 'easy', 'generating', 'Sum', '{}'::jsonb, '{}'::jsonb, 'db-test')`;
      await tx`INSERT INTO practice.coding_problem_secrets (problem_id, authored) VALUES (${problemId}, '{"optimal":"def solve(a): return sum(a)"}'::jsonb)`;
    });
    await expectRejected(() => asLearner((tx) => tx`SELECT authored FROM practice.coding_problem_secrets WHERE problem_id = ${problemId}`), "application reading hidden tests");
    await expectRejected(() => ai`SELECT authored FROM practice.coding_problem_secrets WHERE problem_id = ${problemId}`, "AI reading hidden tests");
    await expectRejected(() => asLearner((tx) => tx`UPDATE practice.coding_problem_secrets SET tests = '{"forged":true}'::jsonb WHERE problem_id = ${problemId}`), "application rewriting hidden tests");
    await expectRejected(() => asLearner((tx) => tx`UPDATE practice.coding_problems SET status = 'verified', verified_at = now() WHERE id = ${problemId}`), "application marking a problem verified");
    await asLearner((tx) => tx`UPDATE practice.coding_problems SET status = 'verifying' WHERE id = ${problemId}`);
    // The runner verifies it: it reads the hidden half, stores the tests and publishes the problem.
    const secrets = await runner<{ authored: Record<string, unknown> }[]>`SELECT authored FROM practice.coding_problem_secrets WHERE problem_id = ${problemId}`;
    assert.equal(secrets[0]?.authored.optimal, "def solve(a): return sum(a)");
    await expectRejected(() => runner`UPDATE practice.coding_problem_secrets SET authored = '{}'::jsonb WHERE problem_id = ${problemId}`, "runner rewriting authored references");
    await expectRejected(() => runner`UPDATE practice.coding_problems SET spec = '{"forged":true}'::jsonb WHERE id = ${problemId}`, "runner rewriting a problem statement");
    await runner`UPDATE practice.coding_problem_secrets SET tests = '{"small":[],"large":[]}'::jsonb, perf_limit_ms = 1000 WHERE problem_id = ${problemId}`;
    await runner`UPDATE practice.coding_problems SET status = 'verified', verified_at = now() WHERE id = ${problemId}`;
    // A verified problem is fixed: the app's update matches nothing.
    await asLearner((tx) => tx`UPDATE practice.coding_problems SET status = 'rejected', title = 'Forged' WHERE id = ${problemId}`);
    const published = await migrator<{ status: string; title: string }[]>`SELECT status, title FROM practice.coding_problems WHERE id = ${problemId}`;
    assert.deepEqual(published[0], { status: "verified", title: "Sum" });
    await migrator`DELETE FROM practice.coding_problems WHERE id = ${problemId}`;
  }],
  ["public catalog visibility and global write protection", async () => {
    const collectionId = "00000000-0000-0000-0000-000000000901";
    const sectionId = "00000000-0000-0000-0000-000000000902";
    const itemId = "00000000-0000-0000-0000-000000000903";
    const videoResourceId = "00000000-0000-0000-0000-000000000904";
    const paperResourceId = "00000000-0000-0000-0000-000000000905";
    await migrator`DELETE FROM catalog.collection_items WHERE id = ${itemId}`;
    await migrator`DELETE FROM catalog.collection_sections WHERE id = ${sectionId}`;
    await migrator`DELETE FROM catalog.collections WHERE id = ${collectionId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${videoResourceId}`;
    await migrator`DELETE FROM catalog.paper_details WHERE resource_id = ${paperResourceId}`;
    await migrator`DELETE FROM catalog.resources WHERE id IN (${videoResourceId}, ${paperResourceId})`;
    await worker`
      INSERT INTO catalog.resources (id, type, provider, external_id, title, visibility, status, metadata)
      VALUES
        (${videoResourceId}, 'video', 'db-test', 'public-video', 'Public video metadata', 'public', 'ready', '{}'::jsonb),
        (${paperResourceId}, 'paper', 'db-test', 'public-paper', 'Public paper metadata', 'public', 'ready', '{}'::jsonb)
    `;
    await worker`
      INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title)
      VALUES (${videoResourceId}, 'db-test-video', 'Public channel')
    `;
    await worker`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract)
      VALUES (${paperResourceId}, 'db-test-paper', 'Public paper abstract')
    `;
    await worker`
      INSERT INTO catalog.collections (id, owner_user_id, kind, visibility, title, description)
      VALUES (${collectionId}, NULL, 'curated', 'public', 'Public collection', 'Public collection description')
    `;
    await worker`
      INSERT INTO catalog.collection_sections (id, collection_id, title, position)
      VALUES (${sectionId}, ${collectionId}, 'Section one', 0)
    `;
    await worker`
      INSERT INTO catalog.collection_items (id, section_id, resource_id, position)
      VALUES (${itemId}, ${sectionId}, ${ids.publicResource}, 0)
    `;
    const visible = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      return tx<{ collections: string; items: string; video: string; paper: string }[]>`
        SELECT
          (SELECT count(*)::text FROM catalog.collections WHERE id = ${collectionId}) AS collections,
          (SELECT count(*)::text FROM catalog.collection_items WHERE id = ${itemId}) AS items,
          (SELECT count(*)::text FROM catalog.video_details WHERE resource_id = ${videoResourceId}) AS video,
          (SELECT count(*)::text FROM catalog.paper_details WHERE resource_id = ${paperResourceId}) AS paper
      `;
    });
    assert.deepEqual(visible[0], { collections: "1", items: "1", video: "1", paper: "1" });
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      await tx`UPDATE catalog.resources SET owner_user_id = ${ids.userA} WHERE id = ${ids.publicResource}`;
      await tx`UPDATE catalog.collections SET owner_user_id = ${ids.userA} WHERE id = ${collectionId}`;
      await tx`DELETE FROM catalog.resources WHERE id = ${ids.publicResource}`;
      await tx`DELETE FROM catalog.collections WHERE id = ${collectionId}`;
    });
    const unchanged = await migrator<{ owner_user_id: string | null; title: string }[]>`
      SELECT owner_user_id, title FROM catalog.resources WHERE id = ${ids.publicResource}
    `;
    assert.equal(unchanged[0]?.owner_user_id, null);
    assert.equal(unchanged[0]?.title, "Distributed Systems Primer");
    const globalCollection = await migrator<{ owner_user_id: string | null; title: string }[]>`
      SELECT owner_user_id, title FROM catalog.collections WHERE id = ${collectionId}
    `;
    assert.equal(globalCollection[0]?.owner_user_id, null);
    assert.equal(globalCollection[0]?.title, "Public collection");
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO catalog.collections (id, owner_user_id, kind, visibility, title)
          VALUES ('00000000-0000-0000-0000-000000000907', NULL, 'curated', 'public', 'Forged global collection')
        `;
      }),
      "user creating a global collection",
    );
    await expectRejected(
      () => app`UPDATE catalog.video_details SET channel_title = 'forged' WHERE resource_id = ${videoResourceId}`,
      "user updating global video metadata",
    );
    await expectRejected(
      () => app`UPDATE catalog.paper_details SET abstract = 'forged' WHERE resource_id = ${paperResourceId}`,
      "user updating global paper metadata",
    );
    await migrator`DELETE FROM catalog.collection_items WHERE id = ${itemId}`;
    await migrator`DELETE FROM catalog.collection_sections WHERE id = ${sectionId}`;
    await migrator`DELETE FROM catalog.collections WHERE id = ${collectionId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${videoResourceId}`;
    await migrator`DELETE FROM catalog.paper_details WHERE resource_id = ${paperResourceId}`;
    await migrator`DELETE FROM catalog.resources WHERE id IN (${videoResourceId}, ${paperResourceId})`;
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
    await migrator`DELETE FROM retrieval.citations WHERE retrieval_run_id = ${retrievalRun}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id = ${retrievalRun}`;
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
    await migrator`DELETE FROM retrieval.citations WHERE retrieval_run_id = ${retrievalRun}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id = ${retrievalRun}`;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${retrievalRun}`;
  }],
  ["historical evidence retention and append-only mastery", async () => {
    const evidenceEvent = "00000000-0000-0000-0000-000000000908";
    const evidenceRun = "00000000-0000-0000-0000-000000000909";
    const evidenceCitation = "00000000-0000-0000-0000-000000000910";
    const masterySignal = "00000000-0000-0000-0000-000000000911";
    await migrator`DELETE FROM knowledge.mastery_signals WHERE id = ${masterySignal}`;
    await migrator`DELETE FROM retrieval.citations WHERE id = ${evidenceCitation}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id = ${evidenceRun}`;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${evidenceRun}`;
    await migrator`DELETE FROM activity.activity_events WHERE id = ${evidenceEvent}`;
    await worker`
      INSERT INTO activity.activity_events (id, schema_version, user_id, study_session_id, resource_id, resource_version_id, event_type, actor_type, source, occurred_at, payload)
      VALUES (${evidenceEvent}, 1, ${ids.userA}, ${ids.sessionA}, ${ids.publicResource}, ${ids.publicVersion}, 'concept.encountered', 'system', 'worker', '2026-01-02T00:00:00.000Z', '{}'::jsonb)
    `;
    await worker`
      INSERT INTO retrieval.retrieval_runs (id, user_id, study_session_id, query_text, query_sha256, embedding_profile_id, scope, strategy_version, status)
      VALUES (${evidenceRun}, ${ids.userA}, ${ids.sessionA}, 'evidence query', '1212121212121212121212121212121212121212121212121212121212121212', 'seed-1536', '{}'::jsonb, 'db-test', 'completed')
    `;
    await worker`
      INSERT INTO retrieval.retrieved_chunks (retrieval_run_id, chunk_id, candidate_rank, selected, reason_codes)
      VALUES (${evidenceRun}, ${ids.publicChunk}, 1, true, '[]'::jsonb)
    `;
    await worker`
      INSERT INTO retrieval.citations (id, retrieval_run_id, chunk_id, resource_version_id, ordinal, anchor_snapshot)
      VALUES (${evidenceCitation}, ${evidenceRun}, ${ids.publicChunk}, ${ids.publicVersion}, 1, '{}'::jsonb)
    `;
    await worker`
      INSERT INTO knowledge.mastery_signals (id, user_id, concept_id, study_session_id, source_event_id, signal_type, value, reliability, weight, observed_at, projector_version, metadata)
      VALUES (${masterySignal}, ${ids.userA}, ${ids.concept}, ${ids.sessionA}, ${evidenceEvent}, 'exposure', 0.2, 0.9, 1, '2026-01-02T00:00:00.000Z', 'db-test', '{}'::jsonb)
    `;
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`UPDATE knowledge.mastery_signals SET value = 0.9 WHERE id = ${masterySignal}`;
      }),
      "application updating append-only mastery",
    );
    await expectRejected(
      () => app`DELETE FROM knowledge.mastery_signals WHERE id = ${masterySignal}`,
      "application deleting append-only mastery",
    );
    await expectRejected(
      () => worker`UPDATE knowledge.mastery_signals SET value = 0.9 WHERE id = ${masterySignal}`,
      "worker updating append-only mastery",
    );
    await expectRejected(
      () => worker`DELETE FROM knowledge.mastery_signals WHERE id = ${masterySignal}`,
      "worker deleting append-only mastery",
    );
    await expectRejected(
      () => worker`
        INSERT INTO knowledge.mastery_signals (id, user_id, concept_id, study_session_id, source_event_id, signal_type, value, reliability, weight, observed_at, projector_version, metadata)
        VALUES ('00000000-0000-0000-0000-000000000912', ${ids.userB}, ${ids.concept}, ${ids.sessionB}, ${evidenceEvent}, 'exposure', 0.2, 0.9, 1, '2026-01-02T00:00:00.000Z', 'db-test', '{}'::jsonb)
      `,
      "mastery signal with another user's source event",
    );
    await expectRejected(
      () => worker`
        INSERT INTO knowledge.mastery_signals (id, user_id, concept_id, study_session_id, source_event_id, signal_type, value, reliability, weight, observed_at, projector_version, metadata)
        VALUES ('00000000-0000-0000-0000-000000000913', ${ids.userA}, ${ids.concept}, ${ids.sessionB}, ${evidenceEvent}, 'exposure', 0.2, 0.9, 1, '2026-01-02T00:00:00.000Z', 'db-test', '{}'::jsonb)
      `,
      "mastery signal with another session",
    );
    await expectRejected(
      () => app`DELETE FROM activity.activity_events WHERE id = ${evidenceEvent}`,
      "application deleting activity history",
    );
    await expectRejected(
      () => app`DELETE FROM retrieval.retrieval_runs WHERE id = ${evidenceRun}`,
      "application deleting retrieval history",
    );
    await expectRejected(
      () => migrator`DELETE FROM activity.activity_events WHERE id = ${evidenceEvent}`,
      "deleting activity evidence referenced by mastery",
    );
    await expectRejected(
      () => migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${evidenceRun}`,
      "deleting retrieval evidence referenced by citation",
    );
    const evidenceCounts = await migrator<{ events: string; runs: string; citations: string; signals: string }[]>`
      SELECT
        (SELECT count(*)::text FROM activity.activity_events WHERE id = ${evidenceEvent}) AS events,
        (SELECT count(*)::text FROM retrieval.retrieval_runs WHERE id = ${evidenceRun}) AS runs,
        (SELECT count(*)::text FROM retrieval.citations WHERE id = ${evidenceCitation}) AS citations,
        (SELECT count(*)::text FROM knowledge.mastery_signals WHERE id = ${masterySignal}) AS signals
    `;
    assert.deepEqual(evidenceCounts[0], { events: "1", runs: "1", citations: "1", signals: "1" });
    await migrator`DELETE FROM knowledge.mastery_signals WHERE id = ${masterySignal}`;
    await migrator`DELETE FROM retrieval.citations WHERE id = ${evidenceCitation}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id = ${evidenceRun}`;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${evidenceRun}`;
    await migrator`DELETE FROM activity.activity_events WHERE id = ${evidenceEvent}`;
  }],
  ["coding attempt and tutor ownership", async () => {
    await expectRejected(
      () => migrator`
        INSERT INTO study.tutor_threads (id, user_id, study_session_id, resource_id, mode, status, metadata)
        VALUES ('00000000-0000-0000-0000-000000000845', ${ids.userB}, ${ids.sessionA}, ${ids.publicResource}, 'guided', 'active', '{}'::jsonb)
      `,
      "tutor thread user mismatch",
    );
    const problemId = "00000000-0000-0000-0000-000000000846";
    await migrator`DELETE FROM practice.coding_problems WHERE id = ${problemId}`;
    await migrator`INSERT INTO practice.coding_problems (id, concept, difficulty, status, contract_version) VALUES (${problemId}, 'arrays', 'easy', 'generating', 'db-test')`;
    await expectRejected(
      () => migrator`
        INSERT INTO practice.coding_attempts (user_id, study_session_id, resource_id, problem_id, role, state, language)
        VALUES (${ids.userB}, ${ids.sessionA}, ${ids.publicResource}, ${problemId}, 'primary', 'PROBLEM_INTRO', 'python')
      `,
      "coding attempt in another user's session",
    );
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userB}, true)`;
        await tx`INSERT INTO practice.coding_attempts (user_id, study_session_id, resource_id, problem_id, role, state, language) VALUES (${ids.userA}, ${ids.sessionA}, ${ids.publicResource}, ${problemId}, 'primary', 'PROBLEM_INTRO', 'python')`;
      }),
      "coding attempt written for another learner",
    );
    await migrator`DELETE FROM practice.coding_problems WHERE id = ${problemId}`;
  }],
  ["composite provenance across progress and artifacts", async () => {
    const progressId = "00000000-0000-0000-0000-000000000914";
    const focusId = "00000000-0000-0000-0000-000000000915";
    const artifactResourceId = "00000000-0000-0000-0000-000000000916";
    const artifactId = "00000000-0000-0000-0000-000000000917";
    const badArtifactSourceId = "00000000-0000-0000-0000-000000000918";
    const badArtifactChunkId = "00000000-0000-0000-0000-000000000919";
    const scheduleId = "00000000-0000-0000-0000-000000000920";
    await migrator`DELETE FROM knowledge.artifact_sources WHERE artifact_resource_id = ${artifactResourceId}`;
    await migrator`DELETE FROM knowledge.artifact_details WHERE resource_id = ${artifactResourceId}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${artifactResourceId}`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${ids.userA} AND resource_id = ${ids.publicResource}`;
    await migrator`DELETE FROM study.focus_sessions WHERE id = ${focusId}`;
    await migrator`DELETE FROM study.schedule_items WHERE id = ${scheduleId}`;
    await expectRejected(
      () => migrator`
        INSERT INTO study.user_resource_progress (user_id, resource_id, last_session_id, status)
        VALUES (${ids.userA}, ${ids.publicResource}, ${ids.sessionB}, 'in_progress')
      `,
      "progress referencing another user's session",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.focus_sessions (id, user_id, study_session_id, mode)
        VALUES (${focusId}, ${ids.userA}, ${ids.sessionB}, 'deep_work')
      `,
      "focus session referencing another user's session",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.schedule_items (id, user_id, learning_goal_id, kind, title, starts_at)
        VALUES (${scheduleId}, ${ids.userA}, ${ids.goalB}, 'watch', 'Invalid goal owner', '2026-01-03T00:00:00.000Z')
      `,
      "schedule item referencing another user's goal",
    );
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, title, visibility, status, metadata)
      VALUES (${artifactResourceId}, ${ids.userA}, 'note', 'db-test', 'artifact-resource', 'Artifact resource', 'private', 'ready', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO knowledge.artifact_details (resource_id, user_id, study_session_id, artifact_type, status, created_by)
      VALUES (${artifactResourceId}, ${ids.userA}, ${ids.sessionA}, 'note', 'active', 'user')
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO knowledge.artifact_sources (id, artifact_resource_id, source_resource_id, source_version_id, relation_type)
        VALUES (${badArtifactSourceId}, ${artifactResourceId}, ${ids.privateResourceB}, ${ids.publicVersion}, 'supports')
      `,
      "artifact source resource and version mismatch",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO knowledge.artifact_sources (id, artifact_resource_id, source_resource_id, source_version_id, source_chunk_id, relation_type)
        VALUES (${badArtifactChunkId}, ${artifactResourceId}, ${ids.publicResource}, ${ids.publicVersion}, ${ids.privateChunkA}, 'supports')
      `,
      "artifact source version and chunk mismatch",
    );
    await migrator`
      INSERT INTO knowledge.artifact_sources (id, artifact_resource_id, source_resource_id, source_version_id, source_chunk_id, relation_type)
      VALUES ('00000000-0000-0000-0000-000000000921', ${artifactResourceId}, ${ids.publicResource}, ${ids.publicVersion}, ${ids.publicChunk}, 'supports')
    `;
    await migrator`DELETE FROM knowledge.artifact_sources WHERE artifact_resource_id = ${artifactResourceId}`;
    await migrator`DELETE FROM knowledge.artifact_details WHERE resource_id = ${artifactResourceId}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${artifactResourceId}`;
  }],
  ["progress chunk provenance hardening", async () => {
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${ids.userA} AND resource_id = ${ids.publicResource}`;
    await migrator`
      INSERT INTO study.user_resource_progress (user_id, resource_id, last_session_id, status, last_chunk_id)
      VALUES (${ids.userA}, ${ids.publicResource}, ${ids.sessionA}, 'in_progress', ${ids.publicChunk})
    `;
    await expectRejected(
      () => migrator`
        UPDATE study.user_resource_progress
        SET last_chunk_id = ${ids.privateChunkB}
        WHERE user_id = ${ids.userA} AND resource_id = ${ids.publicResource}
      `,
      "progress using another resource chunk",
    );
    const validProgress = await migrator<{ last_chunk_id: string }[]>`
      SELECT last_chunk_id FROM study.user_resource_progress
      WHERE user_id = ${ids.userA} AND resource_id = ${ids.publicResource}
    `;
    assert.equal(validProgress[0]?.last_chunk_id, ids.publicChunk);
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${ids.userA} AND resource_id = ${ids.publicResource}`;
  }],
  ["final agent artifact and optional provenance hardening", async () => {
    await migrator`DELETE FROM retrieval.citations WHERE id = ${ids.hardeningCitation}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id = ${ids.hardeningCitationRun}`;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${ids.hardeningCitationRun}`;
    await migrator`DELETE FROM knowledge.artifact_details WHERE resource_id = ${ids.hardeningArtifactResource}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${ids.hardeningArtifactResource}`;
    await migrator`DELETE FROM agent.agent_artifacts WHERE agent_run_id IN (${ids.hardeningAgentRunA}, ${ids.hardeningAgentRunB})`;
    await migrator`DELETE FROM study.tutor_messages WHERE id IN (${ids.hardeningMessageA}, ${ids.hardeningMessageB}, ${ids.hardeningCrossSourceMessage})`;
    await migrator`DELETE FROM agent.model_invocations WHERE id IN (${ids.hardeningModelInvocationA}, ${ids.hardeningModelInvocationB})`;
    await migrator`DELETE FROM agent.agent_runs WHERE id IN (${ids.hardeningAgentRunA}, ${ids.hardeningAgentRunB})`;
    await migrator`DELETE FROM study.tutor_threads WHERE id IN (${ids.hardeningThreadA}, ${ids.hardeningThreadB})`;

    await migrator`
      INSERT INTO study.tutor_threads (id, user_id, study_session_id, resource_id, mode, status, metadata)
      VALUES
        (${ids.hardeningThreadA}, ${ids.userA}, ${ids.sessionA}, ${ids.publicResource}, 'text', 'active', '{}'::jsonb),
        (${ids.hardeningThreadB}, ${ids.userB}, ${ids.sessionB}, ${ids.publicResource}, 'text', 'active', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO agent.agent_runs (id, user_id, study_session_id, tutor_thread_id, purpose, status, goal, policy_version, max_iterations, max_tool_calls, max_tokens)
      VALUES
        (${ids.hardeningAgentRunA}, ${ids.userA}, ${ids.sessionA}, ${ids.hardeningThreadA}, 'retrieval', 'executing', 'Hardening A', 'db-test', 5, 5, 1000),
        (${ids.hardeningAgentRunB}, ${ids.userB}, ${ids.sessionB}, ${ids.hardeningThreadB}, 'retrieval', 'executing', 'Hardening B', 'db-test', 5, 5, 1000)
    `;
    await migrator`
      INSERT INTO agent.model_invocations (id, agent_run_id, provider, model_name, purpose)
      VALUES
        (${ids.hardeningModelInvocationA}, ${ids.hardeningAgentRunA}, 'db-test', 'model-a', 'diagnostic'),
        (${ids.hardeningModelInvocationB}, ${ids.hardeningAgentRunB}, 'db-test', 'model-b', 'diagnostic')
    `;
    await migrator`
      INSERT INTO study.tutor_messages (id, thread_id, actor_type, agent_run_id, content_text, content)
      VALUES
        (${ids.hardeningMessageA}, ${ids.hardeningThreadA}, 'assistant', ${ids.hardeningAgentRunA}, 'message A', '{}'::jsonb),
        (${ids.hardeningMessageB}, ${ids.hardeningThreadB}, 'assistant', ${ids.hardeningAgentRunB}, 'message B', '{}'::jsonb)
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO study.tutor_messages (id, thread_id, actor_type, agent_run_id, content_text, content)
        VALUES (${ids.hardeningCrossSourceMessage}, ${ids.hardeningThreadA}, 'assistant', ${ids.hardeningAgentRunB}, 'wrong run thread', '{}'::jsonb)
      `,
      "tutor message using another thread's agent run",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO study.tutor_messages (id, thread_id, actor_type, source_message_id, content_text, content)
        VALUES (${ids.hardeningCrossSourceMessage}, ${ids.hardeningThreadA}, 'assistant', ${ids.hardeningMessageB}, 'wrong source thread', '{}'::jsonb)
      `,
      "tutor message using another thread's source message",
    );

    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, title, visibility, status, metadata)
      VALUES (${ids.hardeningArtifactResource}, ${ids.userA}, 'note', 'db-test', 'hardening-artifact', 'Hardening artifact', 'private', 'ready', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO knowledge.artifact_details (resource_id, user_id, study_session_id, artifact_type, status, created_by, source_agent_run_id)
      VALUES (${ids.hardeningArtifactResource}, ${ids.userA}, ${ids.sessionA}, 'note', 'active', 'agent', ${ids.hardeningAgentRunA})
    `;
    await expectRejected(
      () => migrator`
        UPDATE knowledge.artifact_details
        SET source_agent_run_id = ${ids.hardeningAgentRunB}
        WHERE resource_id = ${ids.hardeningArtifactResource}
      `,
      "artifact using another user's source agent run",
    );

    await migrator`
      INSERT INTO agent.agent_artifacts (agent_run_id, resource_id, role)
      VALUES (${ids.hardeningAgentRunA}, ${ids.privateResourceA}, 'private-source')
    `;
    await ai.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      await tx`
        INSERT INTO agent.agent_artifacts (agent_run_id, resource_id, role)
        VALUES (${ids.hardeningAgentRunA}, ${ids.publicResource}, 'public-source')
      `;
    });
    await expectRejected(
      () => ai.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO agent.agent_artifacts (agent_run_id, resource_id, role)
          VALUES (${ids.hardeningAgentRunA}, ${ids.privateResourceB}, 'foreign-private')
        `;
      }),
      "agent artifact using another user's private resource",
    );
    await expectRejected(
      () => ai.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          UPDATE agent.agent_artifacts
          SET resource_id = ${ids.privateResourceB}
          WHERE agent_run_id = ${ids.hardeningAgentRunA} AND resource_id = ${ids.privateResourceA} AND role = 'private-source'
        `;
      }),
      "agent artifact update to another user's private resource",
    );

    await migrator`
      INSERT INTO retrieval.retrieval_runs (id, user_id, study_session_id, query_text, query_sha256, embedding_profile_id, scope, strategy_version, status)
      VALUES (${ids.hardeningCitationRun}, ${ids.userA}, ${ids.sessionA}, 'hardening citation', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'seed-1536', '{}'::jsonb, 'db-test', 'completed')
    `;
    await migrator`
      INSERT INTO retrieval.retrieved_chunks (retrieval_run_id, chunk_id, candidate_rank, selected)
      VALUES (${ids.hardeningCitationRun}, ${ids.publicChunk}, 1, true)
    `;
    await migrator`
      INSERT INTO retrieval.citations (id, retrieval_run_id, chunk_id, resource_version_id, message_id, ordinal, anchor_snapshot)
      VALUES (${ids.hardeningCitation}, ${ids.hardeningCitationRun}, ${ids.publicChunk}, ${ids.publicVersion}, ${ids.hardeningMessageA}, 1, '{}'::jsonb)
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO retrieval.citations (id, retrieval_run_id, chunk_id, resource_version_id, message_id, ordinal, anchor_snapshot)
        VALUES ('00000000-0000-0000-0000-000000000988', ${ids.hardeningCitationRun}, ${ids.publicChunk}, ${ids.publicVersion}, ${ids.hardeningMessageB}, 2, '{}'::jsonb)
      `,
      "citation using another user's tutor message",
    );

    await migrator`DELETE FROM retrieval.citations WHERE id = ${ids.hardeningCitation}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id = ${ids.hardeningCitationRun}`;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE id = ${ids.hardeningCitationRun}`;
    await migrator`DELETE FROM knowledge.artifact_details WHERE resource_id = ${ids.hardeningArtifactResource}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${ids.hardeningArtifactResource}`;
    await migrator`DELETE FROM agent.agent_artifacts WHERE agent_run_id IN (${ids.hardeningAgentRunA}, ${ids.hardeningAgentRunB})`;
    await migrator`DELETE FROM study.tutor_messages WHERE id IN (${ids.hardeningMessageA}, ${ids.hardeningMessageB})`;
    await migrator`DELETE FROM agent.model_invocations WHERE id IN (${ids.hardeningModelInvocationA}, ${ids.hardeningModelInvocationB})`;
    await migrator`DELETE FROM agent.agent_runs WHERE id IN (${ids.hardeningAgentRunA}, ${ids.hardeningAgentRunB})`;
    await migrator`DELETE FROM study.tutor_threads WHERE id IN (${ids.hardeningThreadA}, ${ids.hardeningThreadB})`;
  }],
  ["agent and discovery provenance isolation", async () => {
    const threadA = "00000000-0000-0000-0000-000000000922";
    const threadB = "00000000-0000-0000-0000-000000000923";
    const agentRunA = "00000000-0000-0000-0000-000000000924";
    const agentRunB = "00000000-0000-0000-0000-000000000925";
    const agentStepA = "00000000-0000-0000-0000-000000000926";
    const agentStepB = "00000000-0000-0000-0000-000000000927";
    const toolInvocation = "00000000-0000-0000-0000-000000000928";
    const modelInvocation = "00000000-0000-0000-0000-000000000929";
    const recommendationRunA = "00000000-0000-0000-0000-000000000930";
    const recommendationRunB = "00000000-0000-0000-0000-000000000931";
    const candidateA = "00000000-0000-0000-0000-000000000932";
    const candidateB = "00000000-0000-0000-0000-000000000933";
    const impressionA = "00000000-0000-0000-0000-000000000934";
    const impressionB = "00000000-0000-0000-0000-000000000935";
    const interactionA = "00000000-0000-0000-0000-000000000936";
    await migrator`DELETE FROM agent.tool_invocations WHERE id = ${toolInvocation}`;
    await migrator`DELETE FROM agent.model_invocations WHERE id = ${modelInvocation}`;
    await migrator`DELETE FROM agent.agent_steps WHERE id IN (${agentStepA}, ${agentStepB})`;
    await migrator`DELETE FROM agent.agent_runs WHERE id IN (${agentRunA}, ${agentRunB})`;
    await migrator`DELETE FROM study.tutor_threads WHERE id IN (${threadA}, ${threadB})`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE id = ${interactionA}`;
    await migrator`DELETE FROM discovery.recommendation_impressions WHERE id IN (${impressionA}, ${impressionB})`;
    await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (${recommendationRunA}, ${recommendationRunB})`;
    await migrator`DELETE FROM discovery.recommendation_runs WHERE id IN (${recommendationRunA}, ${recommendationRunB})`;
    await migrator`
      INSERT INTO study.tutor_threads (id, user_id, study_session_id, resource_id, mode, status, metadata)
      VALUES
        (${threadA}, ${ids.userA}, ${ids.sessionA}, ${ids.publicResource}, 'text', 'active', '{}'::jsonb),
        (${threadB}, ${ids.userB}, ${ids.sessionB}, ${ids.publicResource}, 'text', 'active', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO agent.agent_runs (id, user_id, study_session_id, tutor_thread_id, purpose, status, goal, policy_version, max_iterations, max_tool_calls, max_tokens)
      VALUES
        (${agentRunA}, ${ids.userA}, ${ids.sessionA}, ${threadA}, 'retrieval', 'executing', 'Agent A', 'db-test', 5, 5, 1000),
        (${agentRunB}, ${ids.userB}, ${ids.sessionB}, ${threadB}, 'retrieval', 'executing', 'Agent B', 'db-test', 5, 5, 1000)
    `;
    await migrator`
      INSERT INTO agent.agent_steps (id, agent_run_id, step_key, sequence_no, kind, status, input)
      VALUES
        (${agentStepA}, ${agentRunA}, 'retrieve-a', 1, 'retrieve', 'done', '{}'::jsonb),
        (${agentStepB}, ${agentRunB}, 'retrieve-b', 1, 'retrieve', 'done', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO agent.tool_invocations (id, agent_run_id, agent_step_id, tool_name, status, input)
      VALUES (${toolInvocation}, ${agentRunA}, ${agentStepA}, 'search', 'succeeded', '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO agent.model_invocations (id, agent_run_id, agent_step_id, provider, model_name, purpose)
      VALUES (${modelInvocation}, ${agentRunA}, ${agentStepA}, 'db-test', 'model-a', 'retrieval')
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO agent.agent_runs (id, user_id, study_session_id, tutor_thread_id, purpose, status, goal, policy_version, max_iterations, max_tool_calls, max_tokens)
        VALUES ('00000000-0000-0000-0000-000000000937', ${ids.userA}, ${ids.sessionB}, ${threadA}, 'retrieval', 'executing', 'Invalid session', 'db-test', 5, 5, 1000)
      `,
      "agent run with another user's session",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO agent.agent_runs (id, user_id, study_session_id, tutor_thread_id, purpose, status, goal, policy_version, max_iterations, max_tool_calls, max_tokens)
        VALUES ('00000000-0000-0000-0000-000000000938', ${ids.userA}, ${ids.sessionA}, ${threadB}, 'retrieval', 'executing', 'Invalid thread', 'db-test', 5, 5, 1000)
      `,
      "agent run with another user's thread",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO agent.tool_invocations (id, agent_run_id, agent_step_id, tool_name, status, input)
        VALUES ('00000000-0000-0000-0000-000000000939', ${agentRunA}, ${agentStepB}, 'search', 'succeeded', '{}'::jsonb)
      `,
      "tool invocation from another agent run",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO agent.model_invocations (id, agent_run_id, agent_step_id, provider, model_name, purpose)
        VALUES ('00000000-0000-0000-0000-000000000940', ${agentRunA}, ${agentStepB}, 'db-test', 'model-b', 'retrieval')
      `,
      "model invocation from another agent run",
    );
    assert.deepEqual(await visibleIds(ai, ids.userA, 'agent.agent_runs', 'id'), [agentRunA]);
    await migrator`
      INSERT INTO discovery.recommendation_runs (id, user_id, study_session_id, surface, strategy_version, feature_version, context_snapshot, status)
      VALUES
        (${recommendationRunA}, ${ids.userA}, ${ids.sessionA}, 'discover', 'db-test', 'db-test', '{}'::jsonb, 'completed'),
        (${recommendationRunB}, ${ids.userB}, ${ids.sessionB}, 'discover', 'db-test', 'db-test', '{}'::jsonb, 'completed')
    `;
    await migrator`
      INSERT INTO discovery.recommendation_candidates (recommendation_run_id, resource_id, candidate_rank, score, reason_codes)
      VALUES
        (${recommendationRunA}, ${ids.publicResource}, 1, 0.9, '[]'::jsonb),
        (${recommendationRunB}, ${ids.privateResourceB}, 1, 0.8, '[]'::jsonb)
    `;
    await migrator`
      INSERT INTO discovery.recommendation_impressions (id, recommendation_run_id, user_id, resource_id, position, surface)
      VALUES
        (${impressionA}, ${recommendationRunA}, ${ids.userA}, ${ids.publicResource}, 1, 'discover'),
        (${impressionB}, ${recommendationRunB}, ${ids.userB}, ${ids.privateResourceB}, 1, 'discover')
    `;
    await migrator`
      INSERT INTO discovery.discovery_interactions (id, impression_id, user_id, resource_id, action)
      VALUES (${interactionA}, ${impressionA}, ${ids.userA}, ${ids.publicResource}, 'open')
    `;
    await expectRejected(
      () => migrator`
        INSERT INTO discovery.recommendation_impressions (id, recommendation_run_id, user_id, resource_id, position, surface)
        VALUES ('00000000-0000-0000-0000-000000000941', ${recommendationRunA}, ${ids.userB}, ${ids.publicResource}, 2, 'discover')
      `,
      "recommendation impression with another user's run",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO discovery.recommendation_impressions (id, recommendation_run_id, user_id, resource_id, position, surface)
        VALUES ('00000000-0000-0000-0000-000000000942', ${recommendationRunA}, ${ids.userA}, ${ids.privateResourceB}, 2, 'discover')
      `,
      "recommendation impression with a resource outside its run",
    );
    await expectRejected(
      () => migrator`
        INSERT INTO discovery.discovery_interactions (id, impression_id, user_id, resource_id, action)
        VALUES ('00000000-0000-0000-0000-000000000943', ${impressionA}, ${ids.userB}, ${ids.publicResource}, 'open')
      `,
      "discovery interaction with another user's impression",
    );
    assert.deepEqual(await visibleIds(app, ids.userA, 'discovery.recommendation_runs', 'id'), [recommendationRunA]);
    await migrator`DELETE FROM discovery.discovery_interactions WHERE id = ${interactionA}`;
    await migrator`DELETE FROM discovery.recommendation_impressions WHERE id IN (${impressionA}, ${impressionB})`;
    await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (${recommendationRunA}, ${recommendationRunB})`;
    await migrator`DELETE FROM discovery.recommendation_runs WHERE id IN (${recommendationRunA}, ${recommendationRunB})`;
    await migrator`DELETE FROM agent.tool_invocations WHERE id = ${toolInvocation}`;
    await migrator`DELETE FROM agent.model_invocations WHERE id = ${modelInvocation}`;
    await migrator`DELETE FROM agent.agent_steps WHERE id IN (${agentStepA}, ${agentStepB})`;
    await migrator`DELETE FROM agent.agent_runs WHERE id IN (${agentRunA}, ${agentRunB})`;
    await migrator`DELETE FROM study.tutor_threads WHERE id IN (${threadA}, ${threadB})`;
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
  ["outbox delivery authority", async () => {
    const outboxId = "00000000-0000-0000-0000-000000000944";
    await migrator`DELETE FROM ops.outbox_events WHERE id = ${outboxId}`;
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
      await tx`
        INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, study_session_id, payload)
        VALUES (${outboxId}, 'study_session', ${ids.sessionA}, 'db-test.outbox', 1, ${ids.userA}, ${ids.sessionA}, '{}'::jsonb)
      `;
    });
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`UPDATE ops.outbox_events SET status = 'published' WHERE id = ${outboxId}`;
      }),
      "application changing outbox delivery state",
    );
    await expectRejected(
      () => app`DELETE FROM ops.outbox_events WHERE id = ${outboxId}`,
      "application deleting outbox events",
    );
    await expectRejected(
      () => app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${ids.userA}, true)`;
        await tx`
          INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, study_session_id, payload)
          VALUES ('00000000-0000-0000-0000-000000000945', 'study_session', ${ids.sessionB}, 'db-test.outbox', 1, ${ids.userB}, ${ids.sessionB}, '{}'::jsonb)
        `;
      }),
      "application appending another user's outbox event",
    );
    await worker`
      UPDATE ops.outbox_events
      SET status = 'published', attempts = 1, locked_by = 'db-test-worker', locked_at = now(), published_at = now()
      WHERE id = ${outboxId}
    `;
    await expectRejected(
      () => worker`UPDATE ops.outbox_events SET payload = '{"forged":true}'::jsonb WHERE id = ${outboxId}`,
      "worker changing immutable outbox payload",
    );
    await expectRejected(
      () => worker`DELETE FROM ops.outbox_events WHERE id = ${outboxId}`,
      "worker deleting outbox events",
    );
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
    auth.end({ timeout: 5 }),
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

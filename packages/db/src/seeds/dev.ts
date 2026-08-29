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

export const seedIds = {
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
  exercise: "00000000-0000-0000-0000-000000000601",
  exerciseVersion: "00000000-0000-0000-0000-000000000602",
  binding: "00000000-0000-0000-0000-000000000603",
  attemptA: "00000000-0000-0000-0000-000000000604",
  snapshotA: "00000000-0000-0000-0000-000000000605",
  testBundle: "00000000-0000-0000-0000-000000000606",
  executionRun: "00000000-0000-0000-0000-000000000607",
  embeddingProfile: "seed-1536",
};

const seededAt = "2026-01-01T00:00:00.000Z";
const hashes = {
  publicSource: "1111111111111111111111111111111111111111111111111111111111111111",
  publicContent: "2222222222222222222222222222222222222222222222222222222222222222",
  privateSourceA: "3333333333333333333333333333333333333333333333333333333333333333",
  privateSourceB: "4444444444444444444444444444444444444444444444444444444444444444",
  chunk: "5555555555555555555555555555555555555555555555555555555555555555",
  exercise: "6666666666666666666666666666666666666666666666666666666666666666",
  source: "7777777777777777777777777777777777777777777777777777777777777777",
  bundle: "8888888888888888888888888888888888888888888888888888888888888888",
};

const vectorLiteral = `[${Array.from({ length: 1536 }, (_, index) => index === 0 ? "1" : "0").join(",")}]`;

export async function seedDev(): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO identity.users (id, email, email_verified, status, display_name, locale, timezone, subscription_tier, created_at, updated_at)
      VALUES (${seedIds.userA}, ${"seed-a@learnspace.local"}, true, 'active', ${"Seed Learner A"}, 'en', 'UTC', 'pro', ${seededAt}, ${seededAt}),
             (${seedIds.userB}, ${"seed-b@learnspace.local"}, true, 'active', ${"Seed Learner B"}, 'en', 'UTC', 'free', ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, email_verified = EXCLUDED.email_verified, status = EXCLUDED.status, display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO knowledge.concepts (id, slug, name, kind, summary, status, metadata, created_at, updated_at)
      VALUES (${seedIds.concept}, 'distributed-systems', 'Distributed Systems', 'topic', ${"Systems that coordinate across independent computers."}, 'active', '{}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, summary = EXCLUDED.summary, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata, created_at, updated_at)
      VALUES
        (${seedIds.publicResource}, NULL, 'webpage', 'seed', 'public-learning-resource', 'https://learnspace.local/resources/public', ${"Distributed Systems Primer"}, ${"A public resource used by the development database."}, 'en', 'public', 'ready', 0.95, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}),
        (${seedIds.privateResourceA}, ${seedIds.userA}, 'note', 'seed', 'private-a', NULL, ${"Learner A private note"}, ${"Private development resource for RLS checks."}, 'en', 'private', 'ready', 0.8, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}),
        (${seedIds.privateResourceB}, ${seedIds.userB}, 'code', 'seed', 'private-b', NULL, ${"Learner B private code"}, ${"Private development resource for RLS checks."}, 'typescript', 'private', 'ready', 0.8, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, visibility = EXCLUDED.visibility, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, normalized_object_key, mime_type, byte_size, parser_name, parser_version, extraction_version, processing_status, fetched_at, ready_at, created_at)
      VALUES
        (${seedIds.publicVersion}, ${seedIds.publicResource}, 1, ${hashes.publicSource}, ${hashes.publicContent}, 'seed/public/raw.html', 'seed/public/normalized.txt', 'text/html', 1024, 'seed-parser', '1.0.0', 1, 'ready', ${seededAt}, ${seededAt}, ${seededAt}),
        (${seedIds.privateVersionA}, ${seedIds.privateResourceA}, 1, ${hashes.privateSourceA}, NULL, 'seed/private-a/raw.txt', NULL, 'text/plain', 256, 'seed-parser', '1.0.0', 1, 'ready', ${seededAt}, ${seededAt}, ${seededAt}),
        (${seedIds.privateVersionB}, ${seedIds.privateResourceB}, 1, ${hashes.privateSourceB}, NULL, 'seed/private-b/raw.ts', NULL, 'text/typescript', 512, 'seed-parser', '1.0.0', 1, 'ready', ${seededAt}, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET processing_status = EXCLUDED.processing_status, ready_at = EXCLUDED.ready_at
    `;

    await tx`
      UPDATE catalog.resources
      SET current_version_id = CASE id
        WHEN ${seedIds.publicResource}::uuid THEN ${seedIds.publicVersion}::uuid
        WHEN ${seedIds.privateResourceA}::uuid THEN ${seedIds.privateVersionA}::uuid
        WHEN ${seedIds.privateResourceB}::uuid THEN ${seedIds.privateVersionB}::uuid
      END,
      updated_at = ${seededAt}
      WHERE id IN (${seedIds.publicResource}, ${seedIds.privateResourceA}, ${seedIds.privateResourceB})
    `;

    await tx`
      INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary, extractor_version, created_at)
      VALUES (${seedIds.publicResource}, ${seedIds.concept}, 'seed', 0.99, true, '1.0.0', ${seededAt})
      ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET relevance = EXCLUDED.relevance, is_primary = EXCLUDED.is_primary
    `;

    await tx`
      INSERT INTO retrieval.embedding_profiles (id, provider, model_name, dimensions, distance_metric, normalization, status, created_at, activated_at)
      VALUES (${seedIds.embeddingProfile}, 'seed', 'seed-1536', 1536, 'cosine', 'unit', 'active', ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, activated_at = EXCLUDED.activated_at
    `;

    await tx`
      INSERT INTO retrieval.resource_chunks (id, resource_version_id, ordinal, chunk_type, heading_path, content, content_sha256, token_count, language, page_from, page_to, anchor, metadata, created_at)
      VALUES (${seedIds.publicChunk}, ${seedIds.publicVersion}, 0, 'paragraph', ARRAY['Distributed Systems'], ${"A distributed system coordinates independent nodes through messages and durable state."}, ${hashes.chunk}, 14, 'en', 1, 1, '{"page":1}'::jsonb, '{"seed":true}'::jsonb, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata
    `;

    await tx`
      INSERT INTO retrieval.chunk_concepts (chunk_id, concept_id, relation_type, confidence, source, extractor_version, created_at)
      VALUES (${seedIds.publicChunk}, ${seedIds.concept}, 'about', 0.98, 'seed', '1.0.0', ${seededAt})
      ON CONFLICT (chunk_id, concept_id, relation_type, source) DO UPDATE SET confidence = EXCLUDED.confidence
    `;

    await tx`
      INSERT INTO retrieval.chunk_embeddings (chunk_id, embedding_profile_id, embedding, created_at)
      VALUES (${seedIds.publicChunk}, ${seedIds.embeddingProfile}, ${vectorLiteral}::vector, ${seededAt})
      ON CONFLICT (chunk_id, embedding_profile_id) DO UPDATE SET embedding = EXCLUDED.embedding
    `;

    await tx`
      INSERT INTO study.study_sessions (id, user_id, title, mode, status, active_resource_id, active_version_id, active_chunk_id, active_anchor, context_version, lock_version, started_at, last_active_at, metadata, created_at, updated_at)
      VALUES
        (${seedIds.sessionA}, ${seedIds.userA}, ${"Seed session A"}, 'guided_learning', 'active', ${seedIds.publicResource}, ${seedIds.publicVersion}, ${seedIds.publicChunk}, '{"offset":0}'::jsonb, 0, 0, ${seededAt}, ${seededAt}, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}),
        (${seedIds.sessionB}, ${seedIds.userB}, ${"Seed session B"}, 'research', 'active', ${seedIds.privateResourceB}, ${seedIds.privateVersionB}, NULL, NULL, 0, 0, ${seededAt}, ${seededAt}, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, active_resource_id = EXCLUDED.active_resource_id, active_version_id = EXCLUDED.active_version_id, active_chunk_id = EXCLUDED.active_chunk_id, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO study.session_resources (study_session_id, resource_id, resource_version_id, role, position, added_by, state, added_at)
      VALUES
        (${seedIds.sessionA}, ${seedIds.publicResource}, ${seedIds.publicVersion}, 'primary', 0, 'seed', '{"seed":true}'::jsonb, ${seededAt}),
        (${seedIds.sessionB}, ${seedIds.privateResourceB}, ${seedIds.privateVersionB}, 'primary', 0, 'seed', '{"seed":true}'::jsonb, ${seededAt})
      ON CONFLICT (study_session_id, resource_id) DO UPDATE SET resource_version_id = EXCLUDED.resource_version_id, role = EXCLUDED.role, position = EXCLUDED.position
    `;

    await tx`
      INSERT INTO practice.exercises (id, kind, canonical_concept_id, title, status, created_by, owner_user_id, metadata, created_at, updated_at)
      VALUES (${seedIds.exercise}, 'code', ${seedIds.concept}, ${"Implement a message queue"}, 'active', 'seed', NULL, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO practice.exercise_versions (id, exercise_id, version_no, language, runtime_family, difficulty, prompt_md, starter_code, function_signature, constraints, solution_outline, content_sha256, generator_model, generator_version, validation_status, created_at)
      VALUES (${seedIds.exerciseVersion}, ${seedIds.exercise}, 1, 'typescript', 'node', 'medium', ${"Implement a queue that preserves FIFO ordering."}, ${"export function enqueue(items: string[], value: string): string[] { return [...items, value]; }"}, 'enqueue(items, value)', '{"maxItems":100}'::jsonb, ${"Use an append-only representation and remove from the head."}, ${hashes.exercise}, 'seed-model', '1.0.0', 'validated', ${seededAt})
      ON CONFLICT (id) DO UPDATE SET prompt_md = EXCLUDED.prompt_md, solution_outline = EXCLUDED.solution_outline, validation_status = EXCLUDED.validation_status
    `;

    await tx`
      INSERT INTO practice.exercise_bindings (id, exercise_version_id, study_session_id, resource_id, resource_version_id, resource_chunk_id, concept_id, gate_position, required, trigger_reason, confidence, created_at)
      VALUES (${seedIds.binding}, ${seedIds.exerciseVersion}, ${seedIds.sessionA}, ${seedIds.publicResource}, ${seedIds.publicVersion}, ${seedIds.publicChunk}, ${seedIds.concept}, 0, true, 'seed', 0.97, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET study_session_id = EXCLUDED.study_session_id, resource_version_id = EXCLUDED.resource_version_id, confidence = EXCLUDED.confidence
    `;

    await tx`
      INSERT INTO practice.exercise_attempts (id, user_id, study_session_id, exercise_binding_id, exercise_version_id, status, language, hint_count, submission_count, idempotency_key, metadata, started_at, created_at, updated_at)
      VALUES (${seedIds.attemptA}, ${seedIds.userA}, ${seedIds.sessionA}, ${seedIds.binding}, ${seedIds.exerciseVersion}, 'started', 'typescript', 0, 0, 'seed-attempt-a', '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO practice.code_snapshots (id, attempt_id, sequence_no, kind, source_code, source_sha256, created_at)
      VALUES (${seedIds.snapshotA}, ${seedIds.attemptA}, 0, 'starter', ${"export function enqueue(items: string[], value: string): string[] { return [...items, value]; }"}, ${hashes.source}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET source_code = EXCLUDED.source_code
    `;

    await tx`
      INSERT INTO practice.test_bundles (id, exercise_version_id, kind, object_key, sha256, case_count, runtime_image_digest, harness_version, resource_limits, key_reference, created_at)
      VALUES (${seedIds.testBundle}, ${seedIds.exerciseVersion}, 'hidden', 'seed/test-bundles/queue.json', ${hashes.bundle}, 3, 'sha256:seed-runtime', 'seed-harness-1', '{"cpuLimitMs":1000,"wallLimitMs":2000,"memoryLimitBytes":134217728}'::jsonb, 'seed-kms-key', ${seededAt})
      ON CONFLICT (id) DO UPDATE SET resource_limits = EXCLUDED.resource_limits
    `;

    await tx`
      INSERT INTO practice.execution_runs (id, attempt_id, code_snapshot_id, test_bundle_id, request_id, status, runner_pool, runtime_image_digest, source_sha256, test_bundle_sha256, cpu_limit_ms, wall_limit_ms, memory_limit_bytes, result, created_at)
      VALUES (${seedIds.executionRun}, ${seedIds.attemptA}, ${seedIds.snapshotA}, ${seedIds.testBundle}, '00000000-0000-0000-0000-000000000608', 'queued', 'seed-runner', 'sha256:seed-runtime', ${hashes.source}, ${hashes.bundle}, 1000, 2000, 134217728, '{"seed":true}'::jsonb, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result
    `;
  });
}

try {
  await seedDev();
  process.stdout.write("Development seed applied.\n");
} finally {
  await sql.end({ timeout: 5 });
}

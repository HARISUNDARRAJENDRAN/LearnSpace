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

export const seedIds = {
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
  embeddingProfile: "seed-1536",
};

const seededAt = "2026-01-01T00:00:00.000Z";
const hashes = {
  publicSource: "1111111111111111111111111111111111111111111111111111111111111111",
  publicContent: "2222222222222222222222222222222222222222222222222222222222222222",
  privateSourceA: "3333333333333333333333333333333333333333333333333333333333333333",
  privateSourceB: "4444444444444444444444444444444444444444444444444444444444444444",
  chunk: "5555555555555555555555555555555555555555555555555555555555555555",
  privateChunkA: "9999999999999999999999999999999999999999999999999999999999999999",
  privateChunkB: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
      INSERT INTO identity.auth_accounts (id, user_id, provider, provider_account_id, provider_email, email_verified, profile, created_at, updated_at)
      VALUES
        (${seedIds.authAccountA}, ${seedIds.userA}, 'seed', 'account-a', 'seed-a@learnspace.local', true, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}),
        (${seedIds.authAccountB}, ${seedIds.userB}, 'seed', 'account-b', 'seed-b@learnspace.local', true, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, provider_email = EXCLUDED.provider_email, email_verified = EXCLUDED.email_verified, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO identity.auth_sessions (id, user_id, rotation_family_id, refresh_token_hash, expires_at, created_at)
      VALUES
        (${seedIds.authSessionA}, ${seedIds.userA}, '00000000-0000-0000-0000-000000000901', 'seed-refresh-a', '2027-01-01T00:00:00.000Z', ${seededAt}),
        (${seedIds.authSessionB}, ${seedIds.userB}, '00000000-0000-0000-0000-000000000902', 'seed-refresh-b', '2027-01-01T00:00:00.000Z', ${seededAt})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at
    `;

    await tx`
      INSERT INTO knowledge.concepts (id, slug, name, kind, summary, status, metadata, created_at, updated_at)
      VALUES (${seedIds.concept}, 'distributed-systems', 'Distributed Systems', 'topic', ${"Systems that coordinate across independent computers."}, 'active', '{}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, summary = EXCLUDED.summary, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO study.learning_goals (id, user_id, primary_concept_id, title, intent, status, metadata, created_at, updated_at)
      VALUES
        (${seedIds.goalA}, ${seedIds.userA}, ${seedIds.concept}, 'Goal A', 'Understand distributed systems', 'active', '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}),
        (${seedIds.goalB}, ${seedIds.userB}, ${seedIds.concept}, 'Goal B', 'Practice distributed systems', 'active', '{"seed":true}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, primary_concept_id = EXCLUDED.primary_concept_id, title = EXCLUDED.title, updated_at = EXCLUDED.updated_at
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
      ON CONFLICT (id) DO NOTHING
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
      VALUES
        (${seedIds.publicChunk}, ${seedIds.publicVersion}, 0, 'paragraph', ARRAY['Distributed Systems'], ${"A distributed system coordinates independent nodes through messages and durable state."}, ${hashes.chunk}, 14, 'en', 1, 1, '{"page":1}'::jsonb, '{"seed":true}'::jsonb, ${seededAt}),
        (${seedIds.privateChunkA}, ${seedIds.privateVersionA}, 0, 'paragraph', ARRAY['Private A'], ${"Private learner A material."}, ${hashes.privateChunkA}, 5, 'en', NULL, NULL, '{}'::jsonb, '{"seed":true}'::jsonb, ${seededAt}),
        (${seedIds.privateChunkB}, ${seedIds.privateVersionB}, 0, 'paragraph', ARRAY['Private B'], ${"Private learner B material."}, ${hashes.privateChunkB}, 5, 'en', NULL, NULL, '{}'::jsonb, '{"seed":true}'::jsonb, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET resource_version_id = EXCLUDED.resource_version_id, content = EXCLUDED.content, metadata = EXCLUDED.metadata
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
      INSERT INTO study.study_sessions (id, user_id, learning_goal_id, title, mode, status, active_resource_id, active_version_id, active_chunk_id, active_anchor, context_version, lock_version, started_at, last_active_at, metadata, created_at, updated_at)
      VALUES
        (${seedIds.sessionA}, ${seedIds.userA}, ${seedIds.goalA}, ${"Seed session A"}, 'guided_learning', 'active', ${seedIds.publicResource}, ${seedIds.publicVersion}, ${seedIds.publicChunk}, '{"offset":0}'::jsonb, 0, 0, ${seededAt}, ${seededAt}, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt}),
        (${seedIds.sessionB}, ${seedIds.userB}, ${seedIds.goalB}, ${"Seed session B"}, 'research', 'active', ${seedIds.privateResourceB}, ${seedIds.privateVersionB}, NULL, NULL, 0, 0, ${seededAt}, ${seededAt}, '{"seed":true}'::jsonb, ${seededAt}, ${seededAt})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, learning_goal_id = EXCLUDED.learning_goal_id, title = EXCLUDED.title, status = EXCLUDED.status, active_resource_id = EXCLUDED.active_resource_id, active_version_id = EXCLUDED.active_version_id, active_chunk_id = EXCLUDED.active_chunk_id, updated_at = EXCLUDED.updated_at
    `;

    await tx`
      INSERT INTO study.session_resources (study_session_id, resource_id, resource_version_id, role, position, added_by, state, added_at)
      VALUES
        (${seedIds.sessionA}, ${seedIds.publicResource}, ${seedIds.publicVersion}, 'primary', 0, 'seed', '{"seed":true}'::jsonb, ${seededAt}),
        (${seedIds.sessionB}, ${seedIds.privateResourceB}, ${seedIds.privateVersionB}, 'primary', 0, 'seed', '{"seed":true}'::jsonb, ${seededAt})
      ON CONFLICT (study_session_id, resource_id) DO UPDATE SET resource_version_id = EXCLUDED.resource_version_id, role = EXCLUDED.role, position = EXCLUDED.position
    `;
  });
}

try {
  await seedDev();
  process.stdout.write("Development seed applied.\n");
} finally {
  await sql.end({ timeout: 5 });
}

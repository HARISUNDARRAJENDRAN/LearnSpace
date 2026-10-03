import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { closeRecommendationRedis, invalidateRecommendations, readRecommendationCache, writeRecommendationCache, redisCommands, recommendationCacheKey, recommendationProfileKey } from "@learnspace/shared/recommendation-cache";
import { retrieveRecommendationCandidates } from "../lib/discovery/candidates";

const axis = (index: number) => Array.from({ length: config.embeddingDimensions }, (_, i) => i === index ? 1 : 0);
test("semantic feed: real database, Redis, projection, provenance, bounded retrieval and failures", { skip: !process.env.DATABASE_MIGRATOR_URL || !process.env.DATABASE_WORKER_URL || !process.env.REDIS_URL }, async () => {
  const previousTestMode = process.env.AUTH_TEST_MODE;
  process.env.AUTH_TEST_MODE = "true";
  const [{ withUserTransaction, closeDb }, { createEmailUser }, { completeOnboarding }, { getHomeFeed, recordInteraction, recordImpression }] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/onboarding/service"), import("../lib/discovery/service"),
  ]);
  const workerModules = "../../../services/worker/dist/";
  const { projectRecommendationProfiles } = await import(`${workerModules}recommendation-profiles.js`);
  const { backfillResourceEmbeddings } = await import(`${workerModules}recommendation-embeddings.js`);
  const { syncCuratedCatalog } = await import(`${workerModules}curated-catalog.js`);
  const db = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 2, prepare: false });
  const worker = postgres(process.env.DATABASE_WORKER_URL!, { max: 2, prepare: false });
  const users: string[] = [], resources: string[] = [], collections: string[] = [];
  const metrics: Record<string, unknown> = {};
  const provider = { async embedQuery() { return axis(0); }, async embedDocuments(texts: string[]) { return texts.map(() => axis(0)); } };
  const profile = async (id: string) => (await db<{ state: any; revision: number }[]>`SELECT state, revision FROM discovery.learner_profiles WHERE user_id = ${id}`)[0]!;
  const event = async (userId: string, resourceId: string, type: string, payload: Record<string, unknown> = {}) => {
    await db`INSERT INTO activity.activity_events (schema_version,user_id,resource_id,event_type,actor_type,source,occurred_at,idempotency_key,payload) VALUES (1,${userId},${resourceId},${type},'user','integration',now(),${randomUUID()},${db.json(payload as postgres.JSONValue)})`;
  };
  try {
    await syncCuratedCatalog(worker);
    assert.equal(await syncCuratedCatalog(worker), 0, "real curriculum ingestion is restart-safe under the worker role");
    const concepts = await db<{ id: string; slug: string }[]>`SELECT id, slug FROM knowledge.concepts WHERE slug IN ('python','linear-algebra','ai-machine-learning') ORDER BY slug`;
    assert.equal(concepts.length, 3);
    const python = concepts.find((c) => c.slug === "python")!.id, ai = concepts.find((c) => c.slug === "ai-machine-learning")!.id;
    for (let i = 0; i < 2; i++) {
      const user = await createEmailUser({ email: `semantic-${randomUUID()}@example.test`, displayName: "Semantic test", passwordHash: "test" });
      users.push(user.id);
      await completeOnboarding(user.id, { persona: "student", learningIntents: ["learn_new_skill"], preferredFormats: ["clear_explanations"], preferredDuration: "no_preference", selfReportedLevel: "beginner", conceptIds: concepts.map((c) => c.id) });
      await db`UPDATE identity.user_settings SET learning_preferences = jsonb_set(learning_preferences,'{conceptIds}',${db.json(i === 0 ? [python] : [])}), updated_at = now() WHERE user_id = ${user.id}`;
    }
    const userId = users[0]!;
    for (let i = 0; i < 48; i++) {
      const id = randomUUID(), youtubeId = id.replaceAll("-", "").slice(0, 11);
      resources.push(id);
      await db`INSERT INTO catalog.resources (id,type,provider,external_id,title,canonical_url,visibility,status,quality_score,metadata) VALUES (${id},'video','youtube',${youtubeId},${`Semantic fixture ${i}`},${`https://youtube.com/watch?v=${youtubeId}`},'public','ready',0.96,${db.json({ test: true, estimatedLevel: i % 3 === 0 ? "intermediate" : "beginner", learningFormat: "clear_explanations" })})`;
      await db`INSERT INTO catalog.video_details (resource_id,youtube_id,channel_title,duration_ms) VALUES (${id},${youtubeId},${`Channel ${i % 12}`},600000)`;
      await db`INSERT INTO catalog.resource_concepts (resource_id,concept_id,source,relevance,is_primary) VALUES (${id},${i < 24 ? python : ai},'semantic-test',1,true)`;
      if (i !== 47) await db`INSERT INTO discovery.resource_embeddings (resource_id,model,source_hash,embedding) VALUES (${id},${config.embeddingModel},'test',${JSON.stringify(axis(i < 24 ? 0 : 1))}::vector)`;
    }
    // Invalid provider output is retryable and does not poison the database transaction.
    const unrelatedDelete = await worker`DELETE FROM catalog.resource_concepts WHERE resource_id = ${resources[0]!} AND source = 'semantic-test' RETURNING resource_id`;
    assert.equal(unrelatedDelete.length, 0, "curated reconciliation cannot delete another extractor's concept evidence");
    const last = resources[47]!;
    assert.deepEqual(await backfillResourceEmbeddings(worker, { ...provider, async embedDocuments() { return [[NaN]]; } }, [last]), { embedded: 0, failed: 1 });
    await db`UPDATE discovery.resource_embeddings SET retry_at = now() WHERE resource_id = ${last}`;
    assert.deepEqual(await backfillResourceEmbeddings(worker, provider, [last]), { embedded: 1, failed: 0 });
    assert.deepEqual(await backfillResourceEmbeddings(worker, provider, [last]), { embedded: 0, failed: 0 });
    await assert.rejects(() => db`UPDATE discovery.resource_embeddings SET embedding = '[1,2]'::vector WHERE resource_id = ${last}`, /dimensions/);
    await assert.rejects(() => db`UPDATE discovery.resource_embeddings SET embedding = ${JSON.stringify(Array(config.embeddingDimensions).fill(0))}::vector WHERE resource_id = ${last}`, /nonzero/);
    const immediate = await getHomeFeed(userId, "discover");
    assert.ok(immediate.sections.recommendedVideos.length > 0, "onboarding works before the background profile exists");
    const started = performance.now();
    assert.equal(await projectRecommendationProfiles(worker, provider, users), 2);
    metrics.profileUpdateTwoUsersMs = performance.now() - started;
    let p = await profile(userId);
    assert.deepEqual(p.state.learning.recentInterests, {});
    assert.equal(p.state.learning.longTermVector.length, 1536);
    assert.equal(await projectRecommendationProfiles(worker, provider, users), 0, "projection is restart-safe");
    const feed = await getHomeFeed(userId, "discover", { onTiming: (t) => { metrics.cacheMiss = t; } });
    assert.ok(feed.sections.recommendedVideos.length >= 6);
    assert.ok(feed.sections.recommendedVideos.length <= 24);
    assert.equal(feed.personalization, "interests");
    assert.ok(feed.sections.recommendedVideos.every((c) => !Object.hasOwn(c, "score")));
    const concurrent = await Promise.all(Array.from({ length: 20 }, () => getHomeFeed(userId, "discover")));
    assert.ok(concurrent.every((f) => f.runId === feed.runId));
    const hits: number[] = [];
    for (let i = 0; i < 20; i++) await getHomeFeed(userId, "discover", { onTiming: (t) => { assert.equal(t.cacheHit, true); hits.push(Number(t.total)); } });
    metrics.cacheHitSamplesMs = hits;
    const noInterests = await getHomeFeed(users[1]!, "discover");
    assert.ok(noInterests.sections.recommendedVideos.length > 0);
    assert.notEqual(noInterests.runId, feed.runId);
    await withUserTransaction(users[1]!, async (tx) => { assert.equal(Array.from(await tx.execute(sql`SELECT user_id FROM discovery.learner_profiles WHERE user_id = ${userId}`)).length, 0); });
    const card = feed.sections.recommendedVideos[0]!;
    await recordImpression(userId, { runId: feed.runId!, resourceId: card.resourceId, position: card.position!, surface: "discover", visibleDurationMs: 1000 });
    await recordInteraction(userId, { runId: feed.runId!, resourceId: card.resourceId, action: "open", correlationId: randomUUID(), metadata: {} });
    await projectRecommendationProfiles(worker, provider, [userId]);
    assert.equal((await profile(userId)).revision, p.revision, "an accidental click is neutral");
    assert.equal((await getHomeFeed(userId, "discover")).runId, feed.runId);
    for (let i = 0; i < 20; i++) await event(userId, resources[24 + i % 20]!, "resource.completed", { progressPct: 95, watchedSeconds: 570 });
    const updateStart = performance.now();
    await projectRecommendationProfiles(worker, provider, [userId]);
    metrics.profileUpdateTwentyEventsMs = performance.now() - updateStart;
    p = await profile(userId);
    assert.ok(p.state.learning.recentInterests[ai] > p.state.learning.recentInterests[python] || !p.state.learning.recentInterests[python]);
    assert.ok(p.state.learning.longTermInterests[python] > 0);
    assert.equal(await projectRecommendationProfiles(worker, provider, [userId]), 0);
    const shifted = await getHomeFeed(userId, "discover");
    assert.notEqual(shifted.runId, feed.runId);
    assert.equal(shifted.personalization, "learning");
    assert.ok(shifted.sections.interests.some((c) => c.id === ai));
    const focused = await getHomeFeed(userId, "discover", { topicId: ai });
    assert.ok(focused.sections.recommendedVideos.length > 0);
    const focusedIds = focused.sections.recommendedVideos.map((c) => c.resourceId);
    const actualTopics = await db`SELECT DISTINCT resource_id FROM catalog.resource_concepts WHERE resource_id = ANY(${focusedIds}::uuid[]) AND concept_id = ${ai}`;
    assert.equal(actualTopics.length, focusedIds.length);
    const focusedCard = focused.sections.recommendedVideos[0]!;
    await recordInteraction(userId, { runId: focused.runId!, resourceId: focusedCard.resourceId, action: "dismiss", correlationId: randomUUID(), metadata: {} });
    await projectRecommendationProfiles(worker, provider, [userId]);
    assert.ok(!(await getHomeFeed(userId, "discover", { topicId: ai })).sections.recommendedVideos.some((c) => c.resourceId === focusedCard.resourceId));
    const completed = resources[25]!;
    await db`INSERT INTO study.user_resource_progress (user_id,resource_id,status,progress_pct,completed_at) VALUES (${userId},${completed},'completed',100,now())`;
    await projectRecommendationProfiles(worker, provider, [userId]);
    assert.ok(!(await getHomeFeed(userId, "discover")).sections.recommendedVideos.some((c) => c.resourceId === completed));
    const collectionId = randomUUID(), firstSection = randomUUID(), nextSection = randomUUID(), firstItem = randomUUID(), nextItem = randomUUID();
    collections.push(collectionId);
    await db`INSERT INTO catalog.collections (id,kind,title,visibility) VALUES (${collectionId},'playlist','Integration progression','public')`;
    await db`INSERT INTO catalog.collection_sections (id,collection_id,title,position) VALUES (${firstSection},${collectionId},'Foundations',0),(${nextSection},${collectionId},'Application',1)`;
    await db`INSERT INTO catalog.collection_items (id,section_id,resource_id,position) VALUES (${firstItem},${firstSection},${completed},0),(${nextItem},${nextSection},${resources[26]!},0)`;
    await db`INSERT INTO catalog.collection_enrollments (user_id,collection_id,current_item_id,status,progress_pct) VALUES (${userId},${collectionId},${firstItem},'active',50)`;
    const candidates = await withUserTransaction(userId, (tx) => retrieveRecommendationCandidates(tx, userId, axis(1), [ai], false));
    assert.ok(candidates.continuationIds.includes(resources[26]!), "continuation crosses sections and skips completed lessons");
    assert.ok(candidates.ids.length <= config.candidateCount);
    assert.equal(new Set(candidates.ids).size, candidates.ids.length);
    assert.equal(candidates.fallback, false);
    metrics.annMs = candidates.annMs;
    await db`ALTER TABLE discovery.resource_embeddings RENAME TO unavailable_embeddings`;
    try { const fallback = await withUserTransaction(userId, (tx) => retrieveRecommendationCandidates(tx, userId, axis(1), [ai], false)); assert.equal(fallback.fallback, true); assert.ok(fallback.ids.length > 0); }
    finally { await db`ALTER TABLE discovery.unavailable_embeddings RENAME TO resource_embeddings`; }
    const cached = await readRecommendationCache<any>(userId);
    assert.ok(cached.entry);
    await writeRecommendationCache({ ...cached.entry!, freshUntil: Date.now() - 1 });
    const scheduled: Array<() => Promise<void>> = [];
    assert.equal((await getHomeFeed(userId, "discover", { scheduleRefresh: (work) => { scheduled.push(work); } })).stale, true);
    assert.equal(scheduled.length, 1);
    await scheduled[0]!();
    await invalidateRecommendations(userId);
    assert.equal((await readRecommendationCache(userId)).entry, null);
    await redisCommands([["SET", recommendationCacheKey(userId), "{broken"]]);
    assert.equal((await readRecommendationCache(userId)).entry, null);
    const redisUrl = process.env.REDIS_URL;
    await closeRecommendationRedis(); process.env.REDIS_URL = "redis://127.0.0.1:1";
    try { assert.equal((await readRecommendationCache(userId)).entry, null); assert.ok((await getHomeFeed(userId, "discover")).sections.recommendedVideos.length > 0); }
    finally { await closeRecommendationRedis(); process.env.REDIS_URL = redisUrl!; }
    // Production excludes fixture/sample resources even if they have vectors.
    const authTest = process.env.AUTH_TEST_MODE; delete process.env.AUTH_TEST_MODE;
    try { const production = await withUserTransaction(userId, (tx) => retrieveRecommendationCandidates(tx, userId, axis(0), [python], false)); assert.ok(production.ids.every((id) => !resources.includes(id))); }
    finally { process.env.AUTH_TEST_MODE = authTest; }
    await mkdir("../../docs/benchmarks", { recursive: true });
    await writeFile("../../docs/benchmarks/semantic-integration.json", JSON.stringify(metrics, null, 2));
  } catch (error) { console.error("semantic integration failure", error); throw error; } finally {
    try {
    for (const id of users) {
      await redisCommands([["DEL", recommendationCacheKey(id), recommendationProfileKey(id)]]);
      await db`DELETE FROM discovery.discovery_interactions WHERE user_id = ${id}`;
      await db`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${id}`;
      await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${id})`;
      await db`DELETE FROM discovery.recommendation_runs WHERE user_id = ${id}`;
      await db`DELETE FROM activity.activity_events WHERE user_id = ${id}`;
      await db`DELETE FROM ops.outbox_events WHERE user_id = ${id}`;
      await db`DELETE FROM catalog.library_items WHERE user_id = ${id}`;
      await db`DELETE FROM study.user_resource_progress WHERE user_id = ${id}`;
      await db`DELETE FROM identity.users WHERE id = ${id}`;
    }
    if (collections.length) {
      await db`DELETE FROM catalog.collection_items WHERE section_id IN (SELECT id FROM catalog.collection_sections WHERE collection_id = ANY(${collections}::uuid[]))`;
      await db`DELETE FROM catalog.collection_sections WHERE collection_id = ANY(${collections}::uuid[])`;
      await db`DELETE FROM catalog.collections WHERE id = ANY(${collections}::uuid[])`;
    }
    await db`DELETE FROM catalog.resource_concepts WHERE resource_id = ANY(${resources}::uuid[])`;
    await db`DELETE FROM catalog.video_details WHERE resource_id = ANY(${resources}::uuid[])`;
    await db`DELETE FROM catalog.resources WHERE id = ANY(${resources}::uuid[])`;
    } finally {
      await Promise.all([worker.end(), db.end(), closeDb(), closeRecommendationRedis()]);
      if (previousTestMode === undefined) delete process.env.AUTH_TEST_MODE;
      else process.env.AUTH_TEST_MODE = previousTestMode;
    }
  }
});

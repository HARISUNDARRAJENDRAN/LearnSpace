import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";

test("the discover feed reuses its ranking until new videos land, without Redis", { skip: !process.env.DATABASE_MIGRATOR_URL || Boolean(process.env.REDIS_URL) }, async () => {
  const previousFlag = process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED;
  process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED = "true";
  const [{ closeDb }, { createEmailUser }, { completeOnboarding }, { getHomeFeed }] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/onboarding/service"), import("../lib/discovery/service"),
  ]);
  const db = postgres(process.env.DATABASE_MIGRATOR_URL ?? "", { max: 1, prepare: false });
  const user = await createEmailUser({ email: `catalog-refresh-${randomUUID()}@example.test`, displayName: "Catalog refresh test", passwordHash: "test" });
  const resourceId = randomUUID();
  try {
    const concepts = await db<{ id: string }[]>`SELECT id FROM knowledge.concepts WHERE slug IN ('python', 'linear-algebra', 'ai-machine-learning')`;
    await completeOnboarding(user.id, { persona: "student", learningIntents: ["learn_new_skill"], preferredFormats: ["clear_explanations"], preferredDuration: "no_preference", selfReportedLevel: "beginner", conceptIds: concepts.map((row) => row.id) });
    const first = await getHomeFeed(user.id, "discover");
    assert.equal((await getHomeFeed(user.id, "discover")).runId, first.runId, "an unchanged catalog reuses the ranking");
    await db`INSERT INTO catalog.resources (id, type, provider, title, canonical_url, visibility, status, quality_score) VALUES (${resourceId}, 'video', 'youtube', 'Freshly discovered lesson', 'https://youtube.com/watch?v=freshlesson', 'public', 'ready', 0.9)`;
    await db`INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms) VALUES (${resourceId}, ${randomUUID().replaceAll("-", "").slice(0, 11)}, 'Fresh Lab', 900000)`;
    await db`INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary) VALUES (${resourceId}, ${concepts[0]!.id}, 'integration', 1, true)`;
    assert.notEqual((await getHomeFeed(user.id, "discover")).runId, first.runId, "a newly discovered video re-ranks the feed");
  } finally {
    await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${user.id})`;
    await db`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
    await db`DELETE FROM activity.activity_events WHERE user_id = ${user.id}`;
    await db`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
    await db`DELETE FROM identity.users WHERE id = ${user.id}`;
    await db`DELETE FROM catalog.resource_concepts WHERE resource_id = ${resourceId}`;
    await db`DELETE FROM catalog.video_details WHERE resource_id = ${resourceId}`;
    await db`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
    await db.end({ timeout: 5 });
    await closeDb();
    await closeRecommendationRedis();
    if (previousFlag === undefined) delete process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED;
    else process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED = previousFlag;
  }
});

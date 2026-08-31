import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { OnboardingCompletion } from "@learnspace/shared/onboarding";
import { hashPassword } from "../lib/auth/crypto";

const databaseAvailable = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL,
);

test(
  "discovery persists deterministic runs and idempotent telemetry",
  { skip: databaseAvailable ? false : "DATABASE_URL, DATABASE_AUTH_URL, and DATABASE_MIGRATOR_URL are required" },
  async () => {
    const [{ createEmailUser }, { completeOnboarding }, { getHomeFeed, recordImpression, recordInteraction }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/onboarding/service"),
      import("../lib/discovery/service"),
      import("@learnspace/db"),
    ]);
    const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
    if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required for discovery integration tests");
    const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
    const userIds: string[] = [];
    let resourceId: string | null = null;

    try {
      const concepts = await migrator<{ id: string; slug: string; name: string }[]>`
        SELECT id, slug, name
        FROM knowledge.concepts
        WHERE slug IN ('ai-machine-learning', 'python', 'linear-algebra')
        ORDER BY slug
      `;
      assert.equal(concepts.length, 3);
      const interestConcept = concepts[1];
      if (!interestConcept) throw new Error("expected a canonical interest concept");
      const user = await createEmailUser({
        email: `discovery-${randomUUID()}@example.test`,
        displayName: "Discovery Learner",
        passwordHash: await hashPassword("discovery-password-123"),
      });
      userIds.push(user.id);
      const completion: OnboardingCompletion = {
        persona: "student",
        learningIntents: ["learn_new_skill"],
        preferredFormats: ["clear_explanations"],
        preferredDuration: "no_preference",
        selfReportedLevel: "beginner",
        conceptIds: concepts.map((concept) => concept.id),
      };
      await completeOnboarding(user.id, completion);

      const [resource] = await migrator<{ id: string }[]>`
        INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
        VALUES ('video', 'youtube', ${`integration-${randomUUID()}`}, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'A practical Python lesson', 'A complete beginner explanation.', 'public', 'ready', 0.9, '{}'::jsonb)
        RETURNING id
      `;
      resourceId = resource?.id ?? null;
      assert.ok(resourceId);
      await migrator`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
        VALUES (${resourceId}, ${`abc${randomUUID().replaceAll("-", "").slice(0, 8)}`}, 'Learn Lab', 1200000, now())
      `;
      await migrator`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
        VALUES (${resourceId}, ${interestConcept.id}, 'integration', 1, true)
      `;

      const firstFeed = await getHomeFeed(user.id);
      assert.equal(firstFeed.stale, false);
      assert.ok(firstFeed.runId);
      assert.equal(firstFeed.sections.recommendedVideos.some((card) => card.resourceId === resourceId), true);
      const runs = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count FROM discovery.recommendation_runs WHERE user_id = ${user.id} AND surface = 'home'
      `;
      assert.equal(Number(runs[0]?.count), 1);
      const candidates = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${firstFeed.runId}
      `;
      assert.ok(Number(candidates[0]?.count) >= 1);

      const card = firstFeed.sections.recommendedVideos.find((item) => item.resourceId === resourceId);
      assert.ok(card);
      const impression = await recordImpression(user.id, {
        runId: card.runId,
        resourceId: card.resourceId,
        position: card.position,
        surface: "home",
      });
      const correlationId = randomUUID();
      assert.equal((await recordInteraction(user.id, { runId: card.runId, impressionId: impression.id ?? undefined, resourceId: card.resourceId, action: "save", correlationId, metadata: {} })).duplicate, false);
      assert.equal((await recordInteraction(user.id, { runId: card.runId, impressionId: impression.id ?? undefined, resourceId: card.resourceId, action: "save", correlationId, metadata: {} })).duplicate, true);
      const interactions = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count FROM discovery.discovery_interactions WHERE user_id = ${user.id} AND correlation_id = ${correlationId}
      `;
      assert.equal(Number(interactions[0]?.count), 1);

      const concurrentCorrelationId = randomUUID();
      const concurrentResults = await Promise.all([
        recordInteraction(user.id, { runId: card.runId, resourceId: card.resourceId, action: "open", correlationId: concurrentCorrelationId, metadata: {} }),
        recordInteraction(user.id, { runId: card.runId, resourceId: card.resourceId, action: "open", correlationId: concurrentCorrelationId, metadata: {} }),
      ]);
      assert.equal(concurrentResults.filter((result) => !result.duplicate).length, 1);
      const concurrentInteractions = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count FROM discovery.discovery_interactions WHERE user_id = ${user.id} AND correlation_id = ${concurrentCorrelationId}
      `;
      assert.equal(Number(concurrentInteractions[0]?.count), 1);
    } finally {
      for (const userId of userIds) {
        await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${userId}`;
        await migrator`DELETE FROM catalog.library_items WHERE user_id = ${userId}`;
        await migrator`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${userId}`;
        await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${userId})`;
        await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${userId}`;
        await migrator`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
        await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${userId}`;
        await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
      }
      if (resourceId) {
        await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id = ${resourceId}`;
        await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${resourceId}`;
        await migrator`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
      }
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

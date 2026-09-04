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
    let activeResourceId: string | null = null;
    let activeVersionId: string | null = null;
    let activeSessionId: string | null = null;
    let weightedResourceId: string | null = null;
    const adjacentConceptId = randomUUID();

    try {
      const concepts = await migrator<{ id: string; slug: string; name: string }[]>`
        SELECT id, slug, name
        FROM knowledge.concepts
        WHERE slug IN ('ai-machine-learning', 'python', 'linear-algebra')
        ORDER BY slug
      `;
      assert.equal(concepts.length, 3);
      const [conceptA, conceptB, conceptC] = concepts;
      if (!conceptA || !conceptB || !conceptC) throw new Error("expected three canonical concepts");
      const interestConcept = concepts[1];
      if (!interestConcept) throw new Error("expected a canonical interest concept");
      await migrator`
        INSERT INTO knowledge.concepts (id, slug, name, kind, summary, status)
        VALUES (${adjacentConceptId}, ${`integration-adjacent-${randomUUID()}`}, 'Adjacent concept', 'topic', 'A related concept for discovery projection tests.', 'active')
      `;
      await migrator`
        INSERT INTO knowledge.concept_relations (source_concept_id, target_concept_id, relation_type, weight, confidence, status, created_by)
        VALUES (${interestConcept.id}, ${adjacentConceptId}, 'related_to', 0.9, 0.9, 'accepted', 'integration')
      `;
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

      const weightedYoutubeId = `wgt${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const [weightedResource] = await migrator<{ id: string }[]>`
        INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
        VALUES ('video', 'youtube', ${`weighted-${randomUUID()}`}, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Weighted concept lesson', 'A lesson with weighted concept mappings.', 'public', 'ready', 0.9, '{}'::jsonb)
        RETURNING id
      `;
      weightedResourceId = weightedResource?.id ?? null;
      assert.ok(weightedResourceId);
      await migrator`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
        VALUES (${weightedResourceId}, ${weightedYoutubeId}, 'Weighted Concept Lab', 1200000, now())
      `;
      await migrator`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
        VALUES
          (${weightedResourceId}, ${conceptA.id}, 'integration-weighted', 0.95, true),
          (${weightedResourceId}, ${conceptB.id}, 'integration-weighted', 0.70, false),
          (${weightedResourceId}, ${conceptC.id}, 'integration-weighted', 0.20, false)
      `;

      activeResourceId = randomUUID();
      activeVersionId = randomUUID();
      activeSessionId = randomUUID();
      const activeYoutubeId = `act${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      await migrator`
        INSERT INTO catalog.resources (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
        VALUES (${activeResourceId}, 'video', 'youtube', ${`active-${randomUUID()}`}, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'An active learning session', 'A resource pinned by an active study session.', 'public', 'ready', 0.1, '{}'::jsonb)
      `;
      await migrator`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
        VALUES (${activeResourceId}, ${activeYoutubeId}, 'Active Session Lab', 600000, now())
      `;
      await migrator`
        INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, raw_object_key, mime_type, processing_status, fetched_at, ready_at)
        VALUES (${activeVersionId}, ${activeResourceId}, 1, ${"a".repeat(64)}, ${`integration/${activeResourceId}/raw.mp4`}, 'video/mp4', 'ready', now(), now())
      `;
      await migrator`
        UPDATE catalog.resources SET current_version_id = ${activeVersionId} WHERE id = ${activeResourceId}
      `;
      await migrator`
        INSERT INTO study.study_sessions (id, user_id, title, mode, status, active_resource_id, active_version_id, context_version, lock_version, started_at, last_active_at, metadata)
        VALUES (${activeSessionId}, ${user.id}, 'Active discovery session', 'guided_learning', 'active', ${activeResourceId}, ${activeVersionId}, 0, 0, now(), now(), '{}'::jsonb)
      `;

      const firstFeed = await getHomeFeed(user.id);
      assert.equal(firstFeed.stale, false);
      assert.ok(firstFeed.runId);
      assert.equal(firstFeed.sections.recommendedVideos.some((card) => card.resourceId === resourceId), true);
      assert.equal(firstFeed.sections.continueLearning.some((card) => card.resourceId === activeResourceId), true);
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
      const adjacentAffinity = await migrator<{ feature_version: string; positive_weight: number; negative_weight: number }[]>`
        SELECT feature_version, positive_weight, negative_weight
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id} AND concept_id = ${adjacentConceptId}
      `;
      assert.equal(adjacentAffinity[0]?.feature_version, "discovery-behavior-v1");
      assert.ok(Number(adjacentAffinity[0]?.positive_weight) > 0);
      const refreshPayloads = await migrator<{ payload: Record<string, unknown> }[]>`
        SELECT payload
        FROM ops.outbox_events
        WHERE user_id = ${user.id} AND event_type = 'discovery.refresh_requested'
        ORDER BY created_at DESC
      `;
      assert.equal(
        refreshPayloads.some((row) => Array.isArray(row.payload.conceptIds) && row.payload.conceptIds.includes(adjacentConceptId)),
        true,
      );

      const beforeWeighted = await migrator<{ concept_id: string; positive_weight: number }[]>`
        SELECT concept_id, positive_weight
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id} AND concept_id IN ${migrator(concepts.map((concept) => concept.id))}
      `;
      const weightedCorrelationId = randomUUID();
      assert.equal((await recordInteraction(user.id, {
        runId: card.runId,
        resourceId: weightedResourceId,
        action: "complete",
        correlationId: weightedCorrelationId,
        metadata: {},
      })).duplicate, false);
      const afterWeighted = await migrator<{ concept_id: string; positive_weight: number }[]>`
        SELECT concept_id, positive_weight
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id} AND concept_id IN ${migrator(concepts.map((concept) => concept.id))}
      `;
      const weightedDelta = (conceptId: string): number => {
        const before = Number(beforeWeighted.find((row) => row.concept_id === conceptId)?.positive_weight ?? 0);
        const after = Number(afterWeighted.find((row) => row.concept_id === conceptId)?.positive_weight ?? 0);
        return after - before;
      };
      assert.ok(weightedDelta(conceptA.id) > weightedDelta(conceptB.id));
      assert.equal(weightedDelta(conceptC.id), 0);

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

      const adjacentBeforeDismiss = await migrator<{ positive_weight: number; negative_weight: number }[]>`
        SELECT positive_weight, negative_weight
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id} AND concept_id = ${adjacentConceptId}
      `;

      const dismissCorrelationId = randomUUID();
      assert.equal((await recordInteraction(user.id, { runId: card.runId, resourceId: card.resourceId, action: "dismiss", correlationId: dismissCorrelationId, metadata: {} })).duplicate, false);
      assert.equal((await recordInteraction(user.id, { runId: card.runId, resourceId: card.resourceId, action: "dismiss", correlationId: dismissCorrelationId, metadata: {} })).duplicate, true);
      const removed = await migrator<{ status: string }[]>`
        SELECT status FROM catalog.library_items WHERE user_id = ${user.id} AND resource_id = ${resourceId}
      `;
      assert.equal(removed[0]?.status, "removed");
      const adjacentAfterDismiss = await migrator<{ positive_weight: number; negative_weight: number }[]>`
        SELECT positive_weight, negative_weight
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id} AND concept_id = ${adjacentConceptId}
      `;
      assert.equal(Number(adjacentAfterDismiss[0]?.positive_weight), Number(adjacentBeforeDismiss[0]?.positive_weight));
      assert.equal(Number(adjacentAfterDismiss[0]?.negative_weight), Number(adjacentBeforeDismiss[0]?.negative_weight));

      const dismissedFeed = await getHomeFeed(user.id);
      assert.equal(dismissedFeed.sections.recommendedVideos.some((item) => item.resourceId === resourceId), false);
      assert.equal(dismissedFeed.sections.freshForYou.some((item) => item.resourceId === resourceId), false);
      assert.ok(dismissedFeed.runId);
      await migrator`
        INSERT INTO discovery.recommendation_candidates
          (recommendation_run_id, resource_id, candidate_rank, final_rank, score, semantic_relevance, quality_score, freshness_score, reason_codes, selected)
        VALUES (${dismissedFeed.runId}, ${resourceId}, 1, 1, 0.99, 1, 0.99, 1, '["concept_match"]'::jsonb, true)
        ON CONFLICT DO NOTHING
      `;
      const reusedDismissedRun = await getHomeFeed(user.id);
      assert.equal(reusedDismissedRun.sections.recommendedVideos.some((item) => item.resourceId === resourceId), false);
      assert.equal(reusedDismissedRun.sections.freshForYou.some((item) => item.resourceId === resourceId), false);
    } finally {
      if (activeSessionId) await migrator`DELETE FROM study.study_sessions WHERE id = ${activeSessionId}`;
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
      if (activeResourceId) await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${activeResourceId}`;
      if (activeVersionId) await migrator`DELETE FROM catalog.resource_versions WHERE id = ${activeVersionId}`;
      if (activeResourceId) {
        await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${activeResourceId}`;
        await migrator`DELETE FROM catalog.resources WHERE id = ${activeResourceId}`;
      }
      if (resourceId) {
        await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id = ${resourceId}`;
        await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${resourceId}`;
        await migrator`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
      }
      if (weightedResourceId) {
        await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id = ${weightedResourceId}`;
        await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${weightedResourceId}`;
        await migrator`DELETE FROM catalog.resources WHERE id = ${weightedResourceId}`;
      }
      await migrator`DELETE FROM knowledge.concepts WHERE id = ${adjacentConceptId}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

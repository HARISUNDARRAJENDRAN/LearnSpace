import type postgres from "postgres";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { behaviorSignal, observationFromActivity, updateLearningState, updateBehaviorAffinity, validVector, LEARNER_MODEL_VERSION, AFFINITY_HALF_LIFE_DAYS, type CompactLearningState } from "@learnspace/shared/recommendation-model";
import { invalidateRecommendations, recommendationProfileKey, redisCommands } from "@learnspace/shared/recommendation-cache";
import type { EmbeddingProvider } from "./embeddings.js";

type Sql = ReturnType<typeof postgres>;
export async function projectRecommendationProfiles(db: Sql, provider: EmbeddingProvider | null, userIds: string[] = [], signal?: AbortSignal): Promise<number> {
  const users = await db<{ user_id: string }[]>`
    SELECT s.user_id FROM identity.user_settings s LEFT JOIN discovery.learner_profiles p ON p.user_id = s.user_id
    WHERE s.onboarding_completed_at IS NOT NULL AND (${userIds.length === 0} OR s.user_id = ANY(${userIds}::uuid[])) AND (p.user_id IS NULL OR p.state->>'version' IS DISTINCT FROM ${config.version} OR (${provider !== null} AND jsonb_array_length(COALESCE(s.learning_preferences->'conceptIds', '[]'::jsonb)) > 0 AND p.state->'learning'->>'onboardingVector' IS NULL) OR s.updated_at > p.updated_at OR p.updated_at < now() - interval '1 hour' OR EXISTS (SELECT 1 FROM knowledge.concept_relations x WHERE x.updated_at > p.updated_at) OR EXISTS (SELECT 1 FROM discovery.recommendation_impressions x WHERE x.user_id = s.user_id AND x.shown_at + interval '12 hours' BETWEEN p.updated_at AND now()) OR EXISTS (SELECT 1 FROM catalog.collection_enrollments x WHERE x.user_id = s.user_id AND x.updated_at > p.updated_at) OR EXISTS (SELECT 1 FROM study.user_resource_progress x WHERE x.user_id = s.user_id AND x.updated_at > p.updated_at) OR EXISTS (SELECT 1 FROM study.study_sessions x WHERE x.user_id = s.user_id AND x.last_active_at > p.updated_at) OR EXISTS (SELECT 1 FROM knowledge.concept_mastery x WHERE x.user_id = s.user_id AND x.updated_at > p.updated_at) OR EXISTS (SELECT 1 FROM study.learning_goals x WHERE x.user_id = s.user_id AND x.updated_at > p.updated_at) OR EXISTS (
      SELECT 1 FROM activity.activity_events a WHERE a.user_id = s.user_id
        AND a.event_type IN ('resource.opened','session.started','resource.saved','discovery.dismissed','question.asked','exercise.completed','review.completed','resource.consumed','resource.progressed','resource.completed','resource.abandoned')
        AND a.occurred_at > now() - interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM activity.activity_events done WHERE done.idempotency_key = 'recommend-profile:' || ${config.version} || ':' || a.id::text)
    )) ORDER BY p.updated_at NULLS FIRST LIMIT ${config.profileBatchSize}
  `;
  let projected = 0;
  for (const { user_id: userId } of users) {
    if (signal?.aborted) break;
    const started = performance.now();
    // Network work uses no transaction or reserved connection. Re-check preferences
    // under the projection lock before accepting this onboarding vector.
    const [input] = await db<{ preferences: Record<string, unknown>; state: Record<string, unknown> | null }[]>`
      SELECT s.learning_preferences preferences, p.state FROM identity.user_settings s
      LEFT JOIN discovery.learner_profiles p ON p.user_id = s.user_id WHERE s.user_id = ${userId}`;
    const inputIds = Array.isArray(input?.preferences.conceptIds) ? input.preferences.conceptIds as string[] : [];
    const inputKey = JSON.stringify(inputIds.slice().sort());
    const priorIds = (input?.state?.preferences as { conceptIds?: string[] } | undefined)?.conceptIds ?? [];
    const priorLearning = input?.state?.version === config.version ? input.state.learning as CompactLearningState : undefined;
    let onboardingVector = JSON.stringify(priorIds.slice().sort()) === inputKey ? priorLearning?.onboardingVector ?? null : null;
    if (!onboardingVector && inputIds.length && provider) {
      const topics = await db<{ name: string }[]>`SELECT name FROM knowledge.concepts WHERE id = ANY(${inputIds}) AND status = 'active' ORDER BY id`;
      if (topics.length) try {
        const vector = await provider.embedQuery(topics.map((topic) => topic.name).join(", "));
        if (!validVector(vector)) throw new Error("Invalid embedding provider response");
        onboardingVector = vector;
      }
      catch { console.warn(JSON.stringify({ metric: "embedding_failure_count", count: 1, stage: "onboarding-profile" })); }
    }
    const result = await db.begin(async (tx) => {
      const [lock] = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`learner-profile:${userId}`}, 0)) locked`;
      if (!lock?.locked) return null;
      const [settings] = await tx<{ learning_preferences: Record<string, unknown>; onboarding_completed_at: Date }[]>`SELECT learning_preferences, onboarding_completed_at FROM identity.user_settings WHERE user_id = ${userId}`;
      if (!settings) return null;
      const [previous] = await tx<{ state: Record<string, unknown>; revision: number }[]>`SELECT state, revision FROM discovery.learner_profiles WHERE user_id = ${userId} AND state->>'version' = ${config.version}`;
      const preferences = settings.learning_preferences;
      const coreIds = Array.isArray(preferences.conceptIds) ? preferences.conceptIds as string[] : [];
      let learning = previous?.state.learning as CompactLearningState | undefined;
      // Explicit interests live in preferences. These weights contain behaviour only.
      learning ??= { longTermInterests: {}, recentInterests: {}, onboardingVector: null, longTermVector: null, recentVector: null, evidence: 0, updatedAt: new Date().toISOString() };
      const currentKey = JSON.stringify(coreIds.slice().sort());
      const previousIds = (previous?.state.preferences as { conceptIds?: string[] } | undefined)?.conceptIds ?? [];
      const previousVector = learning.onboardingVector;
      if (JSON.stringify(previousIds.slice().sort()) !== currentKey) learning.onboardingVector = null;
      if (currentKey === inputKey) learning.onboardingVector = onboardingVector;
      const events = await tx<{ id: string; resource_id: string | null; concept_id: string | null; event_type: string; payload: Record<string, unknown>; occurred_at: Date; embedding: string | null; duration_ms: number | null; metadata: Record<string, unknown>; concept_weights: Record<string, number> }[]>`
        SELECT a.id, a.resource_id, a.concept_id, a.event_type, a.payload, a.occurred_at, e.embedding, v.duration_ms, r.metadata,
          COALESCE((SELECT jsonb_object_agg(rc.concept_id::text, rc.relevance) FROM (SELECT concept_id, max(relevance) relevance FROM catalog.resource_concepts WHERE resource_id = a.resource_id AND relevance >= ${config.minimumTopicRelevance} GROUP BY concept_id) rc), '{}'::jsonb) concept_weights
        FROM activity.activity_events a LEFT JOIN discovery.resource_embeddings e ON e.resource_id = a.resource_id AND e.model = ${config.embeddingModel} LEFT JOIN catalog.resources r ON r.id = a.resource_id LEFT JOIN catalog.video_details v ON v.resource_id = a.resource_id
        WHERE a.user_id = ${userId} AND a.event_type IN ('resource.opened','session.started','resource.saved','discovery.dismissed','question.asked','exercise.completed','review.completed','resource.consumed','resource.progressed','resource.completed','resource.abandoned')
          AND a.occurred_at > now() - interval '90 days' AND NOT EXISTS (SELECT 1 FROM activity.activity_events done WHERE done.idempotency_key = 'recommend-profile:' || ${config.version} || ':' || a.id::text)
        ORDER BY a.occurred_at, a.id LIMIT ${config.eventBatchSize}
      `;
      const observedPreferences = previous?.state.observedPreferences as { durationMs?: number; formats?: Record<string, number> } ?? {};
      let totalEvidence = Number(previous?.state.totalEvidence ?? 0);
      for (const event of events) {
        const observation = observationFromActivity(event.event_type, event.payload);
        if (observation) {
          const weights = event.concept_weights;
          if (event.concept_id) weights[event.concept_id] ??= 1;
          // Historical catch-up is decayed at event time; the final state decays again when served.
          learning = updateLearningState(learning, observation, weights, event.embedding ? JSON.parse(event.embedding) as number[] : null, event.occurred_at);
          const signal = behaviorSignal(observation);
          totalEvidence += signal.confidence;
          if (signal.positive >= config.significantEvidence) {
            const alpha = Math.min(config.durationLearningAlpha, signal.positive);
            if (event.duration_ms) observedPreferences.durationMs = observedPreferences.durationMs ? observedPreferences.durationMs * (1 - alpha) + event.duration_ms * alpha : event.duration_ms;
            const format = event.metadata?.learningFormat;
            if (typeof format === "string") { observedPreferences.formats ??= {}; observedPreferences.formats[format] = (observedPreferences.formats[format] ?? 0) + signal.positive; }
          }
          if (signal.positive || signal.negative) {
            const [marker] = await tx<{ id: string }[]>`INSERT INTO activity.activity_events (schema_version, user_id, resource_id, event_type, actor_type, source, occurred_at, idempotency_key, causation_id, payload) VALUES (1, ${userId}, ${event.resource_id}, 'discovery.affinity_projected', 'system', 'worker', now(), ${`affinity:${LEARNER_MODEL_VERSION}:${event.id}`}, ${event.id}, ${tx.json({ observation, projectorVersion: LEARNER_MODEL_VERSION, sourceEventId: event.id })}) ON CONFLICT DO NOTHING RETURNING id`;
            if (marker) for (const [conceptId, relevance] of Object.entries(weights)) {
              const multiplier = relevance >= .9 ? 1 : relevance >= .7 ? .7 : .1;
              const ageDecay = .5 ** (Math.max(0, Date.now() - event.occurred_at.getTime()) / (AFFINITY_HALF_LIFE_DAYS * 86400000));
              const positive = signal.positive * multiplier * ageDecay, negative = signal.negative * multiplier * ageDecay;
              const [prior] = await tx<{ score: number; confidence: number; positive_weight: number; negative_weight: number; feature_version: string; last_event_at: Date; updated_at: Date }[]>`SELECT * FROM discovery.user_concept_affinity WHERE user_id = ${userId} AND concept_id = ${conceptId} FOR UPDATE`;
              const affinity = updateBehaviorAffinity(prior ? { conceptId, score: Number(prior.score), confidence: Number(prior.confidence), positiveWeight: Number(prior.positive_weight), negativeWeight: Number(prior.negative_weight), featureVersion: prior.feature_version, lastEventAt: prior.last_event_at, updatedAt: prior.updated_at } : undefined, { positive, negative, confidence: positive + negative, refresh: signal.refresh }, new Date());
              await tx`INSERT INTO discovery.user_concept_affinity (user_id, concept_id, score, confidence, positive_weight, negative_weight, feature_version, last_event_at)
                VALUES (${userId}, ${conceptId}, ${affinity.score}, ${affinity.confidence}, ${affinity.positiveWeight}, ${affinity.negativeWeight}, ${LEARNER_MODEL_VERSION}, now())
                ON CONFLICT (user_id, concept_id) DO UPDATE SET positive_weight = EXCLUDED.positive_weight, negative_weight = EXCLUDED.negative_weight, score = EXCLUDED.score, confidence = EXCLUDED.confidence, feature_version = EXCLUDED.feature_version, last_event_at = now(), updated_at = now()`;
            }
          }
        }
        await tx`INSERT INTO activity.activity_events (schema_version, user_id, event_type, actor_type, source, occurred_at, idempotency_key, causation_id, payload) VALUES (1, ${userId}, 'discovery.profile_projected', 'system', 'worker', now(), ${`recommend-profile:${config.version}:${event.id}`}, ${event.id}, '{}'::jsonb) ON CONFLICT DO NOTHING`;
      }
      const tracked = [...new Set([...coreIds, ...Object.keys(learning.recentInterests), ...Object.keys(learning.longTermInterests)])].slice(0, config.profileTopicLimit);
      const [affinities, topics, mastery, goals, sessions, progress, dismissed, relations, ignoredImpressions, enrollments] = await Promise.all([
        tx`SELECT * FROM discovery.user_concept_affinity WHERE user_id = ${userId} ORDER BY confidence DESC, concept_id LIMIT 100`,
        tx`SELECT id, name, slug, kind, canonical_parent_id FROM knowledge.concepts WHERE id = ANY(${tracked}) AND status = 'active' ORDER BY id`,
        tx`SELECT concept_id, score, uncertainty, evidence_count, next_review_at, updated_at FROM knowledge.concept_mastery WHERE user_id = ${userId} ORDER BY updated_at DESC, concept_id LIMIT 100`,
        tx`SELECT primary_concept_id FROM study.learning_goals WHERE user_id = ${userId} AND status = 'active' ORDER BY id LIMIT 10`,
        tx`SELECT s.active_resource_id, ARRAY(SELECT concept_id FROM catalog.resource_concepts WHERE resource_id = s.active_resource_id AND relevance >= .35 ORDER BY concept_id) concept_ids FROM study.study_sessions s WHERE s.user_id = ${userId} AND s.status IN ('active','paused') ORDER BY s.last_active_at DESC, s.id LIMIT 3`,
        tx`SELECT resource_id, progress_pct, completed_at, updated_at FROM study.user_resource_progress WHERE user_id = ${userId} ORDER BY updated_at DESC, resource_id LIMIT 100`,
        tx`SELECT resource_id FROM catalog.library_items WHERE user_id = ${userId} AND status = 'removed' ORDER BY updated_at DESC, resource_id LIMIT 100`,
        tx`SELECT source_concept_id, target_concept_id, relation_type FROM knowledge.concept_relations WHERE status = 'accepted' AND weight * confidence >= .5 AND (source_concept_id = ANY(${tracked}) OR target_concept_id = ANY(${tracked})) ORDER BY source_concept_id, target_concept_id, relation_type LIMIT 50`,
        tx`SELECT i.resource_id, count(DISTINCT i.recommendation_run_id)::int count FROM discovery.recommendation_impressions i WHERE i.user_id = ${userId} AND i.shown_at > now() - interval '30 days' AND i.shown_at < now() - interval '12 hours' AND NOT EXISTS (SELECT 1 FROM discovery.discovery_interactions a WHERE a.user_id = ${userId} AND a.resource_id = i.resource_id AND a.occurred_at >= i.shown_at) GROUP BY i.resource_id HAVING count(*) > 1 ORDER BY i.resource_id LIMIT 100`,
        tx`SELECT collection_id, current_item_id, status, progress_pct FROM catalog.collection_enrollments WHERE user_id = ${userId} ORDER BY updated_at DESC, collection_id LIMIT 20`,
      ]);
      const context = { mastery, goals, sessions, progress, dismissed, enrollments, relations, ignoredImpressions };
      const previousContext = previous ? Object.fromEntries(Object.keys(context).map((key) => [key, previous.state[key]])) : null;
      const meaningful = !previous || JSON.stringify(previousVector) !== JSON.stringify(learning.onboardingVector) || JSON.stringify(previousContext) !== JSON.stringify(context) || JSON.stringify(previous.state.preferences) !== JSON.stringify(preferences) || totalEvidence - Number(previous.state.publishedEvidence ?? 0) >= config.significantEvidence || events.some((event) => event.event_type === "discovery.dismissed");
      const state = { observedPreferences, totalEvidence, publishedEvidence: meaningful ? totalEvidence : previous?.state.publishedEvidence ?? 0, version: config.version, learning, preferences, onboardingAt: settings.onboarding_completed_at.toISOString(), topics, affinities, mastery, goals, sessions, progress, dismissed, relations, ignoredImpressions, enrollments };
      const [row] = await tx<{ revision: number }[]>`INSERT INTO discovery.learner_profiles (user_id, state) VALUES (${userId}, ${tx.json(state as unknown as postgres.JSONValue)}) ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, revision = discovery.learner_profiles.revision + ${meaningful ? 1 : 0}, updated_at = now() RETURNING revision`;
      return { state, revision: row!.revision, meaningful };
    }).catch((error) => { console.warn(JSON.stringify({ metric: "recommendation_profile_failure", error: error instanceof Error ? error.message : "projection failed" })); return null; });
    if (!result) continue;
    await redisCommands([["SETEX", recommendationProfileKey(userId), String(config.cacheStaleSeconds), JSON.stringify({ userId, ...result })]]);
    if (result.meaningful) await invalidateRecommendations(userId);
    console.info(JSON.stringify({ metric: "profile_update_latency", ms: performance.now() - started, revision: result.revision }));
    projected++;
  }
  return projected;
}

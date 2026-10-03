import type { Transaction } from "@learnspace/db";
import { concepts, learnerProfiles, userSettings } from "@learnspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { recommendationProfileKey, redisCommands } from "@learnspace/shared/recommendation-cache";
import type { CompactLearningState } from "@learnspace/shared/recommendation-model";
import type { LearnerProfile } from "./ranker";
import type { ProfileLoad } from "./service";

const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
const date = (value: unknown): Date | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value) : value instanceof Date ? value : null;

export async function loadCompactProfile(tx: Transaction, userId: string): Promise<{ profileLoad: ProfileLoad; learning: CompactLearningState | null; revision: number }> {
  const cached = await redisCommands([["GET", recommendationProfileKey(userId)]]);
  let snapshot: { userId: string; revision: number; state: Record<string, unknown> } | null = null;
  try { if (typeof cached?.[0] === "string") { const value = JSON.parse(cached[0]); if (value.userId === userId && value.state?.version === config.version) snapshot = value; } } catch {}
  if (!snapshot) {
    const [row] = await tx.select().from(learnerProfiles).where(eq(learnerProfiles.userId, userId)).limit(1);
    if (row?.state.version === config.version) snapshot = { userId, revision: row.revision, state: row.state };
  }
  let state = snapshot?.state;
  if (!state) {
    const [settings] = await tx.select({ preferences: userSettings.learningPreferences, onboardingAt: userSettings.onboardingCompletedAt }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const ids = strings((settings?.preferences as Record<string, unknown> | undefined)?.conceptIds);
    const topics = ids.length ? await tx.select({ id: concepts.id, name: concepts.name, slug: concepts.slug, kind: concepts.kind }).from(concepts).where(inArray(concepts.id, ids)) : [];
    state = { preferences: settings?.preferences ?? {}, onboardingAt: settings?.onboardingAt, topics };
  }
  const preferences = state.preferences as Record<string, unknown> ?? {};
  const coreIds = strings(preferences.conceptIds);
  const learning = state.learning as CompactLearningState | undefined;
  const topics = rows(state.topics).map((row) => ({ id: String(row.id), name: String(row.name), slug: String(row.slug), kind: String(row.kind) }));
  const emergingIds = Object.entries(learning?.recentInterests ?? {}).filter(([id, weight]) => !coreIds.includes(id) && weight >= config.emergingInterestMinimum).map(([id]) => id);
  const sessionRows = rows(state.sessions);
  const relations = rows(state.relations);
  const tracked = [...new Set([...coreIds, ...emergingIds, ...sessionRows.flatMap((row) => strings(row.concept_ids))])];
  const adjacentIds = [...new Set(relations.flatMap((row) => [String(row.source_concept_id), String(row.target_concept_id)]))].filter((id) => !tracked.includes(id));
  const ageDays = learning ? Math.max(0, Date.now() - Date.parse(learning.updatedAt)) / 86400000 : 0;
  const recent = Object.fromEntries(Object.entries(learning?.recentInterests ?? {}).map(([id, weight]) => [id, weight * .5 ** (ageDays / config.recentHalfLifeDays)]));
  const profile: LearnerProfile = {
    conceptIds: coreIds, coreConceptIds: coreIds, emergingConceptIds: emergingIds, adjacentConceptIds: adjacentIds,
    conceptNames: new Map(topics.map((topic) => [topic.id, topic.name])), recentInterests: recent, longTermInterests: Object.fromEntries(Object.entries(learning?.longTermInterests ?? {}).map(([id, weight]) => [id, weight * .5 ** (ageDays / config.longTermHalfLifeDays)])), semanticRanking: true,
    affinities: new Map(rows(state.affinities).map((row) => [String(row.concept_id), { conceptId: String(row.concept_id), score: Number(row.score), confidence: Number(row.confidence), positiveWeight: Number(row.positive_weight), negativeWeight: Number(row.negative_weight), featureVersion: String(row.feature_version), lastEventAt: date(row.last_event_at), updatedAt: date(row.updated_at) }])),
    onboardingAt: date(state.onboardingAt), preferredLanguages: strings(preferences.preferredLanguages),
    persona: typeof preferences.persona === "string" ? preferences.persona : null,
    learningIntents: strings(preferences.learningIntents), preferredFormats: strings(preferences.preferredFormats),
    preferredDuration: typeof preferences.preferredDuration === "string" ? preferences.preferredDuration : null,
    selfReportedLevel: ["beginner", "intermediate", "advanced", "mixed"].includes(String(preferences.selfReportedLevel)) ? preferences.selfReportedLevel as LearnerProfile["selfReportedLevel"] : null,
    ...(learning && learning.evidence > config.profilePreferenceEvidence && state.observedPreferences ? (() => {
      const observed = state.observedPreferences as { durationMs?: number; formats?: Record<string, number> };
      const duration = observed.durationMs ? observed.durationMs / 60000 : null;
      const preferred = Object.entries(observed.formats ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
      return { ...(duration && (!preferences.preferredDuration || preferences.preferredDuration === "no_preference") ? { preferredDuration: duration < 10 ? "under_10_minutes" : duration <= 30 ? "ten_to_thirty_minutes" : "thirty_to_sixty_minutes" } : {}), ...(preferred ? { preferredFormats: [preferred] } : {}) };
    })() : {}),
    goalConceptIds: rows(state.goals).flatMap((row) => row.primary_concept_id ? [String(row.primary_concept_id)] : []),
    sessionConceptIds: sessionRows.flatMap((row) => strings(row.concept_ids)),
    prerequisites: relations.filter((row) => row.relation_type === "prerequisite").map((row) => ({ sourceConceptId: String(row.source_concept_id), targetConceptId: String(row.target_concept_id) })),
    mastery: new Map(rows(state.mastery).map((row) => [String(row.concept_id), { score: Number(row.score), uncertainty: Number(row.uncertainty), evidenceCount: Number(row.evidence_count), nextReviewAt: date(row.next_review_at), updatedAt: date(row.updated_at) ?? new Date(0) }])),
    progress: new Map(rows(state.progress).map((row) => [String(row.resource_id), { progressPct: Number(row.progress_pct ?? 0), completedAt: date(row.completed_at), updatedAt: date(row.updated_at) ?? new Date(0) }])),
    ignoredImpressions: new Map(rows(state.ignoredImpressions).map((row) => [String(row.resource_id), Number(row.count)])),
    explorationSeed: userId,
  };
  return { profileLoad: { profile, interests: topics.filter((topic) => coreIds.includes(topic.id) || emergingIds.includes(topic.id)), emergingConceptIds: emergingIds, adjacentConceptIds: adjacentIds, activeSessionState: [], activeSessionResourceIds: sessionRows.flatMap((row) => row.active_resource_id ? [String(row.active_resource_id)] : []), dismissedResourceIds: rows(state.dismissed).map((row) => String(row.resource_id)) }, learning: learning ?? null, revision: snapshot?.revision ?? 0 };
}

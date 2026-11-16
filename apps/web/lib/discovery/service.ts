import { RECOMMENDATION_CONFIG as recommendationConfig, semanticRecommendationsEnabled } from "@learnspace/shared/recommendation-config";
import { readRecommendationCache, writeRecommendationCache, invalidateRecommendations } from "@learnspace/shared/recommendation-cache";
import { retrievalVector } from "@learnspace/shared/recommendation-model";
import { YOUTUBE_QUALITY_FEATURE_VERSION } from "@learnspace/shared/youtube-quality";
import { loadCompactProfile } from "./compact-profile";
import { retrieveRecommendationCandidates } from "./candidates";
import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  activityEvents,
  concepts,
  conceptRelations,
  conceptMastery,
  learningGoals,
  userResourceProgress,
  discoveryInteractions,
  libraryItems,
  paperDetails,
  recommendationCandidates,
  recommendationImpressions,
  recommendationRuns,
  resourceConcepts,
  resourceQualitySnapshots,
  resources,
  outboxEvents,
  studySessions,
  userConceptAffinity,
  userSettings,
  videoDetails,
} from "@learnspace/db/schema";
import type { DiscoveryAction, DiscoveryHomeResponse, DiscoveryInteractionRequest, DiscoveryImpressionRequest } from "@learnspace/shared";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { getCachedHomeFeed, invalidateHomeFeedCache, setCachedHomeFeed } from "./cache";
import { DISCOVERY_CATALOG_VERSION, discoveryFingerprint } from "./fingerprint";
import {
  DISCOVERY_FEATURE_VERSION,
  DISCOVERY_BEHAVIOR_CONFIG,
  DISCOVERY_EXPLORATION_CONFIG,
  DISCOVERY_REFRESH_CONFIG,
  DISCOVERY_STRATEGY_VERSION,
  rankDiscoveryResources,
  type DiscoveryResource,
  type LearnerProfile,
  type RankedResource,
} from "./ranker";

import { AFFINITY_HALF_LIFE_DAYS, LEARNER_MODEL_VERSION, behaviorSignal, observationFromActivity, observedAffinity, personalizationWeights, updateBehaviorAffinity, type BehaviorSignal } from "./learner-model";

export function adaptiveDiscoveryEnabled(): boolean { return process.env.LEARNSPACE_ADAPTIVE_DISCOVERY_ENABLED !== "false"; }

const durableFeedTtlMs = 6 * 60 * 60 * 1000;
const staleFeedTtlMs = 24 * 60 * 60 * 1000;
const catalogResourceLimit = 800;
const sourceCatalogResourceLimit = 40;

export type ProfileLoad = {
  profile: LearnerProfile;
  interests: Array<{ id: string; slug: string; name: string; kind: string }>;
  emergingConceptIds: string[];
  adjacentConceptIds: string[];
  activeSessionState: Array<{ id: string; resourceId: string | null; lastActiveAt: Date; lockVersion: number; contextVersion: number }>;
  activeSessionResourceIds: string[];
  dismissedResourceIds: string[];
};

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export async function loadDiscoveryProfile(tx: Transaction, userId: string): Promise<ProfileLoad> {
  if (!semanticRecommendationsEnabled()) await projectLearningOutcomes(tx, userId);
  const now = new Date();
  const [settingsRows, affinityRows, interestRows, sessions, dismissedRows, masteryRows, goalRows, progressRows, impressionRows] = await Promise.all([
    tx.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    tx.select().from(userConceptAffinity).where(eq(userConceptAffinity.userId, userId)),
    tx
      .select({ id: concepts.id, slug: concepts.slug, name: concepts.name, kind: concepts.kind })
      .from(concepts)
      .innerJoin(userSettings, sql`${userSettings.learningPreferences}->'conceptIds' ? ${concepts.id}::text`)
      .where(eq(userSettings.userId, userId)),
    tx
      .select({ id: studySessions.id, resourceId: studySessions.activeResourceId, lastActiveAt: studySessions.lastActiveAt, lockVersion: studySessions.lockVersion, contextVersion: studySessions.contextVersion })
      .from(studySessions)
      .where(and(eq(studySessions.userId, userId), inArray(studySessions.status, ["active", "paused"]), gte(studySessions.lastActiveAt, new Date(now.getTime() - 14 * 86_400_000))))
      .orderBy(desc(studySessions.lastActiveAt))
      .limit(3),
    tx
      .select({ resourceId: libraryItems.resourceId })
      .from(libraryItems)
      .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "removed"))),
    tx.select().from(conceptMastery).where(eq(conceptMastery.userId, userId)),
    tx.select().from(learningGoals).where(and(eq(learningGoals.userId, userId), eq(learningGoals.status, "active"))),
    tx.select().from(userResourceProgress).where(eq(userResourceProgress.userId, userId)),
    tx.select({ resourceId: recommendationImpressions.resourceId, count: sql<number>`count(DISTINCT ${recommendationImpressions.recommendationRunId})::int` })
      .from(recommendationImpressions).where(and(eq(recommendationImpressions.userId, userId),
        gte(recommendationImpressions.shownAt, new Date(now.getTime() - 30 * 86_400_000)),
        lt(recommendationImpressions.shownAt, new Date(now.getTime() - 12 * 60 * 60_000)),
        sql`NOT EXISTS (SELECT 1 FROM activity.activity_events reacted WHERE reacted.user_id = ${userId} AND reacted.resource_id = ${recommendationImpressions.resourceId} AND reacted.occurred_at >= ${recommendationImpressions.shownAt} AND reacted.event_type IN ('resource.opened', 'resource.saved', 'resource.consumed'))`,
      )).groupBy(recommendationImpressions.resourceId),
  ]);
  const preferences = settingsRows[0]?.learningPreferences ?? {};
  const conceptIds = stringArray(recordValue(preferences, "conceptIds"));
  const emergingConceptIds = affinityRows
    .filter((affinity) => (
      !conceptIds.includes(affinity.conceptId)
      && affinity.featureVersion !== "onboarding-v1"
      && affinity.featureVersion.includes("behavior")
      && observedAffinity(affinity, now).score >= DISCOVERY_EXPLORATION_CONFIG.emergingThreshold
    ))
    .map((affinity) => affinity.conceptId);
  const sessionConceptRows = sessions.length ? await tx.select({ conceptId: resourceConcepts.conceptId }).from(resourceConcepts)
    .where(and(inArray(resourceConcepts.resourceId, sessions.flatMap((session) => session.resourceId ? [session.resourceId] : [])), gte(resourceConcepts.relevance, .35))) : [];
  const sessionConceptIds = [...new Set(sessionConceptRows.map((row) => row.conceptId))];
  const goalConceptIds = goalRows.flatMap((goal) => goal.primaryConceptId ? [goal.primaryConceptId] : []);
  const dueConceptIds = masteryRows.filter((row) => row.nextReviewAt && row.nextReviewAt <= now).map((row) => row.conceptId);
  const trackedConceptIds = [...new Set([...conceptIds, ...emergingConceptIds, ...sessionConceptIds, ...goalConceptIds, ...dueConceptIds])];
  const relationRows = trackedConceptIds.length === 0
    ? []
    : await tx
      .select({ sourceConceptId: conceptRelations.sourceConceptId, targetConceptId: conceptRelations.targetConceptId, relationType: conceptRelations.relationType })
      .from(conceptRelations)
      .where(and(
        or(
          inArray(conceptRelations.sourceConceptId, trackedConceptIds),
          inArray(conceptRelations.targetConceptId, trackedConceptIds),
        ),
        eq(conceptRelations.status, "accepted"),
        inArray(conceptRelations.relationType, ["related_to", "part_of", "applies_to", "prerequisite"]),
        sql`${conceptRelations.weight} * ${conceptRelations.confidence} >= 0.5`,
      ))
      .limit(50);
  const trackedConceptSet = new Set(trackedConceptIds);
  const relationAdjacentConceptIds = relationRows.map((row) => (
    trackedConceptSet.has(row.sourceConceptId) ? row.targetConceptId : row.sourceConceptId
  )).filter((id) => !trackedConceptSet.has(id));
  const hierarchyRows = trackedConceptIds.length === 0
    ? []
    : await tx
      .select({ id: concepts.id, canonicalParentId: concepts.canonicalParentId })
      .from(concepts)
      .where(and(
        eq(concepts.status, "active"),
        or(
          inArray(concepts.id, trackedConceptIds),
          inArray(concepts.canonicalParentId, trackedConceptIds),
        ),
      ))
      .limit(100);
  const parentIds = [...new Set(hierarchyRows
    .filter((row) => trackedConceptSet.has(row.id) && row.canonicalParentId)
    .map((row) => row.canonicalParentId as string))];
  const parentRows = parentIds.length === 0
    ? []
    : await tx
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(
        eq(concepts.status, "active"),
        or(
          inArray(concepts.id, parentIds),
          inArray(concepts.canonicalParentId, parentIds),
        ),
      ))
      .limit(100);
  const adjacentConceptIds = [...new Set([
    ...relationAdjacentConceptIds,
    ...hierarchyRows.map((row) => row.id),
    ...parentRows.map((row) => row.id),
  ])].filter((id) => !trackedConceptSet.has(id));
  const supplementalConceptIds = [...new Set([...trackedConceptIds, ...adjacentConceptIds])];
  const supplementalRows = supplementalConceptIds.length === 0
    ? []
    : await tx
      .select({ id: concepts.id, name: concepts.name, kind: concepts.kind })
      .from(concepts)
      .where(and(inArray(concepts.id, supplementalConceptIds), eq(concepts.status, "active")));
  const supplementalConceptSet = new Set(supplementalRows.map((concept) => concept.id));
  const activeEmergingConceptIds = emergingConceptIds.filter((conceptId) => supplementalConceptSet.has(conceptId));
  const activeAdjacentConceptIds = adjacentConceptIds.filter((conceptId) => supplementalConceptSet.has(conceptId));
  const conceptNames = new Map([
    ...interestRows.map((concept) => [concept.id, concept.name] as const),
    ...supplementalRows.map((concept) => [concept.id, concept.name] as const),
  ]);
  const level = recordValue(preferences, "selfReportedLevel");
  const profile: LearnerProfile = {
    conceptIds,
    coreConceptIds: conceptIds,
    emergingConceptIds: activeEmergingConceptIds,
    adjacentConceptIds: activeAdjacentConceptIds,
    conceptNames,
    affinities: new Map(affinityRows.map((affinity) => [affinity.conceptId, affinity])),
    onboardingAt: settingsRows[0]?.onboardingCompletedAt ?? null,
    preferredLanguages: stringArray(recordValue(preferences, "preferredLanguages")),
    goalConceptIds, sessionConceptIds,
    prerequisites: relationRows.filter((row) => row.relationType === "prerequisite"),
    mastery: new Map(masteryRows.map((row) => [row.conceptId, row])),
    progress: new Map(progressRows.map((row) => [row.resourceId, { progressPct: row.progressPct ?? 0, completedAt: row.completedAt ?? (row.status === "completed" ? row.updatedAt : null), updatedAt: row.updatedAt }])),
    ignoredImpressions: new Map(impressionRows.map((row) => [row.resourceId, Number(row.count)])),
    explorationSeed: userId,
    persona: typeof recordValue(preferences, "persona") === "string" ? recordValue(preferences, "persona") as string : null,
    learningIntents: stringArray(recordValue(preferences, "learningIntents")),
    preferredFormats: stringArray(recordValue(preferences, "preferredFormats")),
    preferredDuration: typeof recordValue(preferences, "preferredDuration") === "string" ? recordValue(preferences, "preferredDuration") as string : null,
    selfReportedLevel: ["beginner", "intermediate", "advanced", "mixed"].includes(String(level))
      ? level as LearnerProfile["selfReportedLevel"]
      : null,
  };
  return {
    profile,
    interests: interestRows,
    emergingConceptIds: activeEmergingConceptIds,
    adjacentConceptIds: activeAdjacentConceptIds,
    activeSessionState: sessions,
    activeSessionResourceIds: sessions.flatMap((session) => session.resourceId ? [session.resourceId] : []),
    dismissedResourceIds: dismissedRows.map((row) => row.resourceId),
  };
}

async function catalogFingerprint(tx: Transaction): Promise<string> {
  const [resourceSummary, qualitySummary, conceptSummary] = await Promise.all([
    tx
      .select({ count: count(), latestUpdatedAt: max(resources.updatedAt) })
      .from(resources)
      .where(and(
        isNull(resources.ownerUserId),
        or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
        eq(resources.status, "ready"),
        isNull(resources.deletedAt),
        inArray(resources.type, ["video", "paper"]),
      )),
    tx
      .select({ latestCapturedAt: max(resourceQualitySnapshots.capturedAt), latestScore: max(resourceQualitySnapshots.finalQualityScore) })
      .from(resourceQualitySnapshots)
      .innerJoin(resources, eq(resources.id, resourceQualitySnapshots.resourceId))
      .where(and(
        isNull(resources.ownerUserId),
        or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
        eq(resources.status, "ready"),
        isNull(resources.deletedAt),
        inArray(resources.type, ["video", "paper"]),
      )),
    tx
      .select({ count: count(), latestCreatedAt: max(resourceConcepts.createdAt) })
      .from(resourceConcepts)
      .innerJoin(resources, eq(resources.id, resourceConcepts.resourceId))
      .where(and(
        isNull(resources.ownerUserId),
        or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
        eq(resources.status, "ready"),
        isNull(resources.deletedAt),
        inArray(resources.type, ["video", "paper"]),
      )),
  ]);
  return discoveryFingerprint({
    version: DISCOVERY_CATALOG_VERSION,
    resourceCount: resourceSummary[0]?.count ?? 0,
    latestResourceUpdatedAt: resourceSummary[0]?.latestUpdatedAt?.toISOString() ?? null,
    latestQualityCapturedAt: qualitySummary[0]?.latestCapturedAt?.toISOString() ?? null,
    latestQualityScore: qualitySummary[0]?.latestScore ?? null,
    resourceConceptCount: conceptSummary[0]?.count ?? 0,
    latestResourceConceptCreatedAt: conceptSummary[0]?.latestCreatedAt?.toISOString() ?? null,
  });
}

function profileFingerprint(profileLoad: ProfileLoad): string {
  return discoveryFingerprint({
    version: "profile-v5",
    explorationVersion: DISCOVERY_EXPLORATION_CONFIG.version,
    behaviorVersion: DISCOVERY_BEHAVIOR_CONFIG.version,
    refreshVersion: DISCOVERY_REFRESH_CONFIG.version,
    conceptIds: [...profileLoad.profile.conceptIds].sort(),
    emergingConceptIds: [...profileLoad.emergingConceptIds].sort(),
    adjacentConceptIds: [...profileLoad.adjacentConceptIds].sort(),
    persona: profileLoad.profile.persona,
    learningIntents: [...profileLoad.profile.learningIntents].sort(),
    preferredFormats: [...profileLoad.profile.preferredFormats].sort(),
    preferredDuration: profileLoad.profile.preferredDuration,
    selfReportedLevel: profileLoad.profile.selfReportedLevel,
    onboardingAt: profileLoad.profile.onboardingAt?.toISOString() ?? null,
    preferredLanguages: profileLoad.profile.preferredLanguages,
    mastery: [...(profileLoad.profile.mastery ?? new Map())].sort(),
    goals: profileLoad.profile.goalConceptIds,
    sessionConcepts: profileLoad.profile.sessionConceptIds,
    progress: [...(profileLoad.profile.progress ?? new Map())].map(([id, progress]) => [id, Math.floor(progress.progressPct / 25), progress.completedAt?.toISOString() ?? null]).sort(),
    ignoredImpressions: [...(profileLoad.profile.ignoredImpressions ?? new Map())].sort(),
    decayBucket: new Date().toISOString().slice(0, 10),
    affinities: [...profileLoad.profile.affinities.values()]
      .toSorted((left, right) => left.conceptId.localeCompare(right.conceptId))
      .map((affinity) => ({
        conceptId: affinity.conceptId,
        score: affinity.score,
        confidence: affinity.confidence,
        positiveWeight: affinity.positiveWeight,
        negativeWeight: affinity.negativeWeight,
        featureVersion: affinity.featureVersion,
        lastEventAt: affinity.lastEventAt?.toISOString() ?? null,
        updatedAt: affinity.updatedAt?.toISOString() ?? null,
      })),
    activeSessionState: profileLoad.activeSessionState.map((session) => ({
      id: session.id, resourceId: session.resourceId, contextVersion: session.contextVersion,
      lastActiveDay: session.lastActiveAt.toISOString().slice(0, 10),
    })),
    dismissedResourceIds: [...profileLoad.dismissedResourceIds].sort(),
  });
}

export async function loadDiscoveryResources(
  tx: Transaction,
  resourceIds?: string[],
  ownerUserId?: string,
  options: { mode?: "learn" | "research"; query?: string; resolvedConceptId?: string | null; limit?: number; conceptIds?: string[] } = {},
): Promise<DiscoveryResource[]> {
  if (resourceIds && resourceIds.length === 0) return [];
  const publicResource = and(
    isNull(resources.ownerUserId),
    or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
  );
  const visibleResource = ownerUserId
    ? or(publicResource, eq(resources.ownerUserId, ownerUserId))
    : publicResource;
  const resourceWhere = and(
    resourceIds && resourceIds.length > 0 ? inArray(resources.id, resourceIds) : undefined,
    visibleResource,
    eq(resources.status, "ready"),
    isNull(resources.deletedAt),
    inArray(resources.type, ["video", "paper"]),
    options.mode ? eq(resources.type, options.mode === "learn" ? "video" : "paper") : undefined,
    options.conceptIds?.length ? sql`EXISTS (SELECT 1 FROM catalog.resource_concepts personal_concept WHERE personal_concept.resource_id = ${resources.id} AND ${inArray(sql`personal_concept.concept_id`, options.conceptIds)})` : undefined,
    options.query || options.resolvedConceptId ? sql`(
      ${options.query ? sql`${resources.searchTsv} @@ plainto_tsquery('simple', ${options.query}) OR ${resources.title} ILIKE ${`%${options.query}%`}` : sql`FALSE`}
      ${options.resolvedConceptId ? sql`OR EXISTS (
        SELECT 1 FROM catalog.resource_concepts source_query_concept
        WHERE source_query_concept.resource_id = ${resources.id}
          AND source_query_concept.concept_id = ${options.resolvedConceptId}
      )` : sql``}
    )` : undefined,
  );
  const resourceTypes = ["video", "paper"] as const;
  const queryResources = (type?: (typeof resourceTypes)[number]) => tx
    .select({ resource: resources, video: videoDetails, paper: paperDetails })
    .from(resources)
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .where(and(resourceWhere, type ? eq(resources.type, type) : undefined))
    .orderBy(desc(resources.qualityScore), desc(resources.updatedAt))
    .limit(resourceIds ? resourceIds.length : options.limit ?? (options.query || options.resolvedConceptId ? sourceCatalogResourceLimit : catalogResourceLimit));
  const rows = resourceIds
    ? await queryResources()
    : (await Promise.all(resourceTypes.map((type) => queryResources(type)))).flat();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.resource.id);
  const [conceptRows, qualityRows] = await Promise.all([
    tx
      .select({ resourceId: resourceConcepts.resourceId, conceptId: concepts.id, name: concepts.name, relevance: resourceConcepts.relevance, isPrimary: resourceConcepts.isPrimary })
      .from(resourceConcepts)
      .innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId))
      .where(inArray(resourceConcepts.resourceId, ids)),
    tx
      .select({ resourceId: resourceQualitySnapshots.resourceId, finalQualityScore: resourceQualitySnapshots.finalQualityScore, freshnessPrior: resourceQualitySnapshots.freshnessPrior, sourceAuthority: resourceQualitySnapshots.sourceAuthority, completionRate: resourceQualitySnapshots.completionRate, retentionRate: resourceQualitySnapshots.retentionRate, capturedAt: resourceQualitySnapshots.capturedAt })
      .from(resourceQualitySnapshots)
      .where(and(inArray(resourceQualitySnapshots.resourceId, ids), eq(resourceQualitySnapshots.featureVersion, YOUTUBE_QUALITY_FEATURE_VERSION)))
      .orderBy(desc(resourceQualitySnapshots.capturedAt)),
  ]);
  const conceptsByResource = new Map<string, Array<{ id: string; name: string; relevance: number }>>();
  for (const row of conceptRows) {
    const conceptsForResource = conceptsByResource.get(row.resourceId) ?? [];
    conceptsForResource.push({ id: row.conceptId, name: row.name, relevance: row.relevance });
    conceptsByResource.set(row.resourceId, conceptsForResource);
  }
  const qualityByResource = new Map<string, typeof qualityRows[number]>();
  for (const row of qualityRows) if (!qualityByResource.has(row.resourceId)) qualityByResource.set(row.resourceId, row);
  return rows.flatMap(({ resource, video, paper }) => {
    if (resource.type !== "video" && resource.type !== "paper") return [];
    const metadata = resource.metadata ?? {};
    const youtubeId = video?.youtubeId ?? resource.externalId;
    const qualityRow = qualityByResource.get(resource.id);
    return [{
      id: resource.id,
      type: resource.type,
      provider: resource.provider,
      externalId: resource.externalId,
      canonicalUrl: resource.canonicalUrl,
      title: resource.title,
      description: resource.description,
      language: resource.language,
      qualityScore: resource.qualityScore,
      thumbnailUrl: typeof recordValue(metadata, "thumbnailUrl") === "string"
        ? recordValue(metadata, "thumbnailUrl") as string
        : youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null,
      channelTitle: video?.channelTitle ?? null,
      authors: resource.type === "paper"
        ? stringArray(recordValue(paper?.metadata, "authors") ?? recordValue(metadata, "authors"))
        : [],
      durationMs: video?.durationMs ?? null,
      publishedAt: video?.publishedAt ?? asDate(paper?.submittedAt),
      paperAbstract: paper?.abstract ?? null,
      venue: paper?.venue ?? (paper ? "arXiv" : null),
      publicationDate: asDate(paper?.publicationDate),
      citationCount: paper?.citationCount ?? null,
      metadata,
      concepts: conceptsByResource.get(resource.id) ?? [],
      quality: qualityRow ? {
        finalQualityScore: qualityRow.finalQualityScore,
        freshnessPrior: qualityRow.freshnessPrior,
        sourceAuthority: qualityRow.sourceAuthority,
        completionRate: qualityRow.completionRate,
        retentionRate: qualityRow.retentionRate,
      } : null,
    } satisfies DiscoveryResource];
  });
}

export async function rankPaperResourcesForUser(tx: Transaction, userId: string, resourceIds: string[]): Promise<string[]> {
  if (resourceIds.length === 0) return [];
  const profileLoad = await loadDiscoveryProfile(tx, userId);
  const dismissed = new Set(profileLoad.dismissedResourceIds);
  const interests = new Set(profileLoad.profile.coreConceptIds ?? profileLoad.profile.conceptIds);
  const resources = await loadDiscoveryResources(tx, resourceIds, userId);
  return rankDiscoveryResources(resources.filter((resource) => paperMatchesResearchInterests(resource, interests)), profileLoad.profile, new Date()).papers
    .filter((candidate) => candidate.finalRank !== null && !dismissed.has(candidate.resource.id))
    .map((candidate) => candidate.resource.id);
}

/** Research feeds with selected topics only rank papers tagged to those topics. */
export function paperMatchesResearchInterests(resource: DiscoveryResource, interests: ReadonlySet<string>): boolean {
  return interests.size === 0 || resource.concepts.some((concept) => interests.has(concept.id));
}

export function reasonText(candidate: RankedResource, profile: LearnerProfile): string {
  if (candidate.reasonCodes.includes("playlist_continuation")) return "Continue with the next lesson in your collection";
  if (candidate.reasonCodes.includes("next_level")) return "Go a little deeper after the foundations";
  if (candidate.reasonCodes.includes("review_due")) return "Worth revisiting now";
  if (candidate.reasonCodes.includes("continue_learning")) return "Continue your lesson";
  if (candidate.reasonCodes.includes("prerequisite_gap")) return "A useful foundation for your next lesson";
  if (candidate.reasonCodes.includes("recent_learning")) {
    const concept = candidate.resource.concepts.find((concept) => observedAffinity(profile.affinities.get(concept.id), new Date()).score > .05);
    if (concept) return `A next step in your ${concept.name} learning`;
  }
  if (candidate.reasonCodes.includes("session_context")) return "Related to your recent sessions";
  if (candidate.reasonCodes.includes("active_goal")) return "A next step toward your learning goal";
  if (candidate.reasonCodes.includes("adjacent_concept")) return "Related to what you're learning";
  const core = candidate.resource.concepts.find((concept) => (profile.coreConceptIds ?? profile.conceptIds).includes(concept.id));
  if (core && candidate.reasonCodes.includes("concept_match")) return `Build on your interest in ${core.name}`;
  if (candidate.reasonCodes.includes("semantic_match")) return "Connects with the ideas you've been studying";
  if (candidate.reasonCodes.includes("format_fit")) return "Matches how you like to learn";
  if (candidate.reasonCodes.includes("level_fit")) return "Fits your learning level";
  return "A useful place to explore";
}

function toCard(candidate: RankedResource, profile: LearnerProfile, runId: string, position: number): DiscoveryHomeResponse["sections"]["recommendedVideos"][number] {
  return {
    resourceId: candidate.resource.id,
    type: candidate.resource.type,
    title: candidate.resource.title,
    description: candidate.resource.type === "paper" ? candidate.resource.paperAbstract : candidate.resource.description,
    url: candidate.resource.canonicalUrl,
    thumbnailUrl: candidate.resource.type === "video" ? candidate.resource.thumbnailUrl : null,
    author: candidate.resource.channelTitle ?? candidate.resource.venue,
    durationMs: candidate.resource.durationMs,
    publishedAt: (candidate.resource.publishedAt ?? candidate.resource.publicationDate)?.toISOString() ?? null,
    reason: reasonText(candidate, profile),
    reasonCodes: candidate.reasonCodes,
    position,
    runId,
  };
}

function responseFromRanked(
  runId: string,
  generatedAt: Date,
  profileLoad: ProfileLoad,
  ranked: { videos: RankedResource[] },
  activeSessionResources: DiscoveryResource[],
  stale: boolean,
  limit = 6,
): DiscoveryHomeResponse {
  const dismissed = new Set(profileLoad.dismissedResourceIds);
  const selectedVideos = ranked.videos
    .filter((candidate) => candidate.finalRank !== null && !dismissed.has(candidate.resource.id))
    .toSorted((left, right) => (left.finalRank ?? 999) - (right.finalRank ?? 999));
  const recommendedVideos = selectedVideos.slice(0, limit);
  const activeResourceById = new Map(activeSessionResources.map((resource) => [resource.id, resource]));
  const active = profileLoad.activeSessionResourceIds.flatMap((resourceId, index) => {
    const resource = activeResourceById.get(resourceId);
    if (!resource || dismissed.has(resourceId)) return [];
    return [{
      resource,
      candidateRank: index + 1,
      finalRank: index + 1,
      score: 1,
      semanticRelevance: 1,
      qualityScore: 1,
      learnerAffinity: 1,
      masteryFit: null,
      coverageScore: 1,
      freshnessScore: 1,
      diversityPenalty: 0,
      reasonCodes: ["continue_learning"],
    } satisfies RankedResource];
  }).slice(0, 3);
  return {
    runId,
    generatedAt: generatedAt.toISOString(),
    stale,
    personalization: personalizationWeights(profileLoad.profile.affinities.values(), profileLoad.profile.onboardingAt, generatedAt).behavior >= .5 ? "learning" : profileLoad.interests.length ? "interests" : "explore",
    sections: {
      continueLearning: active.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      recommendedVideos: recommendedVideos.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, (candidate.finalRank ?? index + 1) - 1)),
      interests: profileLoad.interests,
    },
  };
}

function strategyVersion(profile: LearnerProfile): string {
  return profile.semanticRanking ? recommendationConfig.version : DISCOVERY_STRATEGY_VERSION;
}

async function findReusableRun(
  tx: Transaction,
  userId: string,
  now: Date,
  surface: "home" | "discover",
  fingerprints: { profileFingerprint: string; catalogFingerprint: string },
  profile: LearnerProfile,
): Promise<typeof recommendationRuns.$inferSelect | null> {
  const minimumDate = new Date(now.getTime() - staleFeedTtlMs);
  const rows = await tx
    .select()
    .from(recommendationRuns)
    .where(and(
      eq(recommendationRuns.userId, userId),
      eq(recommendationRuns.surface, surface),
      eq(recommendationRuns.status, "completed"),
      gte(recommendationRuns.createdAt, minimumDate),
      eq(recommendationRuns.strategyVersion, strategyVersion(profile)),
      eq(recommendationRuns.featureVersion, DISCOVERY_FEATURE_VERSION),
      sql`${recommendationRuns.contextSnapshot}->>'profileFingerprint' = ${fingerprints.profileFingerprint}`,
      sql`${recommendationRuns.contextSnapshot}->>'catalogFingerprint' = ${fingerprints.catalogFingerprint}`,
    ))
    .orderBy(desc(recommendationRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function loadRankedRun(tx: Transaction, run: typeof recommendationRuns.$inferSelect): Promise<{ videos: RankedResource[]; papers: RankedResource[] }> {
  const rows = await tx
    .select({ candidate: recommendationCandidates, resource: resources })
    .from(recommendationCandidates)
    .innerJoin(resources, eq(resources.id, recommendationCandidates.resourceId))
    .where(eq(recommendationCandidates.recommendationRunId, run.id));
  const resourcesForRun = await loadDiscoveryResources(tx, rows.map((row) => row.resource.id));
  const byId = new Map(resourcesForRun.map((resource) => [resource.id, resource]));
  const ranked = rows.flatMap(({ candidate }) => {
    const resource = byId.get(candidate.resourceId);
    return resource ? [{
      resource,
      candidateRank: candidate.candidateRank,
      finalRank: candidate.finalRank,
      score: candidate.score,
      semanticRelevance: candidate.semanticRelevance ?? 0,
      qualityScore: candidate.qualityScore ?? 0.5,
      learnerAffinity: candidate.learnerAffinity ?? 0,
      masteryFit: candidate.masteryFit,
      coverageScore: candidate.coverageScore ?? 0,
      freshnessScore: candidate.freshnessScore ?? 0.5,
      diversityPenalty: candidate.diversityPenalty ?? 0,
      reasonCodes: Array.isArray(candidate.reasonCodes) ? candidate.reasonCodes.filter((code): code is string => typeof code === "string") : [],
    } satisfies RankedResource] : [];
  });
  return {
    videos: ranked.filter((candidate) => candidate.resource.type === "video").sort((left, right) => (left.finalRank ?? 999) - (right.finalRank ?? 999)),
    papers: ranked.filter((candidate) => candidate.resource.type === "paper").sort((left, right) => (left.finalRank ?? 999) - (right.finalRank ?? 999)),
  };
}

async function generateRun(
  tx: Transaction,
  userId: string,
  profileLoad: ProfileLoad,
  now: Date,
  resourcesForRanker: DiscoveryResource[],
  surface: "home" | "discover",
  fingerprints: { profileFingerprint: string; catalogFingerprint: string },
): Promise<{ run: typeof recommendationRuns.$inferSelect; ranked: { videos: RankedResource[]; papers: RankedResource[] }; rankingMs: number }> {
  const started = performance.now();
  const initialRanked = rankDiscoveryResources(resourcesForRanker, profileLoad.profile, now, surface === "discover" ? recommendationConfig.resultCount : 6);
  const rankingMs = performance.now() - started;
  console.info(JSON.stringify({ metric: "ranking_latency", ms: rankingMs, candidateCount: resourcesForRanker.length }));
  const ranked = {
    videos: initialRanked.videos,
    papers: initialRanked.papers.map((candidate) => ({
      ...candidate,
      candidateRank: candidate.candidateRank + initialRanked.videos.length,
      finalRank: candidate.finalRank === null
        ? null
        : candidate.finalRank + initialRanked.videos.filter((video) => video.finalRank !== null).length,
    })),
  };
  const [run] = await tx.insert(recommendationRuns).values({
    userId,
    surface,
    strategyVersion: strategyVersion(profileLoad.profile),
    featureVersion: DISCOVERY_FEATURE_VERSION,
    contextSnapshot: {
      conceptIds: profileLoad.profile.conceptIds,
      persona: profileLoad.profile.persona,
      learningIntents: profileLoad.profile.learningIntents,
      preferredFormats: profileLoad.profile.preferredFormats,
      preferredDuration: profileLoad.profile.preferredDuration,
      selfReportedLevel: profileLoad.profile.selfReportedLevel,
      adjacentConceptIds: profileLoad.adjacentConceptIds,
      emergingConceptIds: profileLoad.emergingConceptIds,
      profileFingerprint: fingerprints.profileFingerprint,
      catalogFingerprint: fingerprints.catalogFingerprint,
      catalogVersion: DISCOVERY_CATALOG_VERSION,
      learnerModelVersion: LEARNER_MODEL_VERSION,
      recommendationConfigVersion: recommendationConfig.version,
      semanticRanking: profileLoad.profile.semanticRanking === true,
      recentInterests: profileLoad.profile.recentInterests,
      longTermInterests: profileLoad.profile.longTermInterests,
      personalization: personalizationWeights(profileLoad.profile.affinities.values(), profileLoad.profile.onboardingAt, now),
      preferredLanguages: profileLoad.profile.preferredLanguages,
      mastery: [...(profileLoad.profile.mastery ?? new Map())],
      goalConceptIds: profileLoad.profile.goalConceptIds,
      sessionConceptIds: profileLoad.profile.sessionConceptIds,
      featureSnapshots: Object.fromEntries([...ranked.videos, ...ranked.papers].map((candidate) => [candidate.resource.id, candidate.features ?? {}])),
    },
    status: "completed",
    latencyMs: Math.round(performance.now() - started),
    completedAt: now,
  }).returning();
  if (!run) throw new Error("Recommendation run could not be created");
  const candidates = [...ranked.videos, ...ranked.papers];
  if (candidates.length > 0) {
    await tx.insert(recommendationCandidates).values(candidates.map((candidate) => ({
      recommendationRunId: run.id,
      resourceId: candidate.resource.id,
      candidateRank: candidate.candidateRank,
      finalRank: candidate.finalRank,
      score: candidate.score,
      semanticRelevance: candidate.semanticRelevance,
      qualityScore: candidate.qualityScore,
      learnerAffinity: candidate.learnerAffinity,
      masteryFit: candidate.masteryFit,
      coverageScore: candidate.coverageScore,
      freshnessScore: candidate.freshnessScore,
      diversityPenalty: candidate.diversityPenalty,
      reasonCodes: candidate.reasonCodes,
      selected: candidate.finalRank !== null,
    })));
  }
  return { run, ranked, rankingMs };
}

async function getLegacyFeed(userId: string, surface: "home" | "discover" = "home", topicId: string | null = null): Promise<DiscoveryHomeResponse> {
  const result = await withUserTransaction(userId, async (tx) => {
    const now = new Date();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-feed:${userId}:${surface}`}, 0))`);
    const profileLoad = await loadDiscoveryProfile(tx, userId);
    const focusedIds = await focusProfile(tx, profileLoad, topicId);
    const fingerprints = {
      profileFingerprint: discoveryFingerprint({ profile: profileFingerprint(profileLoad), topicId, version: recommendationConfig.version }),
      catalogFingerprint: await catalogFingerprint(tx),
    };
    const cached = surface === "home" ? await getCachedHomeFeed(userId, fingerprints) : null;
    if (cached) return { response: cached, fingerprints: null };
    const reusableRun = await findReusableRun(tx, userId, now, surface, fingerprints, profileLoad.profile);
    const activeSessionResources = await loadDiscoveryResources(tx, profileLoad.activeSessionResourceIds, userId);
    if (reusableRun) {
      const ranked = await loadRankedRun(tx, reusableRun);
      return {
        response: responseFromRanked(reusableRun.id, reusableRun.createdAt, profileLoad, ranked, activeSessionResources, now.getTime() - reusableRun.createdAt.getTime() > durableFeedTtlMs, surface === "discover" ? recommendationConfig.resultCount : 6),
        fingerprints,
      };
    }
    const tracked = [...new Set([...profileLoad.profile.conceptIds, ...profileLoad.emergingConceptIds, ...profileLoad.adjacentConceptIds, ...(profileLoad.profile.goalConceptIds ?? []), ...(profileLoad.profile.sessionConceptIds ?? []), ...[...(profileLoad.profile.mastery ?? new Map())].filter(([, state]) => state.nextReviewAt && state.nextReviewAt <= now).map(([id]) => id)])];
    const pools = await Promise.all([
      loadDiscoveryResources(tx, undefined, undefined, { limit: 200 }),
      tracked.length ? loadDiscoveryResources(tx, undefined, undefined, { conceptIds: tracked, limit: 600 }) : Promise.resolve([]),
      loadDiscoveryResources(tx, [...(profileLoad.profile.progress ?? new Map())].filter(([, progress]) => !progress.completedAt && progress.progressPct > 5).map(([id]) => id).slice(0, 100), userId),
    ]);
    const resourcesForRanker = [...new Map([...pools.flat(), ...activeSessionResources].map((resource) => [resource.id, resource])).values()].filter((resource) => !profileLoad.dismissedResourceIds.includes(resource.id) && (!topicId || resource.concepts.some((concept) => focusedIds.includes(concept.id) && concept.relevance >= recommendationConfig.minimumTopicRelevance)));
    const { run, ranked } = await generateRun(tx, userId, profileLoad, now, resourcesForRanker, surface, fingerprints);
    return {
      response: responseFromRanked(run.id, now, profileLoad, ranked, activeSessionResources, false, surface === "discover" ? recommendationConfig.resultCount : 6),
      fingerprints,
    };
  });
  if (surface === "home" && result.fingerprints) await setCachedHomeFeed(userId, result.fingerprints, result.response);
  return result.response;
}


export type RecommendationTiming = Record<string, number | boolean>;
export type RecommendationFeedOptions = { topicId?: string | null; forceRefresh?: boolean; scheduleRefresh?: (work: () => Promise<void>) => void; onTiming?: (timing: RecommendationTiming) => void };

async function focusProfile(tx: Transaction, profileLoad: ProfileLoad, topicId: string | null): Promise<string[]> {
  if (!topicId) return [];
  if (!profileLoad.interests.some((topic) => topic.id === topicId)) throw new AuthError("INVALID_RECOMMENDATION_TOPIC", "Choose one of your learning interests.", 422);
  const result = await tx.execute(sql`WITH RECURSIVE topics AS (SELECT id, 0 depth FROM knowledge.concepts WHERE id = ${topicId} UNION ALL SELECT c.id, t.depth + 1 FROM knowledge.concepts c JOIN topics t ON c.canonical_parent_id = t.id WHERE t.depth < 2 AND c.status = 'active') SELECT id FROM topics LIMIT 100`);
  const ids = Array.from(result).map((row) => String(row.id));
  profileLoad.profile = { ...profileLoad.profile, conceptIds: ids, coreConceptIds: ids, adjacentConceptIds: [], emergingConceptIds: profileLoad.emergingConceptIds.filter((id) => ids.includes(id)) };
  return ids;
}

const feedRequests = new Map<string, Promise<DiscoveryHomeResponse>>();
export async function getHomeFeed(userId: string, surface: "home" | "discover" = "home", options: RecommendationFeedOptions = {}): Promise<DiscoveryHomeResponse> {
  if (surface !== "discover" || !semanticRecommendationsEnabled()) return getLegacyFeed(userId, surface, options.topicId ?? null);
  const started = performance.now();
  const topicId = options.topicId ?? null;
  const cache = await readRecommendationCache<DiscoveryHomeResponse>(userId, topicId);
  const timing: RecommendationTiming = { redis: performance.now() - started, cacheHit: Boolean(cache.entry) && !options.forceRefresh, fallback: false };
  if (cache.entry && !options.forceRefresh) {
    const stale = cache.entry.freshUntil < Date.now();
    if (stale && options.scheduleRefresh) options.scheduleRefresh(async () => { await getHomeFeed(userId, surface, { topicId, forceRefresh: true }); });
    timing.total = performance.now() - started;
    options.onTiming?.(timing);
    console.info(JSON.stringify({ metric: "recommendation_request_latency", ...timing }));
    return { ...cache.entry.value, stale };
  }
  const key = `${userId}:${topicId ?? "all"}`;
  let pending = feedRequests.get(key);
  if (!pending) {
    pending = withUserTransaction(userId, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discovery-feed:${userId}:discover:${topicId ?? "all"}`}, 0))`);
      if (options.forceRefresh && cache.entry && cache.entry.freshUntil < Date.now()) {
        const refreshed = await readRecommendationCache<DiscoveryHomeResponse>(userId, topicId);
        if (refreshed.entry && refreshed.entry.freshUntil > Date.now()) return refreshed.entry.value;
      }
      const profileStart = performance.now();
      const { profileLoad, learning, revision } = await loadCompactProfile(tx, userId);
      const focusedIds = await focusProfile(tx, profileLoad, topicId);
      timing.profile = performance.now() - profileStart;
      const fingerprints = {
        profileFingerprint: discoveryFingerprint({ revision, preferences: profileLoad.profile.conceptIds, topicId, generation: cache.generation, version: recommendationConfig.version, decayDay: new Date().toISOString().slice(0, 10) }),
        // Read from the database, not the Redis generation, so newly discovered videos re-rank the feed with or without Redis.
        catalogFingerprint: discoveryFingerprint({ catalog: await catalogFingerprint(tx), version: recommendationConfig.version }),
      };
      const reusable = options.forceRefresh ? null : await findReusableRun(tx, userId, new Date(), "discover", fingerprints, profileLoad.profile);
      if (reusable) return responseFromRanked(reusable.id, reusable.createdAt, profileLoad, await loadRankedRun(tx, reusable), [], false, recommendationConfig.resultCount);
      const candidateStart = performance.now();
      const interestIds = focusedIds.length ? focusedIds : [...new Set([...profileLoad.profile.conceptIds, ...profileLoad.emergingConceptIds, ...profileLoad.adjacentConceptIds, ...(profileLoad.profile.goalConceptIds ?? []), ...(profileLoad.profile.sessionConceptIds ?? [])])];
      const candidates = await retrieveRecommendationCandidates(tx, userId, learning ? retrievalVector(learning) : null, interestIds, Boolean(topicId));
      timing.ann = candidates.annMs; timing.retrieval = performance.now() - candidateStart; timing.fallback = candidates.fallback;
      const candidateResources = await loadDiscoveryResources(tx, candidates.ids, userId);
      const completedIntro = await tx.execute(sql`SELECT DISTINCT rc.concept_id FROM study.user_resource_progress p JOIN catalog.resources r ON r.id = p.resource_id JOIN catalog.resource_concepts rc ON rc.resource_id = r.id WHERE p.user_id = ${userId} AND p.completed_at IS NOT NULL AND r.metadata->>'estimatedLevel' = 'beginner' AND rc.relevance >= .7 LIMIT 50`);
      profileLoad.profile.completedIntroConceptIds = Array.from(completedIntro).map((row) => String(row.concept_id));
      const uniqueResources = [...new Map(candidateResources.map((resource) => [resource.canonicalUrl ?? resource.id, resource])).values()];
      for (const resource of uniqueResources) {
        const similarity = candidates.similarities.get(resource.id);
        if (similarity !== undefined) resource.semanticSimilarity = similarity;
        resource.playlistContinuation = candidates.continuationIds.includes(resource.id);
      }
      const rankStart = performance.now();
      const { run, ranked, rankingMs } = await generateRun(tx, userId, profileLoad, new Date(), uniqueResources, "discover", fingerprints);
      timing.ranking = rankingMs; timing.persistence = performance.now() - rankStart - rankingMs; timing.candidates = uniqueResources.length;
      return responseFromRanked(run.id, run.createdAt, profileLoad, ranked, [], false, recommendationConfig.resultCount);
    }).then(async (response) => {
      await writeRecommendationCache({ userId, topicId, generation: cache.generation, catalogGeneration: cache.catalogGeneration, freshUntil: Date.now() + recommendationConfig.cacheFreshSeconds * 1000, value: response });
      return response;
    }).finally(() => feedRequests.delete(key));
    feedRequests.set(key, pending);
  }
  const response = await pending;
  timing.returned = response.sections.recommendedVideos.length; timing.total = performance.now() - started;
  options.onTiming?.(timing);
  console.info(JSON.stringify({ metric: "recommendation_request_latency", ...timing }));
  return response;
}

async function requireRecommendationContext(tx: Transaction, userId: string, runId: string, resourceId: string) {
  const [row] = await tx.select({ run: recommendationRuns, candidate: recommendationCandidates }).from(recommendationRuns)
    .innerJoin(recommendationCandidates, eq(recommendationCandidates.recommendationRunId, recommendationRuns.id))
    .where(and(eq(recommendationRuns.id, runId), eq(recommendationRuns.userId, userId), eq(recommendationCandidates.resourceId, resourceId), eq(recommendationRuns.status, "completed"))).limit(1);
  if (!row) throw new AuthError("INVALID_RECOMMENDATION_CONTEXT", "That recommendation is not available.", 422);
  return row;
}

export async function recordImpression(userId: string, input: DiscoveryImpressionRequest): Promise<{ id: string | null }> {
  return withUserTransaction(userId, async (tx) => {
    const { run, candidate } = await requireRecommendationContext(tx, userId, input.runId, input.resourceId);
    if (run.surface !== input.surface || candidate.finalRank !== input.position + 1) throw new AuthError("INVALID_RECOMMENDATION_POSITION", "That recommendation position is not available.", 422);
    const values = {
      recommendationRunId: input.runId,
      userId,
      resourceId: input.resourceId,
      position: input.position,
      surface: input.surface,
      ...(input.visibleDurationMs === undefined ? {} : { visibleDurationMs: input.visibleDurationMs }),
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    };
    const [row] = await tx.insert(recommendationImpressions).values(values).onConflictDoNothing().returning({ id: recommendationImpressions.id });
    if (row) return { id: row.id };
    const [existing] = await tx.select({ id: recommendationImpressions.id }).from(recommendationImpressions).where(and(eq(recommendationImpressions.recommendationRunId, input.runId), eq(recommendationImpressions.resourceId, input.resourceId), eq(recommendationImpressions.position, input.position))).limit(1);
    return { id: existing?.id ?? null };
  });
}

const activityEventByAction: Record<DiscoveryAction, string> = {
  open: "resource.opened",
  save: "resource.saved",
  dismiss: "discovery.dismissed",
  start_session: "session.started",
  complete: "resource.completed",
};

async function loadResourceConcepts(
  tx: Transaction,
  resourceId: string,
): Promise<Array<{ id: string; name: string; relevance: number; isPrimary: boolean }>> {
  return tx
    .select({
      id: concepts.id,
      name: concepts.name,
      relevance: resourceConcepts.relevance,
      isPrimary: resourceConcepts.isPrimary,
    })
    .from(resourceConcepts)
    .innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId))
    .where(eq(resourceConcepts.resourceId, resourceId));
}

function behaviorRelevanceMultiplier(concept: { relevance: number; isPrimary: boolean }): number {
  const relevance = Math.min(1, Math.max(0, concept.relevance));
  if (concept.isPrimary || relevance >= DISCOVERY_BEHAVIOR_CONFIG.fullRelevance) return 1;
  if (relevance >= DISCOVERY_BEHAVIOR_CONFIG.strongRelevance) {
    return DISCOVERY_BEHAVIOR_CONFIG.secondaryMultiplier;
  }
  return relevance >= DISCOVERY_BEHAVIOR_CONFIG.minimumRelevance ? 0.1 : 0;
}

async function projectBehaviorAffinity(
  tx: Transaction,
  userId: string,
  conceptsForResource: Array<{ id: string; relevance: number; isPrimary: boolean }>,
  signal: BehaviorSignal,
  now: Date,
): Promise<string[]> {
  const weightedConcepts = [...new Map(conceptsForResource.map((concept) => [concept.id, concept])).values()]
    .map((concept) => ({ ...concept, multiplier: behaviorRelevanceMultiplier(concept) }))
    .filter((concept) => concept.multiplier > 0);
  const uniqueConceptIds = weightedConcepts.map((concept) => concept.id);
  const relationRows = uniqueConceptIds.length === 0
    ? []
    : await tx
      .select({
        sourceConceptId: conceptRelations.sourceConceptId,
        targetConceptId: conceptRelations.targetConceptId,
        relationStrength: sql`${conceptRelations.weight} * ${conceptRelations.confidence}`,
      })
      .from(conceptRelations)
      .where(and(
        or(
          inArray(conceptRelations.sourceConceptId, uniqueConceptIds),
          inArray(conceptRelations.targetConceptId, uniqueConceptIds),
        ),
        eq(conceptRelations.status, "accepted"),
        inArray(conceptRelations.relationType, ["related_to", "part_of", "applies_to", "prerequisite"]),
        sql`${conceptRelations.weight} * ${conceptRelations.confidence} >= ${DISCOVERY_BEHAVIOR_CONFIG.adjacentSourceRelevance}`,
      ));
  const core = new Map(weightedConcepts.map((concept) => [concept.id, concept.multiplier]));
  const targets = [
    ...weightedConcepts.map((concept) => ({ conceptId: concept.id, multiplier: concept.multiplier })),
    ...(signal.negative > 0 ? [] : [...new Map(relationRows.map((row) => {
      const sourceMultiplier = core.get(row.sourceConceptId);
      const reverseMultiplier = core.get(row.targetConceptId);
      const sourceConceptId = sourceMultiplier ? row.sourceConceptId : row.targetConceptId;
      const multiplier = sourceMultiplier ?? reverseMultiplier;
      return [row.targetConceptId === sourceConceptId ? row.sourceConceptId : row.targetConceptId, {
        conceptId: row.targetConceptId === sourceConceptId ? row.sourceConceptId : row.targetConceptId,
        multiplier: (multiplier ?? 0) * DISCOVERY_BEHAVIOR_CONFIG.adjacentBehaviorMultiplier,
        relationStrength: Number(row.relationStrength),
      }];
    })).values()].filter((target) => (
      !core.has(target.conceptId)
      && target.relationStrength >= DISCOVERY_BEHAVIOR_CONFIG.adjacentSourceRelevance
    ))),
  ];
  for (const target of targets) {
    const weightedSignal = { ...signal, positive: signal.positive * target.multiplier, negative: signal.negative * target.multiplier };
    const direct = core.has(target.conceptId);
    const version = direct ? LEARNER_MODEL_VERSION : "discovery-adjacent-v2";
    const initial = { ...updateBehaviorAffinity(undefined, weightedSignal, now), featureVersion: version };
    const decay = sql`CASE WHEN ${userConceptAffinity.featureVersion} LIKE ${direct ? "%behavior%" : "%adjacent%"} THEN exp(-greatest(0, extract(epoch FROM (${now.toISOString()}::timestamptz - COALESCE(${userConceptAffinity.lastEventAt}, ${userConceptAffinity.updatedAt})))) * ${Math.LN2 / (AFFINITY_HALF_LIFE_DAYS * 86_400)}) ELSE 0 END`;
    const positive = sql`(${userConceptAffinity.positiveWeight} * ${decay} + ${weightedSignal.positive})`;
    const negative = sql`(${userConceptAffinity.negativeWeight} * ${decay} + ${weightedSignal.negative})`;
    await tx.insert(userConceptAffinity).values({ userId, conceptId: target.conceptId, ...initial })
      .onConflictDoUpdate({
        target: [userConceptAffinity.userId, userConceptAffinity.conceptId],
        set: {
          score: sql`(${positive} - ${negative}) / (1 + ${positive} + ${negative})`,
          confidence: sql`0.95 * (1 - exp(-(${positive} + ${negative}) / 1.5))`,
          positiveWeight: positive, negativeWeight: negative,
          featureVersion: version, lastEventAt: now, updatedAt: now,
        },
        ...(direct ? {} : { setWhere: sql`${userConceptAffinity.featureVersion} NOT LIKE '%behavior%'` }),
      });
  }
  return [...new Set(targets.map((target) => target.conceptId))];
}

async function loadConceptsByIds(
  tx: Transaction,
  conceptIds: string[],
): Promise<Array<{ id: string; name: string }>> {
  const uniqueConceptIds = [...new Set(conceptIds)];
  if (uniqueConceptIds.length === 0) return [];
  return tx
    .select({ id: concepts.id, name: concepts.name })
    .from(concepts)
    .where(and(inArray(concepts.id, uniqueConceptIds), eq(concepts.status, "active")));
}

async function enqueueConditionalRefresh(
  tx: Transaction,
  userId: string,
  resourceId: string,
  correlationId: string,
  conceptsForResource: Array<{ id: string; name: string }>,
  now: Date,
): Promise<void> {
  if (conceptsForResource.length === 0) return;
  const coverageRows = await tx
    .select({ conceptId: resourceConcepts.conceptId, type: resources.type, count: count() })
    .from(resourceConcepts)
    .innerJoin(resources, eq(resources.id, resourceConcepts.resourceId))
    .where(and(
      inArray(resourceConcepts.conceptId, conceptsForResource.map((concept) => concept.id)),
      isNull(resources.ownerUserId),
      or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
      eq(resources.status, "ready"),
      isNull(resources.deletedAt),
      inArray(resources.type, ["video", "paper"]),
    ))
    .groupBy(resourceConcepts.conceptId, resources.type);
  const coverageByConcept = new Map(coverageRows.map((row) => [`${row.conceptId}:${row.type}`, Number(row.count)]));
  const coverageFloor = DISCOVERY_REFRESH_CONFIG.catalogCoverageFloor;
  const refreshable = conceptsForResource.filter((concept) => (
    (coverageByConcept.get(`${concept.id}:video`) ?? 0) < coverageFloor
    || (coverageByConcept.get(`${concept.id}:paper`) ?? 0) < coverageFloor
  ));
  if (refreshable.length === 0) return;
  const recent = await tx
    .select({ payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(and(
      eq(outboxEvents.userId, userId),
      eq(outboxEvents.eventType, "discovery.refresh_requested"),
      gte(outboxEvents.createdAt, new Date(now.getTime() - 12 * 60 * 60 * 1000)),
    ))
    .limit(100);
  const alreadyRequested = new Set(recent.flatMap((row) => stringArray(recordValue(row.payload, "conceptIds"))));
  const pending = refreshable.filter((concept) => !alreadyRequested.has(concept.id));
  if (pending.length === 0) return;
  await tx.insert(outboxEvents).values({
    aggregateType: "resource",
    aggregateId: resourceId,
    eventType: "discovery.refresh_requested",
    schemaVersion: 1,
    userId,
    correlationId,
    payload: {
      conceptIds: pending.map((concept) => concept.id),
      conceptNames: pending.map((concept) => concept.name),
      level: "mixed",
      preferredFormats: [],
      source: "behavior-v1",
      refreshReason: "behavior",
      requestedAt: now.toISOString(),
    },
  });
}

type LearningActivity = Pick<typeof activityEvents.$inferSelect, "id" | "userId" | "resourceId" | "studySessionId" | "conceptId" | "eventType" | "payload" | "occurredAt">;

/** Persisted, idempotent learner projection. The Code Observer does not participate. */
export async function projectStudyBehavior(tx: Transaction, event: LearningActivity): Promise<void> {
  const observation = observationFromActivity(event.eventType, event.payload);
  if (!observation) return;
  const raw = behaviorSignal(observation);
  if (!raw.positive && !raw.negative) return;
  const now = new Date();
  const ageDecay = .5 ** (Math.max(0, now.getTime() - event.occurredAt.getTime()) / (AFFINITY_HALF_LIFE_DAYS * 86_400_000));
  const signal = { ...raw, positive: raw.positive * ageDecay, negative: raw.negative * ageDecay };
  const [marker] = await tx.insert(activityEvents).values({
    schemaVersion: 1, userId: event.userId, resourceId: event.resourceId, studySessionId: event.studySessionId,
    eventType: "discovery.affinity_projected", actorType: "system", source: "web", occurredAt: now,
    idempotencyKey: `affinity:${LEARNER_MODEL_VERSION}:${event.id}`,
    causationId: event.id, payload: { observation, projectorVersion: LEARNER_MODEL_VERSION, sourceEventId: event.id },
  }).onConflictDoNothing().returning({ id: activityEvents.id });
  if (!marker) return;
  const conceptsForResource = event.resourceId ? await loadResourceConcepts(tx, event.resourceId) : event.conceptId ? [{ id: event.conceptId, name: "", relevance: 1, isPrimary: true }] : [];
  const projected = await projectBehaviorAffinity(tx, event.userId, conceptsForResource, signal, now);
  if (signal.refresh && event.resourceId) await enqueueConditionalRefresh(tx, event.userId, event.resourceId, event.id, await loadConceptsByIds(tx, projected), now);
}

async function projectLearningOutcomes(tx: Transaction, userId: string): Promise<void> {
  // ponytail: catch up at most 100 outcomes per request; move backlog draining to the existing worker if this bound is reached.
  const pending = await tx.select().from(activityEvents).where(and(eq(activityEvents.userId, userId),
    inArray(activityEvents.eventType, ["question.asked", "exercise.completed", "review.completed"]),
    gte(activityEvents.occurredAt, new Date(Date.now() - 90 * 86_400_000)),
    sql`NOT EXISTS (SELECT 1 FROM activity.activity_events projected WHERE projected.user_id = ${userId} AND projected.idempotency_key = 'affinity:' || ${LEARNER_MODEL_VERSION} || ':' || ${activityEvents.id}::text)`,
  )).orderBy(asc(activityEvents.occurredAt)).limit(100);
  for (const event of pending) await projectStudyBehavior(tx, event);
}

export async function recordInteraction(userId: string, input: DiscoveryInteractionRequest): Promise<{ duplicate: boolean }> {
  const result = await withUserTransaction(userId, async (tx) => {
    if (input.runId) await requireRecommendationContext(tx, userId, input.runId, input.resourceId);
    if (!(await loadDiscoveryResources(tx, [input.resourceId], userId)).length) throw new AuthError("RESOURCE_NOT_AVAILABLE", "That material is not available.", 404);
    if (input.action === "save" || input.action === "dismiss") {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`library-feedback:${userId}:${input.resourceId}`}, 0))`);
      const [existing] = await tx.select({ status: libraryItems.status }).from(libraryItems).where(and(eq(libraryItems.userId, userId), eq(libraryItems.resourceId, input.resourceId)));
      if (existing?.status === (input.action === "save" ? "saved" : "removed")) return { duplicate: true };
    }
    const impressionId = input.impressionId;
    if (impressionId) {
      const impression = await tx.select({ id: recommendationImpressions.id }).from(recommendationImpressions).where(and(eq(recommendationImpressions.id, impressionId), eq(recommendationImpressions.userId, userId), eq(recommendationImpressions.resourceId, input.resourceId), input.runId ? eq(recommendationImpressions.recommendationRunId, input.runId) : undefined)).limit(1);
      if (!impression[0]) throw new AuthError("INVALID_IMPRESSION_CONTEXT", "That recommendation impression is not available.", 422);
    }
    const [interaction] = await tx.insert(discoveryInteractions).values({ impressionId, userId, resourceId: input.resourceId, action: input.action, correlationId: input.correlationId, metadata: input.metadata }).onConflictDoNothing().returning({ id: discoveryInteractions.id });
    if (!interaction) return { duplicate: true };
    const now = new Date();
    const [event] = await tx.insert(activityEvents).values({
      schemaVersion: 1,
      userId,
      resourceId: input.resourceId,
      eventType: activityEventByAction[input.action],
      actorType: "user",
      source: "web",
      correlationId: input.correlationId,
      idempotencyKey: `discovery:${input.correlationId}`,
      occurredAt: now,
      payload: {
        action: input.action,
        runId: input.runId ?? null,
        // Client-supplied progress is diagnostic, never evidence of consumption.
        progressFraction: null,
      },
    }).onConflictDoNothing().returning();
    if (event) await projectStudyBehavior(tx, event);
    if (input.action === "save") {
      await tx.insert(libraryItems).values({ userId, resourceId: input.resourceId, status: "saved", source: "discovery" }).onConflictDoUpdate({ target: [libraryItems.userId, libraryItems.resourceId], set: { status: "saved", updatedAt: new Date() } });
    }
    if (input.action === "dismiss") {
      await tx
        .insert(libraryItems)
        .values({ userId, resourceId: input.resourceId, status: "removed", source: "discovery" })
        .onConflictDoUpdate({
          target: [libraryItems.userId, libraryItems.resourceId],
          set: { status: "removed", updatedAt: new Date() },
        });
    }
    return { duplicate: false };
  });
  if (!result.duplicate && input.action !== "open") { await invalidateHomeFeedCache(userId); await invalidateRecommendations(userId); }
  return result;
}

export function requireDiscoveryAction(input: unknown): DiscoveryAction {
  if (typeof input !== "string" || !["open", "save", "dismiss", "start_session", "complete"].includes(input)) throw new AuthError("INVALID_DISCOVERY_ACTION", "Choose a valid discovery action.", 422);
  return input as DiscoveryAction;
}

import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  activityEvents,
  concepts,
  conceptRelations,
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
import { and, count, desc, eq, gte, inArray, isNull, max, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { getCachedHomeFeed, invalidateHomeFeedCache, setCachedHomeFeed } from "./cache";
import { DISCOVERY_CATALOG_VERSION, discoveryFingerprint } from "./fingerprint";
import {
  DISCOVERY_FEATURE_VERSION,
  DISCOVERY_EXPLORATION_CONFIG,
  DISCOVERY_STRATEGY_VERSION,
  rankDiscoveryResources,
  type DiscoveryResource,
  type LearnerProfile,
  type RankedResource,
} from "./ranker";

const durableFeedTtlMs = 6 * 60 * 60 * 1000;
const staleFeedTtlMs = 24 * 60 * 60 * 1000;
const catalogResourceLimit = 800;

type ProfileLoad = {
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

async function loadProfile(tx: Transaction, userId: string): Promise<ProfileLoad> {
  const [settingsRows, affinityRows, interestRows, sessions, dismissedRows] = await Promise.all([
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
      .where(and(eq(studySessions.userId, userId), eq(studySessions.status, "active")))
      .orderBy(desc(studySessions.lastActiveAt))
      .limit(3),
    tx
      .select({ resourceId: libraryItems.resourceId })
      .from(libraryItems)
      .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "removed"))),
  ]);
  const preferences = settingsRows[0]?.learningPreferences ?? {};
  const conceptIds = stringArray(recordValue(preferences, "conceptIds"));
  const emergingConceptIds = affinityRows
    .filter((affinity) => (
      !conceptIds.includes(affinity.conceptId)
      && affinity.featureVersion !== "onboarding-v1"
      && affinity.featureVersion.includes("behavior")
      && Number(affinity.positiveWeight ?? 0) - Number(affinity.negativeWeight ?? 0) >= DISCOVERY_EXPLORATION_CONFIG.emergingThreshold
    ))
    .map((affinity) => affinity.conceptId);
  const trackedConceptIds = [...new Set([...conceptIds, ...emergingConceptIds])];
  const relationRows = trackedConceptIds.length === 0
    ? []
    : await tx
      .select({ sourceConceptId: conceptRelations.sourceConceptId, targetConceptId: conceptRelations.targetConceptId })
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
  const supplementalConceptIds = [...new Set([...emergingConceptIds, ...adjacentConceptIds])];
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
    version: "profile-v4",
    explorationVersion: DISCOVERY_EXPLORATION_CONFIG.version,
    conceptIds: [...profileLoad.profile.conceptIds].sort(),
    emergingConceptIds: [...profileLoad.emergingConceptIds].sort(),
    adjacentConceptIds: [...profileLoad.adjacentConceptIds].sort(),
    persona: profileLoad.profile.persona,
    learningIntents: [...profileLoad.profile.learningIntents].sort(),
    preferredFormats: [...profileLoad.profile.preferredFormats].sort(),
    preferredDuration: profileLoad.profile.preferredDuration,
    selfReportedLevel: profileLoad.profile.selfReportedLevel,
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
      ...session,
      lastActiveAt: session.lastActiveAt.toISOString(),
    })),
    dismissedResourceIds: [...profileLoad.dismissedResourceIds].sort(),
  });
}

async function loadResources(tx: Transaction, resourceIds?: string[], ownerUserId?: string): Promise<DiscoveryResource[]> {
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
  );
  const resourceTypes = ["video", "paper"] as const;
  const queryResources = (type?: (typeof resourceTypes)[number]) => tx
    .select({ resource: resources, video: videoDetails, paper: paperDetails })
    .from(resources)
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .where(and(resourceWhere, type ? eq(resources.type, type) : undefined))
    .orderBy(desc(resources.qualityScore), desc(resources.updatedAt))
    .limit(resourceIds ? resourceIds.length : catalogResourceLimit);
  const rows = resourceIds
    ? await queryResources()
    : (await Promise.all(resourceTypes.map((type) => queryResources(type)))).flat();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.resource.id);
  const [conceptRows, qualityRows] = await Promise.all([
    tx
      .select({ resourceId: resourceConcepts.resourceId, conceptId: concepts.id, name: concepts.name, relevance: resourceConcepts.relevance })
      .from(resourceConcepts)
      .innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId))
      .where(inArray(resourceConcepts.resourceId, ids)),
    tx
      .select({ resourceId: resourceQualitySnapshots.resourceId, finalQualityScore: resourceQualitySnapshots.finalQualityScore, freshnessPrior: resourceQualitySnapshots.freshnessPrior, sourceAuthority: resourceQualitySnapshots.sourceAuthority, capturedAt: resourceQualitySnapshots.capturedAt })
      .from(resourceQualitySnapshots)
      .where(and(inArray(resourceQualitySnapshots.resourceId, ids), eq(resourceQualitySnapshots.featureVersion, "youtube-quality-v1")))
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
      } : null,
    } satisfies DiscoveryResource];
  });
}

function reasonText(candidate: RankedResource, profile: LearnerProfile): string {
  if (candidate.reasonCodes.includes("continue_learning")) return "Continue where you left off";
  const coreConcept = candidate.resource.concepts.find((concept) => (profile.coreConceptIds ?? profile.conceptIds).includes(concept.id));
  if ((candidate.reasonCodes.includes("concept_match") || candidate.reasonCodes.includes("adjacent_concept")) && coreConcept) {
    return `Because you selected ${coreConcept.name}`;
  }
  const emergingConcept = candidate.resource.concepts.find((concept) => profile.emergingConceptIds?.includes(concept.id));
  if ((candidate.reasonCodes.includes("concept_match") || candidate.reasonCodes.includes("adjacent_concept")) && emergingConcept) {
    return `Because you've been learning ${emergingConcept.name}`;
  }
  const adjacentConcept = candidate.resource.concepts.find((concept) => profile.adjacentConceptIds?.includes(concept.id));
  if (candidate.reasonCodes.includes("adjacent_concept") && adjacentConcept) return "Related to what you're learning";
  if (candidate.reasonCodes.includes("level_fit")) return "Fits your starting level";
  if (candidate.reasonCodes.includes("format_fit")) return "Matches how you like to learn";
  if (candidate.reasonCodes.includes("research_intent")) return "Matches your research interests";
  if (candidate.reasonCodes.includes("fresh")) return "Fresh from the LearnSpace catalogue";
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
    score: Number(candidate.score.toFixed(6)),
  };
}

function responseFromRanked(
  runId: string,
  generatedAt: Date,
  profileLoad: ProfileLoad,
  ranked: { videos: RankedResource[]; papers: RankedResource[] },
  activeSessionResources: DiscoveryResource[],
  stale: boolean,
): DiscoveryHomeResponse {
  const dismissed = new Set(profileLoad.dismissedResourceIds);
  const activeIds = new Set(profileLoad.activeSessionResourceIds);
  const selectedVideos = ranked.videos.filter((candidate) => candidate.finalRank !== null && !dismissed.has(candidate.resource.id) && !activeIds.has(candidate.resource.id));
  const selectedPapers = ranked.papers.filter((candidate) => candidate.finalRank !== null && !dismissed.has(candidate.resource.id) && !activeIds.has(candidate.resource.id));
  const recommendedVideos = selectedVideos.slice(0, 6);
  const recommendedPapers = selectedPapers.slice(0, 6);
  const usedInRecommendations = new Set([...recommendedVideos, ...recommendedPapers].map((candidate) => candidate.resource.id));
  const fresh = [...selectedVideos, ...selectedPapers]
    .filter((candidate) => !usedInRecommendations.has(candidate.resource.id))
    .toSorted((left, right) => right.freshnessScore - left.freshnessScore || right.score - left.score)
    .slice(0, 6);
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
    sections: {
      continueLearning: active.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      recommendedVideos: recommendedVideos.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      researchPapers: recommendedPapers.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      freshForYou: fresh.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      interests: profileLoad.interests,
    },
  };
}

async function findReusableRun(
  tx: Transaction,
  userId: string,
  now: Date,
  surface: "home" | "discover",
  fingerprints: { profileFingerprint: string; catalogFingerprint: string },
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
      eq(recommendationRuns.strategyVersion, DISCOVERY_STRATEGY_VERSION),
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
  const resourcesForRun = await loadResources(tx, rows.map((row) => row.resource.id));
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
): Promise<{ run: typeof recommendationRuns.$inferSelect; ranked: { videos: RankedResource[]; papers: RankedResource[] } }> {
  const started = performance.now();
  const initialRanked = rankDiscoveryResources(resourcesForRanker, profileLoad.profile, now);
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
    strategyVersion: DISCOVERY_STRATEGY_VERSION,
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
  return { run, ranked };
}

export async function getHomeFeed(userId: string, surface: "home" | "discover" = "home"): Promise<DiscoveryHomeResponse> {
  const fingerprints = await withUserTransaction(userId, async (tx) => {
    const profileLoad = await loadProfile(tx, userId);
    return {
      profileFingerprint: profileFingerprint(profileLoad),
      catalogFingerprint: await catalogFingerprint(tx),
    };
  });
  const cached = surface === "home" ? await getCachedHomeFeed(userId, fingerprints) : null;
  if (cached) return cached;
  const result = await withUserTransaction(userId, async (tx) => {
    const now = new Date();
    const profileLoad = await loadProfile(tx, userId);
    const currentFingerprints = {
      profileFingerprint: profileFingerprint(profileLoad),
      catalogFingerprint: await catalogFingerprint(tx),
    };
    const reusableRun = await findReusableRun(tx, userId, now, surface, currentFingerprints);
    const activeSessionResources = await loadResources(tx, profileLoad.activeSessionResourceIds, userId);
    if (reusableRun) {
      const ranked = await loadRankedRun(tx, reusableRun);
      return {
        response: responseFromRanked(reusableRun.id, reusableRun.createdAt, profileLoad, ranked, activeSessionResources, now.getTime() - reusableRun.createdAt.getTime() > durableFeedTtlMs),
        fingerprints: currentFingerprints,
      };
    }
    const resourcesForRanker = (await loadResources(tx)).filter((resource) => !profileLoad.dismissedResourceIds.includes(resource.id));
    const { run, ranked } = await generateRun(tx, userId, profileLoad, now, resourcesForRanker, surface, currentFingerprints);
    return {
      response: responseFromRanked(run.id, now, profileLoad, ranked, activeSessionResources, false),
      fingerprints: currentFingerprints,
    };
  });
  if (surface === "home") await setCachedHomeFeed(userId, result.fingerprints, result.response);
  return result.response;
}

export async function recordImpression(userId: string, input: DiscoveryImpressionRequest): Promise<{ id: string | null }> {
  return withUserTransaction(userId, async (tx) => {
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
    return { id: row?.id ?? null };
  });
}

const activityEventByAction: Record<DiscoveryAction, string> = {
  open: "resource.opened",
  save: "artifact.saved",
  dismiss: "discovery.dismissed",
  start_session: "focus.started",
  complete: "resource.completed",
};

type BehaviorSignal = {
  positive: number;
  negative: number;
  confidence: number;
  refresh: boolean;
};

function progressFraction(metadata: Record<string, unknown>): number | null {
  const value = recordValue(metadata, "progressFraction");
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

function behaviorSignal(action: DiscoveryAction, metadata: Record<string, unknown>): BehaviorSignal {
  const progress = progressFraction(metadata);
  if (action === "open") {
    if (progress !== null && progress >= 0.5) return { positive: 0.1, negative: 0, confidence: 0.08, refresh: true };
    if (progress !== null && progress >= 0.25) return { positive: 0.06, negative: 0, confidence: 0.06, refresh: false };
    return { positive: 0.03, negative: 0, confidence: 0.03, refresh: false };
  }
  if (action === "save") return { positive: 0.18, negative: 0, confidence: 0.12, refresh: true };
  if (action === "start_session") return { positive: 0.12, negative: 0, confidence: 0.1, refresh: true };
  if (action === "complete") return { positive: 0.25, negative: 0, confidence: 0.15, refresh: true };
  return { positive: 0, negative: 0.15, confidence: 0.1, refresh: true };
}

async function loadResourceConcepts(
  tx: Transaction,
  resourceId: string,
): Promise<Array<{ id: string; name: string }>> {
  return tx
    .select({ id: concepts.id, name: concepts.name })
    .from(resourceConcepts)
    .innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId))
    .where(eq(resourceConcepts.resourceId, resourceId));
}

async function projectBehaviorAffinity(
  tx: Transaction,
  userId: string,
  conceptIds: string[],
  signal: BehaviorSignal,
  now: Date,
): Promise<string[]> {
  const uniqueConceptIds = [...new Set(conceptIds)];
  const relationRows = uniqueConceptIds.length === 0
    ? []
    : await tx
      .select({ sourceConceptId: conceptRelations.sourceConceptId, targetConceptId: conceptRelations.targetConceptId })
      .from(conceptRelations)
      .where(and(
        or(
          inArray(conceptRelations.sourceConceptId, uniqueConceptIds),
          inArray(conceptRelations.targetConceptId, uniqueConceptIds),
        ),
        eq(conceptRelations.status, "accepted"),
        inArray(conceptRelations.relationType, ["related_to", "part_of", "applies_to", "prerequisite"]),
        sql`${conceptRelations.weight} * ${conceptRelations.confidence} >= 0.5`,
      ));
  const core = new Set(uniqueConceptIds);
  const targets = [
    ...uniqueConceptIds.map((conceptId) => ({ conceptId, multiplier: 1 })),
    ...[...new Set(relationRows.map((row) => (
      core.has(row.sourceConceptId) ? row.targetConceptId : row.sourceConceptId
    )))].filter((conceptId) => !core.has(conceptId)).map((conceptId) => ({
      conceptId,
      multiplier: DISCOVERY_EXPLORATION_CONFIG.adjacentBehaviorMultiplier,
    })),
  ];
  for (const target of targets) {
    const positive = signal.positive * target.multiplier;
    const negative = signal.negative * target.multiplier;
    const confidence = signal.confidence * target.multiplier;
    await tx
      .insert(userConceptAffinity)
      .values({
        userId,
        conceptId: target.conceptId,
        score: positive - negative,
        confidence: Math.min(1, confidence),
        positiveWeight: positive,
        negativeWeight: negative,
        featureVersion: "discovery-behavior-v1",
        lastEventAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userConceptAffinity.userId, userConceptAffinity.conceptId],
        set: {
          score: sql`LEAST(1.0::real, GREATEST(-1.0::real, ${userConceptAffinity.score} + (${positive}::real - ${negative}::real) * (1.0::real - ${userConceptAffinity.confidence})))`,
          confidence: sql`LEAST(1.0::real, ${userConceptAffinity.confidence} + ${confidence}::real)`,
          positiveWeight: sql`LEAST(1.0::real, ${userConceptAffinity.positiveWeight} + ${positive}::real)`,
          negativeWeight: sql`LEAST(1.0::real, ${userConceptAffinity.negativeWeight} + ${negative}::real)`,
          featureVersion: sql`CASE WHEN ${userConceptAffinity.featureVersion} = 'onboarding-v1' THEN 'discovery-behavior-v1' ELSE ${userConceptAffinity.featureVersion} END`,
          lastEventAt: now,
          updatedAt: now,
        },
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
  action: DiscoveryAction,
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
  const coverageFloor = 12;
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

export async function recordInteraction(userId: string, input: DiscoveryInteractionRequest): Promise<{ duplicate: boolean }> {
  const result = await withUserTransaction(userId, async (tx) => {
    let impressionId = input.impressionId;
    if (impressionId) {
      const impression = await tx.select({ id: recommendationImpressions.id }).from(recommendationImpressions).where(and(eq(recommendationImpressions.id, impressionId), eq(recommendationImpressions.userId, userId), eq(recommendationImpressions.resourceId, input.resourceId))).limit(1);
      impressionId = impression[0]?.id;
    }
    const [interaction] = await tx.insert(discoveryInteractions).values({ impressionId, userId, resourceId: input.resourceId, action: input.action, correlationId: input.correlationId, metadata: input.metadata }).onConflictDoNothing().returning({ id: discoveryInteractions.id });
    if (!interaction) return { duplicate: true };
    const now = new Date();
    const signal = behaviorSignal(input.action, input.metadata);
    const conceptsForResource = await loadResourceConcepts(tx, input.resourceId);
    const projectedConceptIds = await projectBehaviorAffinity(tx, userId, conceptsForResource.map((concept) => concept.id), signal, now);
    await tx.insert(activityEvents).values({
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
        progressFraction: progressFraction(input.metadata),
      },
    }).onConflictDoNothing();
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
    if (signal.refresh) {
      const refreshConceptIds = signal.positive > 0
        ? projectedConceptIds
        : conceptsForResource.map((concept) => concept.id);
      await enqueueConditionalRefresh(
        tx,
        userId,
        input.resourceId,
        input.correlationId,
        input.action,
        await loadConceptsByIds(tx, refreshConceptIds),
        now,
      );
    }
    return { duplicate: false };
  });
  if (!result.duplicate) await invalidateHomeFeedCache(userId);
  return result;
}

export function requireDiscoveryAction(input: unknown): DiscoveryAction {
  if (typeof input !== "string" || !["open", "save", "dismiss", "start_session", "complete"].includes(input)) throw new AuthError("INVALID_DISCOVERY_ACTION", "Choose a valid discovery action.", 422);
  return input as DiscoveryAction;
}

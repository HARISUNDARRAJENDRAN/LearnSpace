import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  activityEvents,
  concepts,
  discoveryInteractions,
  libraryItems,
  paperDetails,
  recommendationCandidates,
  recommendationImpressions,
  recommendationRuns,
  resourceConcepts,
  resourceQualitySnapshots,
  resources,
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
      .select({ resourceId: studySessions.activeResourceId })
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
  const level = recordValue(preferences, "selfReportedLevel");
  const profile: LearnerProfile = {
    conceptIds,
    conceptNames: new Map(interestRows.map((concept) => [concept.id, concept.name])),
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
    tx.select({ latestCapturedAt: max(resourceQualitySnapshots.capturedAt), latestScore: max(resourceQualitySnapshots.finalQualityScore) }).from(resourceQualitySnapshots),
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
    version: "profile-v2",
    conceptIds: [...profileLoad.profile.conceptIds].sort(),
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
    activeSessionResourceIds: profileLoad.activeSessionResourceIds,
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
  const rows = await tx
    .select({ resource: resources, video: videoDetails, paper: paperDetails })
    .from(resources)
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .where(resourceWhere)
    .orderBy(desc(resources.qualityScore), desc(resources.updatedAt))
    .limit(resourceIds ? resourceIds.length : catalogResourceLimit);
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
  const matchedConcept = candidate.resource.concepts.find((concept) => profile.conceptIds.includes(concept.id));
  if (candidate.reasonCodes.includes("concept_match") && matchedConcept) return `Because you selected ${matchedConcept.name}`;
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

const activityEventByAction: Partial<Record<DiscoveryAction, string>> = { open: "resource.opened" };

export async function recordInteraction(userId: string, input: DiscoveryInteractionRequest): Promise<{ duplicate: boolean }> {
  const result = await withUserTransaction(userId, async (tx) => {
    let impressionId = input.impressionId;
    if (impressionId) {
      const impression = await tx.select({ id: recommendationImpressions.id }).from(recommendationImpressions).where(and(eq(recommendationImpressions.id, impressionId), eq(recommendationImpressions.userId, userId), eq(recommendationImpressions.resourceId, input.resourceId))).limit(1);
      impressionId = impression[0]?.id;
    }
    const [interaction] = await tx.insert(discoveryInteractions).values({ impressionId, userId, resourceId: input.resourceId, action: input.action, correlationId: input.correlationId, metadata: input.metadata }).onConflictDoNothing().returning({ id: discoveryInteractions.id });
    if (!interaction) return { duplicate: true };
    const eventType = activityEventByAction[input.action];
    if (eventType) {
      await tx.insert(activityEvents).values({
        schemaVersion: 1,
        userId,
        resourceId: input.resourceId,
        eventType,
        actorType: "user",
        source: "web",
        correlationId: input.correlationId,
        idempotencyKey: `discovery:${input.correlationId}`,
        occurredAt: new Date(),
        payload: { action: input.action, runId: input.runId ?? null },
      }).onConflictDoNothing();
    }
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
  if (!result.duplicate && (input.action === "save" || input.action === "dismiss")) await invalidateHomeFeedCache(userId);
  return result;
}

export function requireDiscoveryAction(input: unknown): DiscoveryAction {
  if (typeof input !== "string" || !["open", "save", "dismiss", "start_session", "complete"].includes(input)) throw new AuthError("INVALID_DISCOVERY_ACTION", "Choose a valid discovery action.", 422);
  return input as DiscoveryAction;
}

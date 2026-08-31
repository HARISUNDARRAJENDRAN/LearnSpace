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
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { getCachedHomeFeed, invalidateHomeFeedCache, setCachedHomeFeed } from "./cache";
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
  const [settingsRows, affinityRows, interestRows, sessions] = await Promise.all([
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
  };
}

async function loadResources(tx: Transaction, resourceIds?: string[]): Promise<DiscoveryResource[]> {
  if (resourceIds && resourceIds.length === 0) return [];
  const resourceWhere = resourceIds && resourceIds.length > 0
    ? inArray(resources.id, resourceIds)
    : and(
        isNull(resources.ownerUserId),
        or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
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

function responseFromRanked(runId: string, generatedAt: Date, profileLoad: ProfileLoad, ranked: { videos: RankedResource[]; papers: RankedResource[] }, stale: boolean): DiscoveryHomeResponse {
  const selectedVideos = ranked.videos.filter((candidate) => candidate.finalRank !== null);
  const selectedPapers = ranked.papers.filter((candidate) => candidate.finalRank !== null);
  const fresh = [...selectedVideos, ...selectedPapers].toSorted((left, right) => right.freshnessScore - left.freshnessScore || right.score - left.score).slice(0, 6);
  const active = profileLoad.activeSessionResourceIds
    .flatMap((resourceId) => [...selectedVideos, ...selectedPapers].find((candidate) => candidate.resource.id === resourceId) ?? [])
    .slice(0, 3);
  return {
    runId,
    generatedAt: generatedAt.toISOString(),
    stale,
    sections: {
      continueLearning: active.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      recommendedVideos: selectedVideos.slice(0, 6).map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      researchPapers: selectedPapers.slice(0, 6).map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      freshForYou: fresh.map((candidate, index) => toCard(candidate, profileLoad.profile, runId, index)),
      interests: profileLoad.interests,
    },
  };
}

async function findReusableRun(tx: Transaction, userId: string, now: Date, surface: "home" | "discover"): Promise<typeof recommendationRuns.$inferSelect | null> {
  const minimumDate = new Date(now.getTime() - staleFeedTtlMs);
  const rows = await tx
    .select()
    .from(recommendationRuns)
    .where(and(eq(recommendationRuns.userId, userId), eq(recommendationRuns.surface, surface), eq(recommendationRuns.status, "completed"), gte(recommendationRuns.createdAt, minimumDate)))
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

async function generateRun(tx: Transaction, userId: string, profileLoad: ProfileLoad, now: Date, resourcesForRanker: DiscoveryResource[], surface: "home" | "discover"): Promise<{ run: typeof recommendationRuns.$inferSelect; ranked: { videos: RankedResource[]; papers: RankedResource[] } }> {
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
      catalogVersion: "catalog-v1",
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
  const cached = surface === "home" ? await getCachedHomeFeed(userId) : null;
  if (cached) return cached;
  const response = await withUserTransaction(userId, async (tx) => {
    const now = new Date();
    const profileLoad = await loadProfile(tx, userId);
    const reusableRun = await findReusableRun(tx, userId, now, surface);
    if (reusableRun) {
      const ranked = await loadRankedRun(tx, reusableRun);
      return responseFromRanked(reusableRun.id, reusableRun.createdAt, profileLoad, ranked, now.getTime() - reusableRun.createdAt.getTime() > durableFeedTtlMs);
    }
    const resourcesForRanker = await loadResources(tx);
    const { run, ranked } = await generateRun(tx, userId, profileLoad, now, resourcesForRanker, surface);
    return responseFromRanked(run.id, now, profileLoad, ranked, false);
  });
  if (surface === "home") await setCachedHomeFeed(userId, response);
  return response;
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
      await tx.update(libraryItems).set({ status: "removed", updatedAt: new Date() }).where(and(eq(libraryItems.userId, userId), eq(libraryItems.resourceId, input.resourceId)));
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

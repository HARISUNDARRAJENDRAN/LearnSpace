import { createHash } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { conceptAliases, concepts, outboxEvents, paperDetails, recommendationCandidates, recommendationRuns, resources, videoDetails } from "@learnspace/db/schema";
import type { SourceDiscoveryCandidate, SourceDiscoveryMode, SourceDiscoverySearchRequest, SourceDiscoverySearchResponse, SourcePreview, SourceRankingIntent } from "@learnspace/shared";
import { classifySourceUrl, normalizeQuery, SOURCE_DISCOVERY_MAX_RESULTS, SOURCE_DISCOVERY_MIN_RESULTS, type SourceDiscoveryResolveRequest, sourceDiscoveryCandidateSchema, sourceDiscoveryInstantBatchSchema, sourceModeForUrl } from "@learnspace/shared";
import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { AuthError } from "../auth/errors";
import { DISCOVERY_FEATURE_VERSION, DISCOVERY_STRATEGY_VERSION, type DiscoveryResource, type RankedResource, rankSourceResources, sourceQuerySignals } from "../discovery/ranker";
import { loadDiscoveryProfile, loadDiscoveryResources } from "../discovery/service";
import { getSourceCandidatePool, setSourceCandidatePool } from "./cache";
import { instantDiscovery } from "@learnspace/shared/exa-discovery";
import { getRedisValue, setRedisValue } from "../discovery/cache";
import { gatherVideos, type PickedVideo, pickVideos, provisionalPicks, type VideoIntent } from "./video-agent";
import { retrieveResearchPapers, type ResearchPaper } from "../research/retrieval/service";
import { cleanLatexText, cleanPaperText } from "../research/text";
import { resolveArxivMetadata, resolveDoiMetadata } from "./paper-resolver";

const sourceResultLimit = SOURCE_DISCOVERY_MAX_RESULTS;
const sourceCoverageMinimum = SOURCE_DISCOVERY_MIN_RESULTS;
const sourceRunReuseMs = 10 * 60 * 1000;

function sourceError(code: string, message: string, status = 400, details: Record<string, unknown> = {}): AuthError {
  return new AuthError(code, message, status, undefined, details);
}

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function reasonLabel(code: string, mode: SourceDiscoveryMode): string {
  const labels: Record<string, string> = {
    query_phrase_match: "Strong topic match",
    query_high_relevance: "Strong topic match",
    query_concept_match: "Highly relevant",
    beginner_intent_match: "Fits your level",
    practical_intent_match: "Practical examples",
    depth_intent_match: "In-depth explanation",
    good_concept_coverage: "Good concept coverage",
    level_fit: "Fits your level",
    fits_your_level: "Fits your level",
    format_fit: "Matches how you learn",
    matches_how_you_learn: "Matches how you learn",
    practical_examples: "Practical examples",
    foundational_paper: "Foundational paper",
    recent_work: "Recent work",
    fresh: "Recent work",
    learner_affinity: "Matches how you learn",
    concept_match: "Good concept coverage",
  };
  return labels[code] ?? (mode === "research" ? "Highly relevant" : "Good concept coverage");
}

type SourceOrigin = "catalog" | "external_refresh" | "direct_url";
type CandidateDiagnostics = { sourceOrigin: SourceOrigin; queryRelevance?: number; qualificationReason?: string };
export type SourceDiscoveryDeferredWork = (work: () => Promise<void>) => void;

function sourceCandidate(candidate: RankedResource, runId: string | null, mode: SourceDiscoveryMode, diagnostics?: CandidateDiagnostics): SourceDiscoveryCandidate {
  const resource = candidate.resource;
  const reasonCodes = [...new Set(candidate.reasonCodes)].slice(0, 4);
  const resourceId = /^[0-9a-f-]{36}$/i.test(resource.id) ? resource.id : undefined;
  const provider = resource.provider === "youtube" || resource.provider === "arxiv" || resource.provider === "doi" ? resource.provider : undefined;
  return {
    ...(resourceId ? { resourceId } : {}),
    type: resource.type,
    ...(provider ? { provider } : {}),
    ...(resource.externalId ? { externalId: resource.externalId } : {}),
    title: resource.title,
    description: resource.type === "paper" ? resource.paperAbstract : resource.description,
    canonicalUrl: resource.canonicalUrl,
    thumbnailUrl: resource.type === "video" ? resource.thumbnailUrl : null,
    author: resource.type === "video" ? resource.channelTitle : resource.authors?.[0] ?? resource.venue,
    durationMs: resource.durationMs,
    publishedAt: (resource.publishedAt ?? resource.publicationDate)?.toISOString() ?? null,
    reason: reasonLabel(reasonCodes[0] ?? "", mode),
    reasonCodes,
    score: Number(candidate.score.toFixed(6)),
    candidateRank: candidate.candidateRank,
    finalRank: candidate.finalRank,
    recommendationRunId: runId,
    sourceOrigin: diagnostics?.sourceOrigin,
    queryRelevance: diagnostics?.queryRelevance ?? candidate.queryRelevance,
    qualificationReason: diagnostics?.qualificationReason ?? candidate.qualificationReason,
  };
}

function selectSourceResults(ranked: RankedResource[]): RankedResource[] {
  return [...ranked]
    .filter((candidate) => candidate.finalRank !== null)
    .sort((left, right) => (left.finalRank ?? Number.MAX_SAFE_INTEGER) - (right.finalRank ?? Number.MAX_SAFE_INTEGER)
      || left.candidateRank - right.candidateRank
      || right.score - left.score
      || left.resource.id.localeCompare(right.resource.id))
    .slice(0, sourceResultLimit);
}

function candidateDiagnostics(run: typeof recommendationRuns.$inferSelect, resourceId: string, queryRelevance?: number | null): CandidateDiagnostics {
  const stored = arrayValue(run.contextSnapshot.candidateDiagnostics).find((value) => recordValue(value, "resourceId") === resourceId);
  const storedOrigin = recordValue(stored, "sourceOrigin");
  const refreshedResourceIds = new Set(arrayValue(run.contextSnapshot.refreshedResourceIds).filter((id): id is string => typeof id === "string"));
  const diagnostics: CandidateDiagnostics = {
    sourceOrigin: storedOrigin === "external_refresh" || refreshedResourceIds.has(resourceId) ? "external_refresh" : "catalog",
  };
  const storedQueryRelevance = recordValue(stored, "queryRelevance");
  const storedQualificationReason = recordValue(stored, "qualificationReason");
  if (typeof storedQueryRelevance === "number") diagnostics.queryRelevance = storedQueryRelevance;
  else if (typeof queryRelevance === "number") diagnostics.queryRelevance = queryRelevance;
  if (typeof storedQualificationReason === "string") diagnostics.qualificationReason = storedQualificationReason;
  return diagnostics;
}

function ephemeralCandidates(run: typeof recommendationRuns.$inferSelect): SourceDiscoveryCandidate[] {
  return arrayValue(run.contextSnapshot.ephemeralCandidates).flatMap((value) => {
    const parsed = sourceDiscoveryCandidateSchema.safeParse(value);
    return parsed.success ? [{ ...parsed.data, recommendationRunId: run.id }] : [];
  });
}

function runMode(run: typeof recommendationRuns.$inferSelect): SourceDiscoveryMode {
  return run.contextSnapshot?.mode === "research" ? "research" : "learn";
}

function runStatus(run: typeof recommendationRuns.$inferSelect): "completed" | "searching" | "failed" {
  if (run.status === "failed") return "failed";
  return run.status === "running" || run.status === "queued" ? "searching" : "completed";
}

function runRefreshError(run: typeof recommendationRuns.$inferSelect, mode: SourceDiscoveryMode): { code: string; message: string } | undefined {
  if (run.status !== "failed") return undefined;
  const stored = recordValue(run.contextSnapshot, "refreshError");
  return {
    code: asString(recordValue(stored, "code")) ?? "DISCOVERY_FAILED",
    message: asString(recordValue(stored, "message")) ?? (mode === "research" ? "We couldn't finish finding relevant papers." : "We couldn't finish finding strong learning videos."),
  };
}

async function resolveConcept(tx: Transaction, query: string): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeQuery(query).toLowerCase();
  const exact = await tx.select({ id: concepts.id, name: concepts.name }).from(concepts).where(and(
    eq(concepts.status, "active"),
    or(sql`lower(${concepts.name}) = ${normalized}`, eq(concepts.slug, normalized.replace(/\s+/g, "-"))),
  )).limit(1);
  if (exact[0]) return exact[0];
  const alias = await tx.select({ id: concepts.id, name: concepts.name }).from(conceptAliases).innerJoin(concepts, eq(concepts.id, conceptAliases.conceptId)).where(and(eq(concepts.status, "active"), eq(conceptAliases.normalizedAlias, normalized))).limit(1);
  if (alias[0]) return alias[0];
  const fuzzy = await tx.select({ id: concepts.id, name: concepts.name }).from(concepts).where(and(eq(concepts.status, "active"), ilike(concepts.name, `%${normalized}%`))).limit(1);
  if (fuzzy[0]) return fuzzy[0];
  const stopWords = new Set(["about", "does", "for", "from", "how", "learn", "need", "should", "teach", "the", "their", "this", "want", "what", "work", "you"]);
  for (const token of normalized.split(/[^a-z0-9]+/).filter((value) => value.length > 2 && !stopWords.has(value))) {
    const tokenMatch = await tx.select({ id: concepts.id, name: concepts.name }).from(concepts).where(and(
      eq(concepts.status, "active"),
      or(sql`lower(${concepts.name}) = ${token}`, eq(concepts.slug, token)),
    )).limit(1);
    if (tokenMatch[0]) return tokenMatch[0];
    const tokenAlias = await tx.select({ id: concepts.id, name: concepts.name }).from(conceptAliases).innerJoin(concepts, eq(concepts.id, conceptAliases.conceptId)).where(and(
      eq(concepts.status, "active"),
      eq(conceptAliases.normalizedAlias, token),
    )).limit(1);
    if (tokenAlias[0]) return tokenAlias[0];
  }
  return null;
}

async function findReusableRun(tx: Transaction, userId: string, mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent): Promise<typeof recommendationRuns.$inferSelect | null> {
  const rows = await tx.select().from(recommendationRuns).where(and(
    eq(recommendationRuns.userId, userId),
    eq(recommendationRuns.surface, "source_picker"),
    eq(recommendationRuns.queryText, query),
    sql`(${recommendationRuns.status} = 'running' OR ${recommendationRuns.status} = 'completed')`,
    gte(recommendationRuns.createdAt, new Date(Date.now() - sourceRunReuseMs)),
    sql`${recommendationRuns.contextSnapshot}->>'mode' = ${mode}`,
    sql`${recommendationRuns.contextSnapshot}->>'rankingIntent' = ${rankingIntent}`,
    sql`(${recommendationRuns.status} = 'running' OR ${recommendationRuns.contextSnapshot}->>'refreshStatus' IN ('not_needed', 'done', 'complete'))`,
  )).orderBy(desc(recommendationRuns.createdAt)).limit(1);
  return rows[0] ?? null;
}

async function responseForRun(tx: Transaction, run: typeof recommendationRuns.$inferSelect, userId: string): Promise<SourceDiscoverySearchResponse> {
  if (run.contextSnapshot.researchRetrieval === true) return {
    status: run.status === "failed" ? "failed" : run.status === "running" || run.status === "queued" ? "searching" : "completed",
    runId: run.id,
    mode: "research",
    query: run.queryText ?? "",
    candidates: ephemeralCandidates(run),
    retrieval: "live_web",
    cacheState: "miss",
    ...(run.contextSnapshot.timings && typeof run.contextSnapshot.timings === "object" ? { timings: run.contextSnapshot.timings as SourceDiscoverySearchResponse["timings"] } : {}),
  };
  if (run.contextSnapshot.agent === VIDEO_AGENT) return videoAgentResponse(run);
  const candidateRows = await tx.select().from(recommendationCandidates).where(eq(recommendationCandidates.recommendationRunId, run.id)).orderBy(recommendationCandidates.finalRank, recommendationCandidates.candidateRank).limit(sourceResultLimit);
  const refreshedResourceIds = arrayValue(run.contextSnapshot.refreshedResourceIds).filter((id): id is string => typeof id === "string");
  const poolResourceIds = [...new Set([...candidateRows.map((row) => row.resourceId), ...refreshedResourceIds])];
  const mode = runMode(run);
  const status = runStatus(run);
  const refreshError = runRefreshError(run, mode);
  const ephemeral = ephemeralCandidates(run);
  if (poolResourceIds.length === 0) {
    return {
      status,
      runId: run.id,
      mode,
      query: run.queryText ?? "",
      candidates: ephemeral,
      ...(refreshError ? { refreshError } : {}),
    };
  }
  const profileLoad = await loadDiscoveryProfile(tx, userId);
  const ranked = selectSourceResults(rankSourceResources(
    await loadDiscoveryResources(tx, poolResourceIds, userId),
    profileLoad.profile,
    run.queryText ?? "",
    mode,
    typeof run.contextSnapshot.rankingIntent === "string" ? run.contextSnapshot.rankingIntent : "best_match",
    new Date(),
    typeof run.contextSnapshot.canonicalConceptId === "string" ? run.contextSnapshot.canonicalConceptId : null,
  ));
  const persistedCandidates = ranked.map((candidate) => {
    const diagnostics = candidateDiagnostics(run, candidate.resource.id, candidate.queryRelevance ?? candidate.semanticRelevance);
    return sourceCandidate(candidate, run.id, mode, diagnostics);
  });
  const candidates = [...persistedCandidates, ...ephemeral]
    .sort((left, right) => (left.finalRank ?? Number.MAX_SAFE_INTEGER) - (right.finalRank ?? Number.MAX_SAFE_INTEGER) || left.candidateRank - right.candidateRank)
    .filter((candidate, index, all) => all.findIndex((other) => (
      candidate.provider && candidate.externalId && other.provider === candidate.provider && other.externalId === candidate.externalId
        ? true
        : (other.resourceId ?? other.canonicalUrl ?? other.title) === (candidate.resourceId ?? candidate.canonicalUrl ?? candidate.title)
    )) === index)
    .slice(0, sourceResultLimit);
  return {
    status,
    runId: run.id,
    mode,
    query: run.queryText ?? "",
    candidates,
    ...(refreshError ? { refreshError } : {}),
  };
}

async function enqueueRefresh(tx: Transaction, userId: string, runId: string, mode: SourceDiscoveryMode, query: string, concept: { id: string; name: string } | null, rankingIntent: SourceRankingIntent, correlationId: string): Promise<void> {
  await tx.insert(outboxEvents).values({
    aggregateType: "resource",
    aggregateId: runId,
    eventType: "discovery.refresh_requested",
    schemaVersion: 1,
    userId,
    correlationId,
    payload: {
      conceptIds: concept ? [concept.id] : [],
      conceptNames: concept ? [concept.name] : [],
      queryText: query,
      sourceKind: mode === "learn" ? "video" : "paper",
      rankingIntent,
      sourcePickerRunId: runId,
      source: "source-picker",
      refreshReason: "source_picker",
      requestedAt: new Date().toISOString(),
    },
  });
}

type InstantBatch = z.infer<typeof sourceDiscoveryInstantBatchSchema>;
type ExternalPool = {
  resources: DiscoveryResource[];
  cacheHit: boolean;
  cacheState: "fresh" | "stale" | "miss";
  cacheTier: "memory" | "redis" | null;
  cacheMs: number;
  exaMs: number;
  providerFailed: boolean;
  revalidation?: Promise<ExternalPool>;
};

type ExternalFetchResult = { resources: DiscoveryResource[]; exaMs: number; providerFailed: boolean };

const instantRefreshes = new Map<string, Promise<ExternalFetchResult>>();

function emptyExternalPool(): ExternalPool {
  return { resources: [], cacheHit: false, cacheState: "miss", cacheTier: null, cacheMs: 0, exaMs: 0, providerFailed: false };
}

function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dedupeExternalResources(resources: DiscoveryResource[]): DiscoveryResource[] {
  return [...new Map(resources.map((resource) => [`${resource.provider}:${resource.externalId}`, resource])).values()];
}

function externalResources(batch: InstantBatch, mode: SourceDiscoveryMode): DiscoveryResource[] {
  if (mode === "learn") {
    return dedupeExternalResources(batch.youtube.flatMap((candidate) => {
      const parsed = classifySourceUrl(candidate.canonical_url);
      if (parsed?.provider !== "youtube") return [];
      const description = candidate.evidence?.join(" ") || null;
      return [{
        id: `external:youtube:${parsed.id}`,
        type: "video",
        provider: "youtube",
        externalId: parsed.id,
        canonicalUrl: parsed.canonicalUrl,
        title: candidate.title,
        description,
        language: candidate.language ?? null,
        qualityScore: candidate.confidence,
        thumbnailUrl: `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`,
        channelTitle: candidate.channel ?? null,
        durationMs: candidate.duration_ms ?? null,
        publishedAt: parseDateValue(candidate.published_at),
        paperAbstract: null,
        venue: null,
        publicationDate: null,
        citationCount: null,
        metadata: {
          sourceConfidence: candidate.confidence,
          estimatedLevel: candidate.estimated_level ?? null,
          learningFormat: candidate.learning_format ?? null,
          hasImplementation: candidate.has_implementation ?? null,
          evidence: candidate.evidence ?? [],
        },
        concepts: [],
        quality: { finalQualityScore: candidate.confidence, freshnessPrior: null, sourceAuthority: candidate.confidence },
      } satisfies DiscoveryResource];
    }));
  }
  return dedupeExternalResources(batch.arxiv.flatMap((candidate) => {
    const parsed = classifySourceUrl(candidate.canonical_url);
    if (parsed?.provider !== "arxiv") return [];
    const description = candidate.abstract || candidate.evidence?.join(" ") || null;
    const publicationDate = parseDateValue(candidate.published_at);
    return [{
      id: `external:arxiv:${parsed.id}`,
      type: "paper",
      provider: "arxiv",
      externalId: parsed.id,
      canonicalUrl: parsed.canonicalUrl,
      title: candidate.title,
      description,
      language: null,
      qualityScore: candidate.confidence,
      thumbnailUrl: null,
      channelTitle: null,
      authors: candidate.authors ?? [],
      durationMs: null,
      publishedAt: publicationDate,
      paperAbstract: candidate.abstract ?? null,
      venue: "arXiv",
      publicationDate,
      citationCount: null,
      metadata: {
        sourceConfidence: candidate.confidence,
        estimatedLevel: candidate.estimated_level ?? null,
        paperClass: candidate.paper_class ?? "current",
        authors: candidate.authors ?? [],
        evidence: candidate.evidence ?? [],
      },
      concepts: [],
      quality: { finalQualityScore: candidate.confidence, freshnessPrior: null, sourceAuthority: candidate.confidence },
    } satisfies DiscoveryResource];
  }));
}

function instantBudgetMs(): number {
  const value = Number(process.env.SOURCE_DISCOVERY_INTERACTIVE_TIMEOUT_MS ?? 450);
  return Number.isFinite(value) ? Math.min(450, Math.max(100, value)) : 450;
}

function instantProviderTimeoutMs(): number {
  const value = Number(process.env.SOURCE_DISCOVERY_PROVIDER_TIMEOUT_MS ?? 8_000);
  return Number.isFinite(value) ? Math.min(15_000, Math.max(1_000, value)) : 8_000;
}

function instantPoolKey(mode: SourceDiscoveryMode, rankingIntent: SourceRankingIntent, query: string): string {
  return createHash("sha256").update(`${mode}\n${rankingIntent}\n${query}`).digest("hex");
}

async function callInstantDiscovery(mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent, correlationId: string): Promise<{ resources: DiscoveryResource[]; exaMs: number; providerFailed: boolean } | null> {
  const exaApiKey = process.env.EXA_API_KEY;
  if (!exaApiKey) return null;
  const started = performance.now();
  try {
    // The interactive budget bounds the response, not the provider work: a slow search still fills the pool.
    const batch = await instantDiscovery(
      { query_text: query, source_kind: mode === "learn" ? "video" : "paper", ranking_intent: rankingIntent, limit: sourceResultLimit, trace_id: correlationId },
      { exaApiKey, timeoutMs: instantProviderTimeoutMs() },
    );
    const parsed = sourceDiscoveryInstantBatchSchema.safeParse(batch);
    if (!parsed.success) {
      console.warn("source_discovery_instant_invalid_response", { correlationId });
      return null;
    }
    const resources = externalResources(parsed.data, mode);
    if (parsed.data.failures.length > 0) console.warn("source_discovery_instant_provider_failure", { correlationId, failures: parsed.data.failures });
    return { resources, exaMs: performance.now() - started, providerFailed: resources.length === 0 && parsed.data.failures.length > 0 };
  } catch (error) {
    console.warn("source_discovery_instant_unavailable", { correlationId, error: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

async function refreshExternalPool(mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent, correlationId: string): Promise<ExternalFetchResult> {
  const key = instantPoolKey(mode, rankingIntent, query);
  const existing = instantRefreshes.get(key);
  if (existing) return existing;
  const refresh = callInstantDiscovery(mode, query, rankingIntent, correlationId).then(async (result) => {
    if (!result) return { resources: [], exaMs: 0, providerFailed: true };
    if (result.resources.length > 0) void setSourceCandidatePool(mode, rankingIntent, query, result.resources);
    return result;
  }).finally(() => instantRefreshes.delete(key));
  instantRefreshes.set(key, refresh);
  return refresh;
}

async function loadExternalPool(mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent, correlationId: string): Promise<ExternalPool> {
  const cacheStarted = performance.now();
  const cached = await getSourceCandidatePool(mode, rankingIntent, query);
  const cacheMs = performance.now() - cacheStarted;
  if (cached) {
    const stale = cached.stale;
    const pool: ExternalPool = { resources: cached.resources, cacheHit: true, cacheState: stale ? "stale" : "fresh", cacheTier: cached.tier, cacheMs, exaMs: 0, providerFailed: false };
    if (stale) {
      pool.revalidation = refreshExternalPool(mode, query, rankingIntent, correlationId).then((result) => ({
        ...result,
        cacheHit: false,
        cacheState: "miss" as const,
        cacheTier: null,
        cacheMs: 0,
        providerFailed: result.providerFailed,
      }));
    }
    return pool;
  }
  const result = await refreshExternalPool(mode, query, rankingIntent, correlationId);
  return { ...result, cacheHit: false, cacheState: "miss", cacheTier: null, cacheMs };
}

async function persistInteractiveRun(
  userId: string,
  input: SourceDiscoverySearchRequest,
  query: string,
  concept: { id: string; name: string } | null,
  ranked: RankedResource[],
  catalogQualifiedCount: number,
  externalResources: DiscoveryResource[],
  correlationId: string,
  timings: Record<string, number>,
): Promise<typeof recommendationRuns.$inferSelect> {
  const qualifiedExternal = externalResources.filter((resource) => sourceQuerySignals(resource, query, concept?.id).qualified).slice(0, sourceResultLimit);
  const shouldRefresh = catalogQualifiedCount + qualifiedExternal.length < sourceCoverageMinimum;
  const refreshStatus = shouldRefresh ? "requested" : "not_needed";
  const status = shouldRefresh ? "running" : "completed";
  return withUserTransaction(userId, async (tx) => {
    const [run] = await tx.insert(recommendationRuns).values({
      userId,
      surface: "source_picker",
      queryText: query,
      strategyVersion: DISCOVERY_STRATEGY_VERSION,
      featureVersion: DISCOVERY_FEATURE_VERSION,
      contextSnapshot: {
        mode: input.mode,
        canonicalConceptId: concept?.id ?? null,
        canonicalConceptName: concept?.name ?? null,
        rankingIntent: input.rankingIntent,
        refreshStatus,
        interactive: true,
        qualifiedCatalogCandidateCount: catalogQualifiedCount,
        candidateDiagnostics: ranked.slice(0, sourceResultLimit).map((candidate) => ({
          resourceId: candidate.resource.id,
          sourceOrigin: candidate.resource.id.startsWith("external:") ? "external_refresh" : "catalog",
          queryRelevance: candidate.queryRelevance ?? candidate.semanticRelevance,
          qualificationReason: candidate.qualificationReason ?? null,
        })),
        ...(Object.keys(timings).length > 0 ? { interactiveTimings: timings } : {}),
      },
      status,
      completedAt: status === "completed" ? new Date() : null,
    }).returning();
    if (!run) throw new Error("Source discovery run could not be created");
    const catalogCandidates = ranked.filter((candidate) => /^[0-9a-f-]{36}$/i.test(candidate.resource.id));
    if (catalogCandidates.length > 0) {
      await tx.insert(recommendationCandidates).values(catalogCandidates.map((candidate) => ({
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
        selected: true,
      })));
    }
    const ephemeral = ranked
      .filter((candidate) => candidate.resource.id.startsWith("external:"))
      .slice(0, sourceResultLimit)
      .map((candidate) => sourceCandidate(candidate, run.id, input.mode, {
        sourceOrigin: "external_refresh",
        ...(typeof candidate.queryRelevance === "number" ? { queryRelevance: candidate.queryRelevance } : {}),
        ...(candidate.qualificationReason ? { qualificationReason: candidate.qualificationReason } : {}),
      }));
    let persistedRun = run;
    if (ephemeral.length > 0) {
      const [withEphemeral] = await tx.update(recommendationRuns).set({
        contextSnapshot: { ...run.contextSnapshot, ephemeralCandidates: ephemeral },
      }).where(eq(recommendationRuns.id, run.id)).returning();
      if (withEphemeral) persistedRun = withEphemeral;
    }
    if (shouldRefresh) {
      await enqueueRefresh(tx, userId, run.id, input.mode, query, concept, input.rankingIntent, correlationId);
    }
    return persistedRun;
  });
}

async function finalizeInteractiveRun(
  userId: string,
  runId: string,
  mode: SourceDiscoveryMode,
  query: string,
  rankingIntent: SourceRankingIntent,
  profile: Parameters<typeof rankSourceResources>[1],
  catalogResources: DiscoveryResource[],
  concept: { id: string; name: string } | null,
  external: ExternalPool,
): Promise<void> {
  if (external.providerFailed) {
    await withUserTransaction(userId, async (tx) => {
      const runs = await tx.select().from(recommendationRuns).where(and(
        eq(recommendationRuns.id, runId),
        eq(recommendationRuns.userId, userId),
        eq(recommendationRuns.surface, "source_picker"),
        sql`${recommendationRuns.status} IN ('queued', 'running')`,
      )).limit(1);
      const run = runs[0];
      if (!run) return;
      await tx.update(recommendationRuns).set({
        status: "failed",
        completedAt: new Date(),
        contextSnapshot: {
          ...run.contextSnapshot,
          refreshStatus: "failed",
          refreshError: {
            code: "DISCOVERY_PROVIDER_UNAVAILABLE",
            message: mode === "research" ? "We couldn't reach paper discovery. Try again." : "We couldn't reach video discovery. Try again.",
          },
          lateInteractiveRefresh: true,
        },
      }).where(eq(recommendationRuns.id, run.id));
    });
    return;
  }
  if (external.resources.length === 0) return;
  const allResources = [
    ...catalogResources,
    ...external.resources.filter((resource) => !catalogResources.some((existing) => existing.provider === resource.provider && existing.externalId === resource.externalId)),
  ];
  const ranked = selectSourceResults(rankSourceResources(allResources, profile, query, mode, rankingIntent, new Date(), concept?.id));
  const qualifiedKeys = new Set(allResources
    .filter((resource) => sourceQuerySignals(resource, query, concept?.id).qualified)
    .map((resource) => `${resource.provider}:${resource.externalId}`));
  const enoughCoverage = qualifiedKeys.size >= sourceCoverageMinimum;
  await withUserTransaction(userId, async (tx) => {
    const runs = await tx.select().from(recommendationRuns).where(and(
      eq(recommendationRuns.id, runId),
      eq(recommendationRuns.userId, userId),
      eq(recommendationRuns.surface, "source_picker"),
      sql`${recommendationRuns.status} IN ('queued', 'running')`,
    )).limit(1);
    const run = runs[0];
    if (!run) return;
    const ephemeral = ranked
      .filter((candidate) => candidate.resource.id.startsWith("external:"))
      .slice(0, sourceResultLimit)
      .map((candidate) => sourceCandidate(candidate, run.id, mode, {
        sourceOrigin: "external_refresh",
        ...(typeof candidate.queryRelevance === "number" ? { queryRelevance: candidate.queryRelevance } : {}),
        ...(candidate.qualificationReason ? { qualificationReason: candidate.qualificationReason } : {}),
      }));
    const nextSnapshot = {
      ...run.contextSnapshot,
      refreshStatus: enoughCoverage ? "complete" : "requested",
      candidateDiagnostics: ranked.slice(0, sourceResultLimit).map((candidate) => ({
        resourceId: candidate.resource.id,
        sourceOrigin: candidate.resource.id.startsWith("external:") ? "external_refresh" : "catalog",
        queryRelevance: candidate.queryRelevance ?? candidate.semanticRelevance,
        qualificationReason: candidate.qualificationReason ?? null,
      })),
      ...(ephemeral.length > 0 ? { ephemeralCandidates: ephemeral } : {}),
      lateInteractiveRefresh: true,
    };
    await tx.update(recommendationRuns).set({
      status: enoughCoverage ? "completed" : "running",
      completedAt: enoughCoverage ? new Date() : null,
      contextSnapshot: nextSnapshot,
    }).where(eq(recommendationRuns.id, run.id));
  });
}

function responseFromFastRun(
  run: typeof recommendationRuns.$inferSelect,
  mode: SourceDiscoveryMode,
  query: string,
  ranked: RankedResource[],
  externalIds: Set<string>,
  retrieval: "memory" | "redis" | "catalog" | "live_web" | "blended",
  cacheState: "fresh" | "stale" | "miss",
  timings: { cacheMs: number; catalogMs: number; exaMs: number; providerMs: number; rankMs: number; persistMs: number; totalMs: number },
): SourceDiscoverySearchResponse {
  const diagnostics = new Map(ranked.map((candidate) => [candidate.resource.id, {
    sourceOrigin: externalIds.has(candidate.resource.id) ? "external_refresh" as const : "catalog" as const,
    ...(typeof candidate.queryRelevance === "number" ? { queryRelevance: candidate.queryRelevance } : {}),
    ...(candidate.qualificationReason ? { qualificationReason: candidate.qualificationReason } : {}),
  }]));
  const selected = selectSourceResults(ranked);
  return {
    status: run.status === "running" || run.status === "queued" ? "searching" : "completed",
    runId: run.id,
    mode,
    query,
    candidates: selected.map((candidate) => sourceCandidate(candidate, run.id, mode, diagnostics.get(candidate.resource.id))),
    retrieval,
    cacheState,
    timings,
  };
}

async function searchSourcesFast(userId: string, input: SourceDiscoverySearchRequest, scheduleDeferred: SourceDiscoveryDeferredWork): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const reusable = await withUserTransaction(userId, async (tx) => {
    const existing = await findReusableRun(tx, userId, input.mode, query, input.rankingIntent);
    if (!existing || (existing.status !== "completed" && existing.status !== "running")) return null;
    const response = await responseForRun(tx, existing, userId);
    return existing.status === "running" || response.candidates.length > 0 ? response : null;
  });
  if (reusable) return reusable;
  const started = performance.now();
  const localStarted = performance.now();
  const localPromise = withUserTransaction(userId, async (tx) => {
    const [profileLoad, concept] = await Promise.all([loadDiscoveryProfile(tx, userId), resolveConcept(tx, query)]);
    const resources = await loadDiscoveryResources(tx, undefined, userId, {
      mode: input.mode,
      query,
      resolvedConceptId: concept?.id ?? null,
      limit: 40,
    });
    return { profile: profileLoad.profile, concept, resources };
  }).then((value) => ({ ...value, catalogMs: performance.now() - localStarted }));
  const externalPromise = loadExternalPool(input.mode, query, input.rankingIntent, input.correlationId);
  const local = await localPromise;
  const catalogQualifiedCount = local.resources.filter((resource) => sourceQuerySignals(resource, query, local.concept?.id).qualified).length;
  let external = emptyExternalPool();
  let externalReady = false;
  if (catalogQualifiedCount < sourceCoverageMinimum) {
    const remainingBudget = Math.max(0, instantBudgetMs() - (performance.now() - started));
    const raced = await Promise.race([
      externalPromise.then((value) => ({ value })),
      deadline(remainingBudget).then(() => null),
    ]);
    if (raced) {
      external = raced.value;
      externalReady = true;
    }
  } else {
    void externalPromise.catch(() => undefined);
  }
  const allResources = [...local.resources, ...external.resources.filter((externalResource) => !local.resources.some((resource) => resource.provider === externalResource.provider && resource.externalId === externalResource.externalId))];
  const rankStarted = performance.now();
  const ranked = selectSourceResults(rankSourceResources(allResources, local.profile, query, input.mode, input.rankingIntent, new Date(), local.concept?.id));
  const rankMs = performance.now() - rankStarted;
  const externalIds = new Set(external.resources.map((resource) => resource.id));
  const persistStarted = performance.now();
  const baseTimings = {
    cacheMs: Number(external.cacheMs.toFixed(2)),
    catalogMs: Number(local.catalogMs.toFixed(2)),
    exaMs: Number(external.exaMs.toFixed(2)),
    providerMs: Number(external.exaMs.toFixed(2)),
    rankMs: Number(rankMs.toFixed(2)),
  };
  const run = await persistInteractiveRun(userId, input, query, local.concept, ranked, catalogQualifiedCount, external.resources, input.correlationId, baseTimings);
  const lateExternalPromise = catalogQualifiedCount < sourceCoverageMinimum
    ? external.revalidation ?? (external.providerFailed ? Promise.resolve(external) : externalReady ? null : externalPromise)
    : null;
  if (lateExternalPromise) {
    scheduleDeferred(async () => {
      try {
        const lateExternal = await lateExternalPromise;
        await finalizeInteractiveRun(userId, run.id, input.mode, query, input.rankingIntent, local.profile, local.resources, local.concept, lateExternal);
      } catch (error) {
        console.warn("source_discovery_late_refresh_failed", { runId: run.id, error: error instanceof Error ? error.name : "unknown" });
      }
    });
  }
  const persistMs = Number((performance.now() - persistStarted).toFixed(2));
  const retrieval = external.resources.length > 0
    ? local.resources.length > 0 ? "blended" : external.cacheHit ? external.cacheTier ?? "live_web" : "live_web"
    : "catalog";
  return responseFromFastRun(run, input.mode, query, ranked, externalIds, retrieval, external.cacheState, {
    ...baseTimings,
    persistMs,
    totalMs: Number((performance.now() - started).toFixed(2)),
  });
}


// The video agent (video-agent.ts) answers Learn-mode searches: it searches wide, checks every hit against YouTube, and a model
// picks and explains the best dozen. Its runs keep the picks in their context snapshot, in the agent's order.
const VIDEO_AGENT = "video-agent-v1";
const videoPickTtlSeconds = 6 * 60 * 60;
const videoPickMemory = new Map<string, { value: StoredVideoPicks; until: number }>();
type StoredVideoPicks = { picks: PickedVideo[]; searches: number; checked: number };

function videoPickKey(intent: VideoIntent, query: string): string {
  return `ls:v1:video-agent:${createHash("sha256").update(`${intent}\n${query.toLowerCase()}`).digest("hex")}`;
}

/** Model-ranked picks are shared across learners for a few hours: the same search should not pay for the same ranking twice. */
async function cachedVideoPicks(intent: VideoIntent, query: string): Promise<StoredVideoPicks | null> {
  const key = videoPickKey(intent, query);
  const memory = videoPickMemory.get(key);
  if (memory && memory.until > Date.now()) return memory.value;
  const stored = await getRedisValue(key).catch(() => null);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as StoredVideoPicks;
    return Array.isArray(value.picks) && value.picks.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function storeVideoPicks(intent: VideoIntent, query: string, value: StoredVideoPicks): Promise<void> {
  const key = videoPickKey(intent, query);
  videoPickMemory.set(key, { value, until: Date.now() + videoPickTtlSeconds * 1_000 });
  if (videoPickMemory.size > 256) videoPickMemory.delete(videoPickMemory.keys().next().value as string);
  await setRedisValue(key, JSON.stringify(value), videoPickTtlSeconds).catch(() => undefined);
}

/** Spends today's YouTube quota (shared with the worker; YouTube resets at midnight Pacific); false once the cap is reached. */
async function reserveYoutubeQuota(userId: string, units: number): Promise<boolean> {
  const configured = Number(process.env.YOUTUBE_DAILY_QUOTA_CAP ?? 9_000);
  const cap = Number.isFinite(configured) && configured > 0 ? configured : 9_000;
  // The conflict clause caps a day already counted; a day's first spend is checked here.
  if (units > cap) return false;
  try {
    return await withUserTransaction(userId, async (tx) => {
      const rows = await tx.execute(sql`
        INSERT INTO ops.api_usage_daily (provider, usage_date, units)
        VALUES ('youtube', (now() AT TIME ZONE 'America/Los_Angeles')::date, ${units})
        ON CONFLICT (provider, usage_date) DO UPDATE SET units = ops.api_usage_daily.units + EXCLUDED.units
          WHERE ops.api_usage_daily.units + EXCLUDED.units <= ${cap}
        RETURNING units`);
      return rows.length > 0;
    });
  } catch {
    return false;
  }
}

function videoCandidate(video: PickedVideo, index: number, runId: string): SourceDiscoveryCandidate {
  return {
    type: "video",
    provider: "youtube",
    externalId: video.youtubeId,
    title: video.title,
    description: video.description,
    canonicalUrl: `https://www.youtube.com/watch?v=${video.youtubeId}`,
    thumbnailUrl: video.thumbnailUrl,
    author: video.channel,
    durationMs: video.durationMs,
    publishedAt: video.publishedAt,
    reason: video.why,
    reasonCodes: [video.level, video.format].filter((value): value is NonNullable<typeof value> => value !== null),
    score: Number(video.prescore.toFixed(6)),
    candidateRank: index + 1,
    finalRank: index + 1,
    recommendationRunId: runId,
    sourceOrigin: "external_refresh",
    viewCount: video.views === null ? null : Math.round(video.views),
    level: video.level,
    format: video.format,
  };
}

/** What a run stores: the picks as candidates, and the synthetic ids resolveSource checks a chosen video against. */
function videoAgentSnapshot(run: typeof recommendationRuns.$inferSelect, picks: PickedVideo[], stage: "ranking" | "done", ranked: boolean, searches: number, checked: number) {
  return {
    ...run.contextSnapshot,
    agent: VIDEO_AGENT,
    agentStage: stage,
    agentRanked: ranked,
    agentSearches: searches,
    agentChecked: checked,
    refreshStatus: stage === "done" ? "complete" : "running",
    ephemeralCandidates: picks.map((video, index) => videoCandidate(video, index, run.id)),
    candidateDiagnostics: picks.map((video) => ({ resourceId: `external:youtube:${video.youtubeId}`, sourceOrigin: "external_refresh", qualificationReason: "video_agent_pick" })),
  };
}

function videoAgentResponse(run: typeof recommendationRuns.$inferSelect): SourceDiscoverySearchResponse {
  const snapshot = run.contextSnapshot;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const refreshError = runRefreshError(run, "learn");
  return {
    status: runStatus(run),
    runId: run.id,
    mode: "learn",
    query: run.queryText ?? "",
    candidates: ephemeralCandidates(run),
    agent: { stage: snapshot.agentStage === "ranking" ? "ranking" : "done", searches: number(snapshot.agentSearches), checked: number(snapshot.agentChecked), ranked: snapshot.agentRanked === true },
    ...(refreshError ? { refreshError } : {}),
  };
}

async function createVideoAgentRun(userId: string, query: string, intent: VideoIntent, status: "running" | "completed" | "failed", build: (run: typeof recommendationRuns.$inferSelect) => Record<string, unknown>) {
  return withUserTransaction(userId, async (tx) => {
    const [created] = await tx.insert(recommendationRuns).values({
      userId,
      surface: "source_picker",
      queryText: query,
      strategyVersion: DISCOVERY_STRATEGY_VERSION,
      featureVersion: DISCOVERY_FEATURE_VERSION,
      contextSnapshot: { mode: "learn", rankingIntent: intent, interactive: true, agent: VIDEO_AGENT },
      status,
      completedAt: status === "running" ? null : new Date(),
    }).returning();
    if (!created) throw new Error("Source discovery run could not be created");
    const [run] = await tx.update(recommendationRuns).set({ contextSnapshot: build(created) }).where(eq(recommendationRuns.id, created.id)).returning();
    return run ?? created;
  });
}

/**
 * A Learn-mode search: a cached ranking answers at once; otherwise the agent gathers and checks videos (a couple of seconds),
 * answers with them in a statistical order, and the model's ranking replaces that order when it lands (the picker polls the run).
 */
async function searchVideosWithAgent(userId: string, input: SourceDiscoverySearchRequest, scheduleDeferred: SourceDiscoveryDeferredWork): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const intent = input.rankingIntent as VideoIntent;
  const reusable = await withUserTransaction(userId, async (tx) => {
    const existing = await findReusableRun(tx, userId, "learn", query, input.rankingIntent);
    return existing?.contextSnapshot.agent === VIDEO_AGENT ? videoAgentResponse(existing) : null;
  });
  if (reusable && reusable.candidates.length > 0) return reusable;

  const cached = await cachedVideoPicks(intent, query);
  if (cached) {
    const run = await createVideoAgentRun(userId, query, intent, "completed", (created) => videoAgentSnapshot(created, cached.picks, "done", true, cached.searches, cached.checked));
    return videoAgentResponse(run);
  }

  const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim() || null;
  const exaApiKey = process.env.EXA_API_KEY?.trim() || null;
  const gathered = await gatherVideos(query, intent, { exaApiKey, youtubeApiKey, reserveYoutubeQuota: (units) => reserveYoutubeQuota(userId, units) });
  if (gathered.failures.length) console.warn("video_agent_lane_failures", { correlationId: input.correlationId, failures: gathered.failures });
  if (gathered.videos.length === 0) {
    // Nothing found while a search errored is an outage the learner can retry, not an honest "no videos for that".
    const failed = gathered.failures.length > 0;
    const run = await createVideoAgentRun(userId, query, intent, failed ? "failed" : "completed", (created) => ({
      ...videoAgentSnapshot(created, [], "done", false, gathered.searches, 0),
      ...(failed ? { refreshStatus: "failed", refreshError: { code: "DISCOVERY_PROVIDER_UNAVAILABLE", message: "We couldn't reach video search. Try again." } } : {}),
    }));
    return videoAgentResponse(run);
  }

  const provisional = provisionalPicks(gathered.videos);
  const checked = gathered.videos.length;
  const run = await createVideoAgentRun(userId, query, intent, "running", (created) => videoAgentSnapshot(created, provisional, "ranking", false, gathered.searches, checked));
  scheduleDeferred(async () => {
    const picks = await pickVideos(query, intent, gathered.videos);
    await withUserTransaction(userId, async (tx) => {
      const [current] = await tx.select().from(recommendationRuns).where(and(eq(recommendationRuns.id, run.id), eq(recommendationRuns.userId, userId))).limit(1);
      if (current?.status !== "running") return;
      await tx.update(recommendationRuns).set({
        status: "completed",
        completedAt: new Date(),
        contextSnapshot: videoAgentSnapshot(current, picks ?? provisional, "done", picks !== null, gathered.searches, checked),
      }).where(eq(recommendationRuns.id, run.id));
    }).catch((error: unknown) => console.warn("video_agent_finish_failed", { runId: run.id, error: error instanceof Error ? error.message : "unknown" }));
    if (picks) await storeVideoPicks(intent, query, { picks, searches: gathered.searches, checked });
  });
  return videoAgentResponse(run);
}

const interactiveSearches = new Map<string, Promise<SourceDiscoverySearchResponse>>();

function paperSearchCandidate(paper: ResearchPaper, rank: number, runId: string): SourceDiscoveryCandidate & Record<string, unknown> {
  return {
    type: "paper",
    provider: "arxiv",
    externalId: paper.arxivId,
    title: cleanLatexText(paper.title),
    description: cleanPaperText(paper.abstract),
    canonicalUrl: paper.canonicalUrl,
    thumbnailUrl: null,
    author: paper.authors[0]?.name ?? "arXiv",
    durationMs: null,
    publishedAt: paper.publishedAt,
    reason: "Exa-ranked research paper",
    reasonCodes: ["exa_match"],
    score: paper.score,
    candidateRank: rank,
    finalRank: rank,
    recommendationRunId: runId,
    sourceOrigin: "external_refresh",
    queryRelevance: Math.max(0, 1 - (rank - 1) / 30),
    venue: "arXiv",
  };
}

async function searchResearchSources(userId: string, input: SourceDiscoverySearchRequest): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const retrieval = await retrieveResearchPapers(query, {
    ...(process.env.EXA_API_KEY?.trim() ? { exaApiKey: process.env.EXA_API_KEY.trim() } : {}),
    timeoutMs: 4_000,
    rankingIntent: input.rankingIntent === "foundational" || input.rankingIntent === "recent" ? input.rankingIntent : "best_match",
  });
  const retrievalTimings = { ...(retrieval.papers.length ? { firstResultsMs: retrieval.durationMs } : {}), providerMs: retrieval.durationMs, totalMs: retrieval.durationMs };
  return withUserTransaction(userId, async (tx) => {
      const runStatus = retrieval.papers.length === 0 && retrieval.partialFailures.length > 0 ? "failed" : "completed";
      const [run] = await tx.insert(recommendationRuns).values({
        userId,
        surface: "source_picker",
        queryText: query,
        strategyVersion: DISCOVERY_STRATEGY_VERSION,
        featureVersion: DISCOVERY_FEATURE_VERSION,
        contextSnapshot: {
          mode: "research",
          rankingIntent: input.rankingIntent,
          researchRetrieval: true,
          intent: retrieval.intent,
          sourceCalls: retrieval.sourceCalls,
          partialFailures: retrieval.partialFailures,
          timings: retrievalTimings,
        },
        status: runStatus,
        completedAt: new Date(),
      }).returning();
      if (!run) throw new Error("Research discovery run could not be created");
      const candidates = retrieval.papers.map((paper, index) => paperSearchCandidate(paper, index + 1, run.id));
      await tx.update(recommendationRuns).set({ contextSnapshot: {
        ...run.contextSnapshot,
        ephemeralCandidates: candidates,
        candidateDiagnostics: candidates.map((candidate) => ({ resourceId: `external:${candidate.provider}:${candidate.externalId}`, sourceOrigin: "external_refresh", queryRelevance: candidate.queryRelevance })),
      } }).where(eq(recommendationRuns.id, run.id));
      const result: SourceDiscoverySearchResponse = {
        status: runStatus,
        runId: run.id,
        mode: "research",
        query,
        candidates: candidates as SourceDiscoveryCandidate[],
        retrieval: "live_web",
        cacheState: "miss",
        timings: retrievalTimings,
      };
      return result;
    });
}

export async function searchSources(userId: string, input: SourceDiscoverySearchRequest, scheduleDeferred: SourceDiscoveryDeferredWork = (work) => { void work(); }): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const key = createHash("sha256").update(`${userId}\n${input.mode}\n${input.rankingIntent}\n${query}`).digest("hex");
  const existing = interactiveSearches.get(key);
  if (existing) return existing;
  // Videos go to the search agent whenever it has a provider to search; papers (and a server with no video search keys, such
  // as CI and offline development) keep the catalog-and-Exa search above.
  const agent = input.mode === "learn" && Boolean(process.env.YOUTUBE_API_KEY?.trim() || process.env.EXA_API_KEY?.trim());
  const search = (input.mode === "research"
    ? searchResearchSources(userId, { ...input, query })
    : (agent ? searchVideosWithAgent(userId, { ...input, query }, scheduleDeferred) : searchSourcesFast(userId, { ...input, query }, scheduleDeferred)))
    .finally(() => interactiveSearches.delete(key));
  interactiveSearches.set(key, search);
  return search;
}

export async function getSourceDiscoveryRun(userId: string, runId: string): Promise<SourceDiscoverySearchResponse> {
  return withUserTransaction(userId, async (tx) => {
    const rows = await tx.select().from(recommendationRuns).where(and(eq(recommendationRuns.id, runId), eq(recommendationRuns.userId, userId), eq(recommendationRuns.surface, "source_picker"))).limit(1);
    const run = rows[0];
    if (!run) throw sourceError("RUN_NOT_FOUND", "That discovery search is no longer available.", 404);
    return responseForRun(tx, run, userId);
  });
}

type ResolvedData = { title: string; description: string | null; thumbnailUrl: string | null; author: string | null; durationMs: number | null; authors: string[]; venue: string | null; year: number | null; pdfUrl?: string | null; arxivId?: string | null };

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw sourceError("SOURCE_UNAVAILABLE", "The source provider could not be reached.", 502);
  const body: unknown = await response.json();
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function previewFrom(resourceId: string, parsed: NonNullable<ReturnType<typeof classifySourceUrl>>, data: ResolvedData): SourcePreview {
  return { resourceId, mode: parsed.mode, provider: parsed.provider, title: data.title, description: data.description, canonicalUrl: parsed.canonicalUrl, thumbnailUrl: data.thumbnailUrl, author: data.author, durationMs: data.durationMs, authors: data.authors, venue: data.venue, year: data.year, arxivId: parsed.provider === "arxiv" ? parsed.id : null, doi: parsed.provider === "doi" ? parsed.id : null, sourceOrigin: "direct_url" };
}

async function findExistingResource(tx: Transaction, userId: string, parsed: NonNullable<ReturnType<typeof classifySourceUrl>>) {
  const rows = await tx.select({ resource: resources, video: videoDetails, paper: paperDetails }).from(resources).leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id)).leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id)).where(and(eq(resources.provider, parsed.provider), eq(resources.externalId, parsed.id), or(isNull(resources.ownerUserId), eq(resources.ownerUserId, userId)), isNull(resources.deletedAt))).limit(1);
  return rows[0] ?? null;
}

async function ensureIngestionRequest(
  tx: Transaction,
  userId: string,
  resourceId: string,
  parsed: NonNullable<ReturnType<typeof classifySourceUrl>>,
  correlationId: string,
): Promise<void> {
  const existing = await tx.select({ id: outboxEvents.id }).from(outboxEvents).where(and(
    eq(outboxEvents.aggregateType, "resource"),
    eq(outboxEvents.aggregateId, resourceId),
    eq(outboxEvents.eventType, "resource.ingestion_requested"),
    eq(outboxEvents.userId, userId),
  )).limit(1);
  if (existing[0]) return;
  await tx.insert(outboxEvents).values({
    aggregateType: "resource",
    aggregateId: resourceId,
    eventType: "resource.ingestion_requested",
    schemaVersion: 1,
    userId,
    correlationId,
    payload: {
      resourceId,
      provider: parsed.provider,
      externalId: parsed.id,
      sourceUrl: parsed.canonicalUrl,
      sourceKind: parsed.mode === "learn" ? "video" : "paper",
      requestedBy: "source-picker",
    },
  });
}

async function linkSelectedRecommendation(
  tx: Transaction,
  userId: string,
  runId: string | undefined,
  parsed: NonNullable<ReturnType<typeof classifySourceUrl>>,
  resourceId: string,
): Promise<void> {
  if (!runId) return;
  const [run] = await tx.select({ id: recommendationRuns.id, contextSnapshot: recommendationRuns.contextSnapshot }).from(recommendationRuns).where(and(
    eq(recommendationRuns.id, runId),
    eq(recommendationRuns.userId, userId),
    eq(recommendationRuns.surface, "source_picker"),
  )).limit(1);
  const [persistedCandidate] = await tx
    .select({ resourceId: recommendationCandidates.resourceId })
    .from(recommendationCandidates)
    .innerJoin(resources, eq(resources.id, recommendationCandidates.resourceId))
    .where(and(
      eq(recommendationCandidates.recommendationRunId, runId),
      eq(resources.provider, parsed.provider),
      eq(resources.externalId, parsed.id),
    ))
    .limit(1);
  if (persistedCandidate) return;
  const syntheticId = `external:${parsed.provider}:${parsed.id}`;
  const diagnostics = arrayValue(run?.contextSnapshot.candidateDiagnostics);
  if (!run || !diagnostics.some((value) => recordValue(value, "resourceId") === syntheticId)) {
    throw sourceError("INVALID_RECOMMENDATION_CONTEXT", "That recommendation is no longer available.", 422);
  }
  const [existing] = await tx.select({ resourceId: recommendationCandidates.resourceId }).from(recommendationCandidates).where(and(
    eq(recommendationCandidates.recommendationRunId, runId),
    eq(recommendationCandidates.resourceId, resourceId),
  )).limit(1);
  if (existing) return;
  const [rankRow] = await tx.select({ maxRank: sql<number>`coalesce(max(${recommendationCandidates.candidateRank}), 0)` }).from(recommendationCandidates).where(eq(recommendationCandidates.recommendationRunId, runId));
  const queryRelevance = diagnostics.find((value) => recordValue(value, "resourceId") === syntheticId);
  const relevance = recordValue(queryRelevance, "queryRelevance");
  await tx.insert(recommendationCandidates).values({
    recommendationRunId: runId,
    resourceId,
    candidateRank: Number(rankRow?.maxRank ?? 0) + 1,
    finalRank: null,
    score: 0,
    semanticRelevance: typeof relevance === "number" ? relevance : null,
    qualityScore: 0.5,
    learnerAffinity: 0,
    masteryFit: null,
    coverageScore: 0,
    freshnessScore: 0.5,
    diversityPenalty: 0,
    reasonCodes: ["selected_before_persistence"],
    selected: true,
  }).onConflictDoNothing();
}

async function persistResolvedResource(tx: Transaction, userId: string, parsed: NonNullable<ReturnType<typeof classifySourceUrl>>, data: ResolvedData, correlationId: string, recommendationRunId?: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source-resolve:${userId}:${parsed.provider}:${parsed.id}`}, 0))`);
  const existing = await findExistingResource(tx, userId, parsed);
  if (existing) {
    if (!existing.resource.currentVersionId) await ensureIngestionRequest(tx, userId, existing.resource.id, parsed, correlationId);
    await linkSelectedRecommendation(tx, userId, recommendationRunId, parsed, existing.resource.id);
    return existing.resource.id;
  }
   const [resource] = await tx.insert(resources).values({ ownerUserId: userId, type: parsed.mode === "learn" ? "video" : "paper", provider: parsed.provider, externalId: parsed.id, canonicalUrl: parsed.canonicalUrl, title: data.title, description: data.description, visibility: "private", status: "pending", metadata: { ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}), ...(data.author ? { channelTitle: data.author } : {}), ...(data.authors.length > 0 ? { authors: data.authors } : {}), ...(data.venue ? { venue: data.venue } : {}), ...(data.year ? { year: data.year } : {}), ...(data.pdfUrl ? { pdfSourceUrl: data.pdfUrl } : {}), ...(data.arxivId ? { arxivId: data.arxivId } : {}), importedBy: "source-picker", ingestionStatus: "queued" } }).onConflictDoNothing().returning({ id: resources.id });
  const resourceId = resource?.id ?? (await findExistingResource(tx, userId, parsed))?.resource.id;
  if (!resourceId) throw new Error("Resolved resource could not be created");
  await ensureIngestionRequest(tx, userId, resourceId, parsed, correlationId);
  await linkSelectedRecommendation(tx, userId, recommendationRunId, parsed, resourceId);
  return resourceId;
}

export async function resolveSource(userId: string, input: SourceDiscoveryResolveRequest): Promise<SourcePreview> {
  const detectedMode = sourceModeForUrl(input.url);
  const parsed = classifySourceUrl(input.url);
  if (detectedMode && detectedMode !== input.mode) throw sourceError("SOURCE_MODE_MISMATCH", detectedMode === "learn" ? "This looks like a YouTube video. Videos are studied in Learn mode." : "This looks like a research paper. Research papers are opened in Research mode.", 409, { detectedMode });
  if (!parsed) throw sourceError(detectedMode ? "MALFORMED_SOURCE_URL" : "UNSUPPORTED_SOURCE_URL", detectedMode ? "That source URL is not valid." : "Use a YouTube, arXiv, or DOI URL.");

  let data: ResolvedData;
  const existing = await withUserTransaction(userId, (tx) => findExistingResource(tx, userId, parsed));
  if (existing) {
    const metadata = existing.resource.metadata ?? {};
    const authors = arrayValue(recordValue(existing.paper?.metadata, "authors") ?? recordValue(metadata, "authors")).filter((value): value is string => typeof value === "string");
    const rawDescription = existing.resource.description ?? existing.paper?.abstract ?? null;
    data = {
      title: parsed.mode === "research" ? cleanLatexText(existing.resource.title) : existing.resource.title,
      description: parsed.mode === "research" ? cleanPaperText(rawDescription) : rawDescription,
      thumbnailUrl: asString(recordValue(metadata, "thumbnailUrl")),
      author: existing.video?.channelTitle ?? authors[0] ?? existing.paper?.venue ?? null,
      durationMs: existing.video?.durationMs ?? null,
      authors,
      venue: existing.paper?.venue ?? null,
      year: existing.paper?.publicationDate ? new Date(existing.paper.publicationDate).getUTCFullYear() : null,
    };
  } else {
    try {
      if (parsed.provider === "youtube") {
        const body = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`);
        data = { title: asString(body.title) ?? "YouTube video", description: null, thumbnailUrl: asString(body.thumbnail_url), author: asString(body.author_name), durationMs: null, authors: [], venue: null, year: null };
      } else if (parsed.provider === "arxiv") {
        const paper = await resolveArxivMetadata(parsed.id);
        data = { title: paper.title, description: paper.abstract, thumbnailUrl: null, author: paper.authors[0] ?? null, durationMs: null, authors: paper.authors, venue: paper.venue, year: paper.year, pdfUrl: paper.pdfUrl, arxivId: paper.arxivId ?? parsed.id };
      } else {
        const paper = await resolveDoiMetadata(parsed.id);
        data = { title: paper.title, description: paper.abstract, thumbnailUrl: null, author: paper.authors[0] ?? null, durationMs: null, authors: paper.authors, venue: paper.venue, year: paper.year, pdfUrl: paper.pdfUrl, arxivId: paper.arxivId };
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw sourceError("SOURCE_UNAVAILABLE", "The source provider could not be reached.", 502);
    }
  }
  const resourceId = await withUserTransaction(userId, (tx) => persistResolvedResource(tx, userId, parsed, data, input.correlationId, input.recommendationRunId));
  return previewFrom(resourceId, parsed, data);
}

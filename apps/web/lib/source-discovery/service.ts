import { createHash } from "node:crypto";
import { withUserTransaction, type Transaction } from "@learnspace/db";
import { conceptAliases, concepts, outboxEvents, paperDetails, recommendationCandidates, recommendationRuns, resources, videoDetails } from "@learnspace/db/schema";
import type { SourceDiscoveryCandidate, SourceDiscoveryMode, SourceDiscoverySearchRequest, SourceDiscoverySearchResponse, SourcePreview, SourceRankingIntent } from "@learnspace/shared";
import { SOURCE_DISCOVERY_MAX_RESULTS, SOURCE_DISCOVERY_MIN_RESULTS, classifySourceUrl, normalizeQuery, sourceDiscoveryCandidateSchema, sourceDiscoveryInstantBatchSchema, sourceModeForUrl, type SourceDiscoveryResolveRequest } from "@learnspace/shared";
import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthError } from "../auth/errors";
import { loadDiscoveryProfile, loadDiscoveryResources } from "../discovery/service";
import { DISCOVERY_FEATURE_VERSION, DISCOVERY_STRATEGY_VERSION, rankSourceResources, sourceQuerySignals, type DiscoveryResource, type RankedResource } from "../discovery/ranker";
import { getSourceCandidatePool, setSourceCandidatePool } from "./cache";

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
    .sort((left, right) => left.candidateRank - right.candidateRank || right.score - left.score || left.resource.id.localeCompare(right.resource.id))
    .slice(0, sourceResultLimit)
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1, finalRank: index + 1 }));
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
    eq(recommendationRuns.status, "completed"),
    gte(recommendationRuns.createdAt, new Date(Date.now() - sourceRunReuseMs)),
    sql`${recommendationRuns.contextSnapshot}->>'mode' = ${mode}`,
    sql`${recommendationRuns.contextSnapshot}->>'rankingIntent' = ${rankingIntent}`,
    sql`${recommendationRuns.contextSnapshot}->>'refreshStatus' IN ('not_needed', 'done', 'complete')`,
  )).orderBy(desc(recommendationRuns.createdAt)).limit(1);
  return rows[0] ?? null;
}

async function finalizeRefreshRun(tx: Transaction, userId: string, run: typeof recommendationRuns.$inferSelect): Promise<typeof recommendationRuns.$inferSelect> {
  const profileLoad = await loadDiscoveryProfile(tx, userId);
  const candidateRows = await tx.select({ resourceId: recommendationCandidates.resourceId }).from(recommendationCandidates).where(eq(recommendationCandidates.recommendationRunId, run.id));
  const refreshedResourceIds = arrayValue(run.contextSnapshot.refreshedResourceIds).filter((id): id is string => typeof id === "string");
  const refreshedResourceSet = new Set(refreshedResourceIds);
  const initialResourceIds = candidateRows.map((row) => row.resourceId);
  const poolResourceIds = [...new Set([...refreshedResourceIds, ...initialResourceIds])];
  const ranked = selectSourceResults(rankSourceResources(
    await loadDiscoveryResources(tx, poolResourceIds, userId),
    profileLoad.profile,
    run.queryText ?? "",
    runMode(run),
    typeof run.contextSnapshot.rankingIntent === "string" ? run.contextSnapshot.rankingIntent : "best_match",
    new Date(),
    typeof run.contextSnapshot.canonicalConceptId === "string" ? run.contextSnapshot.canonicalConceptId : null,
  ));
  await tx.delete(recommendationCandidates).where(eq(recommendationCandidates.recommendationRunId, run.id));
  if (ranked.length > 0) {
    await tx.insert(recommendationCandidates).values(ranked.map((candidate) => ({
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
  const candidateDiagnostics = ranked.map((candidate) => ({
    resourceId: candidate.resource.id,
    sourceOrigin: refreshedResourceSet.has(candidate.resource.id) ? "external_refresh" : "catalog",
    queryRelevance: candidate.queryRelevance ?? candidate.semanticRelevance,
    qualificationReason: candidate.qualificationReason ?? null,
  }));
  const [completed] = await tx.update(recommendationRuns).set({ status: "completed", completedAt: run.completedAt ?? new Date(), contextSnapshot: { ...run.contextSnapshot, refreshStatus: "complete", refreshFinalized: true, candidateDiagnostics } }).where(eq(recommendationRuns.id, run.id)).returning();
  if (!completed) throw new Error("Source discovery refresh could not be finalized");
  return completed;
}

async function responseForRun(tx: Transaction, run: typeof recommendationRuns.$inferSelect, userId: string): Promise<SourceDiscoverySearchResponse> {
  if (run.contextSnapshot?.refreshStatus === "done" && run.status !== "failed") {
    return responseForRun(tx, await finalizeRefreshRun(tx, userId, run), userId);
  }
  const candidateRows = await tx.select().from(recommendationCandidates).where(eq(recommendationCandidates.recommendationRunId, run.id)).orderBy(recommendationCandidates.finalRank, recommendationCandidates.candidateRank).limit(sourceResultLimit);
  const resourcesForRun = await loadDiscoveryResources(tx, candidateRows.map((row) => row.resourceId), userId);
  const byId = new Map(resourcesForRun.map((resource) => [resource.id, resource]));
  const mode = runMode(run);
  if (run.status === "failed") throw sourceError("DISCOVERY_FAILED", mode === "research" ? "We couldn't finish finding relevant papers." : "We couldn't finish finding strong learning videos.", 502);
  const persistedCandidates = candidateRows.flatMap((row) => {
    const resource = byId.get(row.resourceId);
    if (!resource || row.finalRank === null) return [];
    const diagnostics = candidateDiagnostics(run, row.resourceId, row.semanticRelevance);
    return [sourceCandidate({
      resource,
      candidateRank: row.candidateRank,
      finalRank: row.finalRank,
      score: row.score,
      semanticRelevance: row.semanticRelevance ?? 0,
      qualityScore: row.qualityScore ?? 0.5,
      learnerAffinity: row.learnerAffinity ?? 0,
      masteryFit: row.masteryFit,
      coverageScore: row.coverageScore ?? 0,
      freshnessScore: row.freshnessScore ?? 0.5,
      diversityPenalty: row.diversityPenalty ?? 0,
      reasonCodes: Array.isArray(row.reasonCodes) ? row.reasonCodes.filter((code): code is string => typeof code === "string") : [],
      ...(typeof diagnostics.queryRelevance === "number" ? { queryRelevance: diagnostics.queryRelevance } : {}),
      ...(diagnostics.qualificationReason ? { qualificationReason: diagnostics.qualificationReason } : {}),
    }, run.id, mode, diagnostics)];
  });
  const candidates = [...persistedCandidates, ...ephemeralCandidates(run)]
    .sort((left, right) => (left.finalRank ?? Number.MAX_SAFE_INTEGER) - (right.finalRank ?? Number.MAX_SAFE_INTEGER) || left.candidateRank - right.candidateRank)
    .filter((candidate, index, all) => all.findIndex((other) => (other.resourceId ?? other.canonicalUrl ?? other.title) === (candidate.resourceId ?? candidate.canonicalUrl ?? candidate.title)) === index)
    .slice(0, sourceResultLimit);
  return {
    status: candidates.length > 0 ? "completed" : run.status === "running" || run.status === "queued" ? "searching" : "completed",
    runId: run.id,
    mode,
    query: run.queryText ?? "",
    candidates,
  };
}

async function enqueueRefresh(tx: Transaction, userId: string, runId: string, mode: SourceDiscoveryMode, query: string, concept: { id: string; name: string } | null, correlationId: string): Promise<void> {
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
      sourcePickerRunId: runId,
      source: "source-picker",
      refreshReason: "source_picker",
      requestedAt: new Date().toISOString(),
    },
  });
}

type InstantAgentBatch = z.infer<typeof sourceDiscoveryInstantBatchSchema>;
type ExternalPool = { resources: DiscoveryResource[]; cacheHit: boolean; cacheState: "fresh" | "stale" | "miss"; cacheTier: "memory" | "redis" | null; cacheMs: number; exaMs: number };

const instantRefreshes = new Map<string, Promise<DiscoveryResource[]>>();

function emptyExternalPool(): ExternalPool {
  return { resources: [], cacheHit: false, cacheState: "miss", cacheTier: null, cacheMs: 0, exaMs: 0 };
}

function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  return typeof metadata[key] === "string" && metadata[key] ? metadata[key] as string : null;
}

function dedupeExternalResources(resources: DiscoveryResource[]): DiscoveryResource[] {
  return [...new Map(resources.map((resource) => [`${resource.provider}:${resource.externalId}`, resource])).values()];
}

function externalResources(batch: InstantAgentBatch, mode: SourceDiscoveryMode): DiscoveryResource[] {
  if (mode === "learn") {
    return dedupeExternalResources(batch.youtube.flatMap((candidate) => {
      const parsed = classifySourceUrl(candidate.canonical_url);
      if (!parsed || parsed.provider !== "youtube") return [];
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
    if (!parsed || parsed.provider !== "arxiv") return [];
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
  const value = Number(process.env.SOURCE_DISCOVERY_INTERACTIVE_TIMEOUT_MS ?? 1_400);
  return Number.isFinite(value) ? Math.min(1_500, Math.max(500, value)) : 1_400;
}

function instantPoolKey(mode: SourceDiscoveryMode, rankingIntent: SourceRankingIntent, query: string): string {
  return createHash("sha256").update(`${mode}\n${rankingIntent}\n${query}`).digest("hex");
}

async function callInstantAgent(mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent, correlationId: string): Promise<{ resources: DiscoveryResource[]; exaMs: number } | null> {
  const agentUrl = process.env.SOURCE_DISCOVERY_AGENT_URL ?? process.env.DISCOVERY_AGENT_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!agentUrl || !token) return null;
  const started = performance.now();
  try {
    const response = await fetch(`${agentUrl.replace(/\/$/, "")}/internal/v1/discovery/instant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-service-token": token },
      body: JSON.stringify({
        query_text: query,
        source_kind: mode === "learn" ? "video" : "paper",
        ranking_intent: rankingIntent,
        limit: sourceResultLimit,
        trace_id: correlationId,
      }),
      signal: AbortSignal.timeout(instantBudgetMs()),
    });
    if (!response.ok) {
      console.warn("source_discovery_instant_failed", { correlationId, status: response.status });
      return null;
    }
    const parsed = sourceDiscoveryInstantBatchSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn("source_discovery_instant_invalid_response", { correlationId });
      return null;
    }
    if (parsed.data.failures.length > 0) console.warn("source_discovery_instant_provider_failure", { correlationId, failures: parsed.data.failures });
    return { resources: externalResources(parsed.data, mode), exaMs: performance.now() - started };
  } catch (error) {
    console.warn("source_discovery_instant_unavailable", { correlationId, error: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

async function refreshExternalPool(mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent, correlationId: string): Promise<{ resources: DiscoveryResource[]; exaMs: number }> {
  const key = instantPoolKey(mode, rankingIntent, query);
  const existing = instantRefreshes.get(key);
  if (existing) return { resources: await existing, exaMs: 0 };
  const refresh = callInstantAgent(mode, query, rankingIntent, correlationId).then(async (result) => {
    if (!result) return { resources: [], exaMs: 0 };
    void setSourceCandidatePool(mode, rankingIntent, query, result.resources);
    return result;
  }).finally(() => instantRefreshes.delete(key));
  instantRefreshes.set(key, refresh.then((result) => result.resources));
  return refresh;
}

async function loadExternalPool(mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent, correlationId: string): Promise<ExternalPool> {
  const cacheStarted = performance.now();
  const cached = await getSourceCandidatePool(mode, rankingIntent, query);
  const cacheMs = performance.now() - cacheStarted;
  if (cached) {
    if (cached.stale) void refreshExternalPool(mode, query, rankingIntent, correlationId);
    return { resources: cached.resources, cacheHit: true, cacheState: cached.stale ? "stale" : "fresh", cacheTier: cached.tier, cacheMs, exaMs: 0 };
  }
  const result = await refreshExternalPool(mode, query, rankingIntent, correlationId);
  return { ...result, cacheHit: false, cacheState: "miss", cacheTier: null, cacheMs };
}

function persistenceBatch(resourcesForPersistence: DiscoveryResource[], mode: SourceDiscoveryMode, conceptId: string | null): Record<string, unknown> {
  const matchedConceptIds = conceptId ? [conceptId] : [];
  const youtube = mode === "learn" ? resourcesForPersistence.map((resource) => ({
    youtube_id: resource.externalId,
    canonical_url: resource.canonicalUrl,
    title: resource.title,
    channel: resource.channelTitle,
    published_at: resource.publishedAt?.toISOString() ?? null,
    duration_ms: resource.durationMs,
    language: resource.language,
    matched_concept_ids: matchedConceptIds,
    learning_format: metadataString(resource.metadata, "learningFormat"),
    estimated_level: metadataString(resource.metadata, "estimatedLevel"),
    has_implementation: typeof resource.metadata.hasImplementation === "boolean" ? resource.metadata.hasImplementation : null,
    evidence: Array.isArray(resource.metadata.evidence) ? resource.metadata.evidence : [],
    confidence: Number(resource.metadata.sourceConfidence ?? resource.qualityScore ?? 0.6),
  })) : [];
  const arxiv = mode === "research" ? resourcesForPersistence.map((resource) => ({
    arxiv_id: resource.externalId,
    canonical_url: resource.canonicalUrl,
    title: resource.title,
    authors: resource.authors ?? [],
    abstract: resource.paperAbstract,
    published_at: resource.publicationDate?.toISOString() ?? null,
    categories: [],
    matched_concept_ids: matchedConceptIds,
    estimated_level: metadataString(resource.metadata, "estimatedLevel"),
    paper_class: metadataString(resource.metadata, "paperClass") === "foundational" ? "foundational" : "current",
    evidence: Array.isArray(resource.metadata.evidence) ? resource.metadata.evidence : [],
    confidence: Number(resource.metadata.sourceConfidence ?? resource.qualityScore ?? 0.6),
  })) : [];
  return { trace_id: `source-picker-${Date.now()}`, youtube, arxiv };
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
  const refreshStatus = qualifiedExternal.length > 0 ? "pending_persistence" : shouldRefresh ? "requested" : "not_needed";
  const status = ranked.length === 0 && shouldRefresh && qualifiedExternal.length === 0 ? "running" : "completed";
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
    if (qualifiedExternal.length > 0) {
      await tx.insert(outboxEvents).values({
        aggregateType: "recommendation_run",
        aggregateId: run.id,
        eventType: "discovery.candidates_discovered",
        schemaVersion: 1,
        userId,
        correlationId,
        payload: {
          sourcePickerRunId: run.id,
          queryText: query,
          sourceKind: input.mode === "learn" ? "video" : "paper",
          conceptIds: concept ? [concept.id] : [],
          candidateBatch: persistenceBatch(qualifiedExternal, input.mode, concept?.id ?? null),
        },
      });
    } else if (shouldRefresh) {
      await enqueueRefresh(tx, userId, run.id, input.mode, query, concept, correlationId);
    }
    return persistedRun;
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
  timings: { cacheMs: number; catalogMs: number; exaMs: number; rankMs: number; totalMs: number },
): SourceDiscoverySearchResponse {
  const diagnostics = new Map(ranked.map((candidate) => [candidate.resource.id, {
    sourceOrigin: externalIds.has(candidate.resource.id) ? "external_refresh" as const : "catalog" as const,
    ...(typeof candidate.queryRelevance === "number" ? { queryRelevance: candidate.queryRelevance } : {}),
    ...(candidate.qualificationReason ? { qualificationReason: candidate.qualificationReason } : {}),
  }]));
  const selected = selectSourceResults(ranked);
  return {
    status: selected.length > 0 ? "completed" : run.status === "running" ? "searching" : "completed",
    runId: run.id,
    mode,
    query,
    candidates: selected.map((candidate) => sourceCandidate(candidate, run.id, mode, diagnostics.get(candidate.resource.id))),
    retrieval,
    cacheState,
    timings,
  };
}

async function searchSourcesFast(userId: string, input: SourceDiscoverySearchRequest): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const reusable = await withUserTransaction(userId, async (tx) => {
    const existing = await findReusableRun(tx, userId, input.mode, query, input.rankingIntent);
    if (!existing || existing.status !== "completed") return null;
    const response = await responseForRun(tx, existing, userId);
    return response.candidates.length > 0 ? response : null;
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
  if (catalogQualifiedCount < sourceCoverageMinimum) {
    const remainingBudget = Math.max(0, instantBudgetMs() - (performance.now() - started));
    external = await Promise.race([externalPromise, deadline(remainingBudget)]) ?? emptyExternalPool();
  } else {
    void externalPromise.catch(() => undefined);
  }
  const allResources = [...local.resources, ...external.resources.filter((externalResource) => !local.resources.some((resource) => resource.provider === externalResource.provider && resource.externalId === externalResource.externalId))];
  const rankStarted = performance.now();
  const ranked = selectSourceResults(rankSourceResources(allResources, local.profile, query, input.mode, input.rankingIntent, new Date(), local.concept?.id));
  const rankMs = performance.now() - rankStarted;
  const externalIds = new Set(external.resources.map((resource) => resource.id));
  const run = await persistInteractiveRun(userId, input, query, local.concept, ranked, catalogQualifiedCount, external.resources, input.correlationId, {
    cacheMs: Number(external.cacheMs.toFixed(2)),
    catalogMs: Number(local.catalogMs.toFixed(2)),
    exaMs: Number(external.exaMs.toFixed(2)),
    rankMs: Number(rankMs.toFixed(2)),
    totalMs: Number((performance.now() - started).toFixed(2)),
  });
  const retrieval = external.resources.length > 0
    ? local.resources.length > 0 ? "blended" : external.cacheHit ? external.cacheTier ?? "live_web" : "live_web"
    : "catalog";
  return responseFromFastRun(run, input.mode, query, ranked, externalIds, retrieval, external.cacheState, {
    cacheMs: Number(external.cacheMs.toFixed(2)),
    catalogMs: Number(local.catalogMs.toFixed(2)),
    exaMs: Number(external.exaMs.toFixed(2)),
    rankMs: Number(rankMs.toFixed(2)),
    totalMs: Number((performance.now() - started).toFixed(2)),
  });
}

const interactiveSearches = new Map<string, Promise<SourceDiscoverySearchResponse>>();

export async function searchSources(userId: string, input: SourceDiscoverySearchRequest): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const key = createHash("sha256").update(`${userId}\n${input.mode}\n${input.rankingIntent}\n${query}`).digest("hex");
  const existing = interactiveSearches.get(key);
  if (existing) return existing;
  const search = searchSourcesFast(userId, { ...input, query }).finally(() => interactiveSearches.delete(key));
  interactiveSearches.set(key, search);
  return search;
}

export async function getSourceDiscoveryRun(userId: string, runId: string): Promise<SourceDiscoverySearchResponse> {
  return withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source-discovery-run:${userId}:${runId}`}, 0))`);
    const rows = await tx.select().from(recommendationRuns).where(and(eq(recommendationRuns.id, runId), eq(recommendationRuns.userId, userId), eq(recommendationRuns.surface, "source_picker"))).limit(1);
    const run = rows[0];
    if (!run) throw sourceError("RUN_NOT_FOUND", "That discovery search is no longer available.", 404);
    return responseForRun(tx, run, userId);
  });
}

type ResolvedData = { title: string; description: string | null; thumbnailUrl: string | null; author: string | null; durationMs: number | null; authors: string[]; venue: string | null; year: number | null };

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/atom+xml,text/xml,application/xml" } });
  if (!response.ok) throw sourceError("SOURCE_UNAVAILABLE", "The source provider could not be reached.", 502);
  const text = await response.text();
  if (text.length > 1_500_000) throw sourceError("SOURCE_UNAVAILABLE", "The source response was too large.", 502);
  return text;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw sourceError("SOURCE_UNAVAILABLE", "The source provider could not be reached.", 502);
  const body: unknown = await response.json();
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function xmlText(entry: string, tag: string): string | null {
  const value = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim();
  if (!value) return null;
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function paperMetadataFromXml(xml: string, arxivId: string): { title: string; abstract: string | null; authors: string[]; year: number | null; venue: string | null } {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1] ?? "";
  const published = xmlText(entry, "published");
  return {
    title: xmlText(entry, "title") ?? `arXiv paper ${arxivId}`,
    abstract: xmlText(entry, "summary"),
    authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value)),
    year: published ? new Date(published).getUTCFullYear() : null,
    venue: "arXiv",
  };
}

function paperMetadataFromCrossref(body: Record<string, unknown>, doi: string): { title: string; abstract: string | null; authors: string[]; year: number | null; venue: string | null } {
  const message = recordValue(body, "message");
  const title = asString(arrayValue(recordValue(message, "title"))[0]) ?? doi;
  const authors = arrayValue(recordValue(message, "author")).flatMap((author) => {
    const given = asString(recordValue(author, "given"));
    const family = asString(recordValue(author, "family"));
    return given || family ? [[given, family].filter(Boolean).join(" ")] : [];
  });
  const published = recordValue(message, "published-print") ?? recordValue(message, "published-online");
  const firstPart = arrayValue(arrayValue(recordValue(published, "date-parts"))[0]);
  return { title, abstract: asString(recordValue(message, "abstract"))?.replace(/<[^>]+>/g, "") ?? null, authors, year: typeof firstPart[0] === "number" ? firstPart[0] : null, venue: asString(arrayValue(recordValue(message, "container-title"))[0]) };
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
  const [resource] = await tx.insert(resources).values({ ownerUserId: userId, type: parsed.mode === "learn" ? "video" : "paper", provider: parsed.provider, externalId: parsed.id, canonicalUrl: parsed.canonicalUrl, title: data.title, description: data.description, visibility: "private", status: "pending", metadata: { ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}), ...(data.author ? { channelTitle: data.author } : {}), ...(data.authors.length > 0 ? { authors: data.authors } : {}), ...(data.venue ? { venue: data.venue } : {}), ...(data.year ? { year: data.year } : {}), importedBy: "source-picker", ingestionStatus: "queued" } }).onConflictDoNothing().returning({ id: resources.id });
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
    data = { title: existing.resource.title, description: existing.resource.description ?? existing.paper?.abstract ?? null, thumbnailUrl: asString(recordValue(metadata, "thumbnailUrl")), author: existing.video?.channelTitle ?? authors[0] ?? existing.paper?.venue ?? null, durationMs: existing.video?.durationMs ?? null, authors, venue: existing.paper?.venue ?? null, year: existing.paper?.publicationDate ? new Date(existing.paper.publicationDate).getUTCFullYear() : null };
  } else {
    try {
      if (parsed.provider === "youtube") {
        const body = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`);
        data = { title: asString(body.title) ?? "YouTube video", description: null, thumbnailUrl: asString(body.thumbnail_url), author: asString(body.author_name), durationMs: null, authors: [], venue: null, year: null };
      } else if (parsed.provider === "arxiv") {
        const paper = paperMetadataFromXml(await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(parsed.id)}`), parsed.id);
        data = { title: paper.title, description: paper.abstract, thumbnailUrl: null, author: paper.authors[0] ?? null, durationMs: null, authors: paper.authors, venue: paper.venue, year: paper.year };
      } else {
        const paper = paperMetadataFromCrossref(await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(parsed.id)}`), parsed.id);
        data = { title: paper.title, description: paper.abstract, thumbnailUrl: null, author: paper.authors[0] ?? null, durationMs: null, authors: paper.authors, venue: paper.venue, year: paper.year };
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw sourceError("SOURCE_UNAVAILABLE", "The source provider could not be reached.", 502);
    }
  }
  const resourceId = await withUserTransaction(userId, (tx) => persistResolvedResource(tx, userId, parsed, data, input.correlationId, input.recommendationRunId));
  return previewFrom(resourceId, parsed, data);
}

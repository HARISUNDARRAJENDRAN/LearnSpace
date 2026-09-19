import { withUserTransaction, type Transaction } from "@learnspace/db";
import { conceptAliases, concepts, outboxEvents, paperDetails, recommendationCandidates, recommendationRuns, resources, videoDetails } from "@learnspace/db/schema";
import type { SourceDiscoveryCandidate, SourceDiscoveryMode, SourceDiscoverySearchRequest, SourceDiscoverySearchResponse, SourcePreview, SourceRankingIntent } from "@learnspace/shared";
import { classifySourceUrl, normalizeQuery, sourceModeForUrl, type SourceDiscoveryResolveRequest } from "@learnspace/shared";
import { and, desc, eq, gte, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { loadDiscoveryProfile, loadDiscoveryResources } from "../discovery/service";
import { DISCOVERY_FEATURE_VERSION, DISCOVERY_STRATEGY_VERSION, rankSourceResources, type RankedResource } from "../discovery/ranker";

const sourceResultLimit = 5;
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

function sourceCandidate(candidate: RankedResource, runId: string, mode: SourceDiscoveryMode, diagnostics?: CandidateDiagnostics): SourceDiscoveryCandidate {
  const resource = candidate.resource;
  const reasonCodes = [...new Set(candidate.reasonCodes)].slice(0, 4);
  return {
    resourceId: resource.id,
    type: resource.type,
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
  const stopWords = new Set(["about", "does", "from", "how", "learn", "need", "should", "teach", "the", "their", "this", "want", "what", "work", "you"]);
  for (const token of normalized.split(/[^a-z0-9]+/).filter((value) => value.length > 2 && !stopWords.has(value))) {
    const tokenMatch = await tx.select({ id: concepts.id, name: concepts.name }).from(concepts).where(and(eq(concepts.status, "active"), ilike(concepts.name, `%${token}%`))).limit(1);
    if (tokenMatch[0]) return tokenMatch[0];
  }
  return null;
}

async function findReusableRun(tx: Transaction, userId: string, mode: SourceDiscoveryMode, query: string, rankingIntent: SourceRankingIntent): Promise<typeof recommendationRuns.$inferSelect | null> {
  const rows = await tx.select().from(recommendationRuns).where(and(
    eq(recommendationRuns.userId, userId),
    eq(recommendationRuns.surface, "source_picker"),
    eq(recommendationRuns.queryText, query),
    ne(recommendationRuns.status, "failed"),
    gte(recommendationRuns.createdAt, new Date(Date.now() - sourceRunReuseMs)),
    sql`${recommendationRuns.contextSnapshot}->>'mode' = ${mode}`,
    sql`${recommendationRuns.contextSnapshot}->>'rankingIntent' = ${rankingIntent}`,
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
  const ranked = rankSourceResources(
    await loadDiscoveryResources(tx, poolResourceIds, userId),
    profileLoad.profile,
    run.queryText ?? "",
    runMode(run),
    typeof run.contextSnapshot.rankingIntent === "string" ? run.contextSnapshot.rankingIntent : "best_match",
    new Date(),
    typeof run.contextSnapshot.canonicalConceptId === "string" ? run.contextSnapshot.canonicalConceptId : null,
  ).filter((candidate) => candidate.finalRank !== null).slice(0, sourceResultLimit);
  for (const [index, row] of candidateRows.entries()) {
    await tx.update(recommendationCandidates).set({
      candidateRank: -(index + 1),
      finalRank: null,
      selected: false,
    }).where(and(
      eq(recommendationCandidates.recommendationRunId, run.id),
      eq(recommendationCandidates.resourceId, row.resourceId),
    ));
  }
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
  const candidateRows = await tx.select().from(recommendationCandidates).where(eq(recommendationCandidates.recommendationRunId, run.id)).orderBy(recommendationCandidates.finalRank, recommendationCandidates.candidateRank).limit(24);
  const resourcesForRun = await loadDiscoveryResources(tx, candidateRows.map((row) => row.resourceId), userId);
  const byId = new Map(resourcesForRun.map((resource) => [resource.id, resource]));
  const mode = runMode(run);
  if (run.status === "failed") throw sourceError("DISCOVERY_FAILED", mode === "research" ? "We couldn't finish finding relevant papers." : "We couldn't finish finding strong learning videos.", 502);
  return {
    status: run.status === "running" || run.status === "queued" ? "searching" : "completed",
    runId: run.id,
    mode,
    query: run.queryText ?? "",
    candidates: candidateRows.flatMap((row) => {
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
    }).slice(0, sourceResultLimit),
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

async function createSearchRun(tx: Transaction, userId: string, input: SourceDiscoverySearchRequest): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  const profileLoad = await loadDiscoveryProfile(tx, userId);
  const concept = await resolveConcept(tx, query);
  const resourcesForRanker = await loadDiscoveryResources(tx, undefined, userId);
  const ranked = rankSourceResources(resourcesForRanker, profileLoad.profile, query, input.mode, input.rankingIntent, new Date(), concept?.id);
  const candidates = ranked.filter((candidate) => candidate.finalRank !== null).slice(0, sourceResultLimit);
  const qualifiedRelevantCandidates = ranked.filter((candidate) => candidate.finalRank !== null);
  const shouldRefresh = qualifiedRelevantCandidates.length < 3;
  const now = new Date();
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
      strategyVersion: DISCOVERY_STRATEGY_VERSION,
      refreshStatus: shouldRefresh ? "requested" : "not_needed",
      qualifiedCatalogCandidateCount: qualifiedRelevantCandidates.length,
      candidateDiagnostics: candidates.map((candidate) => ({
        resourceId: candidate.resource.id,
        sourceOrigin: "catalog",
        queryRelevance: candidate.queryRelevance ?? candidate.semanticRelevance,
        qualificationReason: candidate.qualificationReason ?? null,
      })),
    },
    status: shouldRefresh ? "running" : "completed",
    completedAt: shouldRefresh ? null : now,
  }).returning();
  if (!run) throw new Error("Source discovery run could not be created");
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
      selected: true,
    })));
  }
  if (shouldRefresh) await enqueueRefresh(tx, userId, run.id, input.mode, query, concept, input.correlationId);
  return responseForRun(tx, run, userId);
}

export async function searchSources(userId: string, input: SourceDiscoverySearchRequest): Promise<SourceDiscoverySearchResponse> {
  const query = normalizeQuery(input.query);
  return withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source-discovery:${userId}:${input.mode}:${input.rankingIntent}:${query}`}, 0))`);
    const existing = await findReusableRun(tx, userId, input.mode, query, input.rankingIntent);
    if (existing) return responseForRun(tx, existing, userId);
    return createSearchRun(tx, userId, { ...input, query });
  });
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

async function persistResolvedResource(tx: Transaction, userId: string, parsed: NonNullable<ReturnType<typeof classifySourceUrl>>, data: ResolvedData, correlationId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source-resolve:${userId}:${parsed.provider}:${parsed.id}`}, 0))`);
  const existing = await findExistingResource(tx, userId, parsed);
  if (existing) {
    if (!existing.resource.currentVersionId) await ensureIngestionRequest(tx, userId, existing.resource.id, parsed, correlationId);
    return existing.resource.id;
  }
  const [resource] = await tx.insert(resources).values({ ownerUserId: userId, type: parsed.mode === "learn" ? "video" : "paper", provider: parsed.provider, externalId: parsed.id, canonicalUrl: parsed.canonicalUrl, title: data.title, description: data.description, visibility: "private", status: "pending", metadata: { ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}), ...(data.author ? { channelTitle: data.author } : {}), ...(data.authors.length > 0 ? { authors: data.authors } : {}), ...(data.venue ? { venue: data.venue } : {}), ...(data.year ? { year: data.year } : {}), importedBy: "source-picker", ingestionStatus: "queued" } }).onConflictDoNothing().returning({ id: resources.id });
  const resourceId = resource?.id ?? (await findExistingResource(tx, userId, parsed))?.resource.id;
  if (!resourceId) throw new Error("Resolved resource could not be created");
  await ensureIngestionRequest(tx, userId, resourceId, parsed, correlationId);
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
  const resourceId = await withUserTransaction(userId, (tx) => persistResolvedResource(tx, userId, parsed, data, input.correlationId));
  return previewFrom(resourceId, parsed, data);
}

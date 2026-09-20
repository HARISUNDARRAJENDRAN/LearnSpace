import { z } from "zod";
import { isAllowedYoutubeHost, youtubeIdFromUrl } from "./discovery.js";

export const SOURCE_MODES = ["learn", "research"] as const;
export const SOURCE_DISCOVERY_MIN_RESULTS = 3;
export const SOURCE_DISCOVERY_MAX_RESULTS = 30;
export const sourceDiscoveryModeSchema = z.enum(SOURCE_MODES);
export type SourceDiscoveryMode = z.infer<typeof sourceDiscoveryModeSchema>;

export const SOURCE_RANKING_INTENTS = [
  "best_match",
  "beginner_friendly",
  "in_depth",
  "practical",
  "foundational",
  "recent",
] as const;
export const sourceRankingIntentSchema = z.enum(SOURCE_RANKING_INTENTS);
export type SourceRankingIntent = z.infer<typeof sourceRankingIntentSchema>;

const LEARN_RANKING_INTENTS = ["best_match", "beginner_friendly", "in_depth", "practical"] as const;
const RESEARCH_RANKING_INTENTS = ["best_match", "foundational", "recent"] as const;

export const sourceDiscoverySearchRequestSchema = z.object({
  mode: sourceDiscoveryModeSchema,
  query: z.string().trim().min(1).max(240),
  rankingIntent: sourceRankingIntentSchema.default("best_match"),
  correlationId: z.string().uuid(),
}).superRefine((value, context) => {
  const allowed = value.mode === "learn" ? LEARN_RANKING_INTENTS : RESEARCH_RANKING_INTENTS;
  if (!allowed.includes(value.rankingIntent as never)) {
    context.addIssue({
      code: "custom",
      path: ["rankingIntent"],
      message: `${value.rankingIntent} is not valid for ${value.mode} mode`,
    });
  }
});

export const sourceDiscoveryResolveRequestSchema = z.object({
  mode: sourceDiscoveryModeSchema,
  url: z.string().trim().min(1).max(2_048),
  correlationId: z.string().uuid(),
  recommendationRunId: z.string().uuid().optional(),
});

export type SourceDiscoverySearchRequest = z.infer<typeof sourceDiscoverySearchRequestSchema>;
export type SourceDiscoveryResolveRequest = z.infer<typeof sourceDiscoveryResolveRequestSchema>;

export type SourceProvider = "youtube" | "arxiv" | "doi";

export type ClassifiedSourceUrl = {
  provider: SourceProvider;
  mode: SourceDiscoveryMode;
  id: string;
  canonicalUrl: string;
};

const arxivIdPattern = /^(?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i;

function cleanUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

export function arxivIdFromUrl(value: string): string | null {
  const url = cleanUrl(value);
  if (!url || url.search || !["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(/^\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/i);
  const id = match?.[1] ?? null;
  return id && arxivIdPattern.test(id) ? id.toLowerCase().replace(/v\d+$/i, "") : null;
}

export function doiFromUrl(value: string): string | null {
  const url = cleanUrl(value);
  if (!url || !["doi.org", "www.doi.org"].includes(url.hostname.toLowerCase()) || url.search) return null;
  try {
    const doi = decodeURIComponent(url.pathname.slice(1)).trim();
    return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function classifySourceUrl(value: string): ClassifiedSourceUrl | null {
  const youtubeId = youtubeIdFromUrl(value);
  if (youtubeId) {
    return { provider: "youtube", mode: "learn", id: youtubeId, canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}` };
  }
  const arxivId = arxivIdFromUrl(value);
  if (arxivId) {
    return { provider: "arxiv", mode: "research", id: arxivId, canonicalUrl: `https://arxiv.org/abs/${arxivId}` };
  }
  const doi = doiFromUrl(value);
  if (doi) {
    return { provider: "doi", mode: "research", id: doi, canonicalUrl: `https://doi.org/${doi}` };
  }
  return null;
}

export function sourceModeForUrl(value: string): SourceDiscoveryMode | null {
  const parsed = classifySourceUrl(value);
  if (parsed) return parsed.mode;
  try {
    const url = new URL(value.trim());
    if (isAllowedYoutubeHost(url.hostname)) return "learn";
    if (["arxiv.org", "export.arxiv.org", "doi.org", "www.doi.org"].includes(url.hostname.toLowerCase())) return "research";
  } catch {
    // The caller will report malformed URLs separately.
  }
  return null;
}

export const sourceDiscoveryReasonSchema = z.enum([
  "query_phrase_match",
  "query_concept_match",
  "query_high_relevance",
  "beginner_intent_match",
  "practical_intent_match",
  "depth_intent_match",
  "good_concept_coverage",
  "fits_your_level",
  "practical_examples",
  "in_depth",
  "matches_how_you_learn",
  "foundational_paper",
  "recent_work",
  "learner_affinity",
  "level_fit",
  "format_fit",
]);

export type SourceDiscoveryReason = z.infer<typeof sourceDiscoveryReasonSchema>;

export const sourceDiscoveryCandidateSchema = z.object({
  resourceId: z.string().uuid().optional(),
  type: z.enum(["video", "paper"]),
  provider: z.enum(["youtube", "arxiv", "doi"]).optional(),
  externalId: z.string().optional(),
  title: z.string(),
  description: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  author: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  publishedAt: z.string().nullable(),
  reason: z.string(),
  reasonCodes: z.array(z.string()),
  score: z.number(),
  candidateRank: z.number().int().positive(),
  finalRank: z.number().int().positive().nullable(),
  recommendationRunId: z.string().uuid().nullable().optional(),
  sourceOrigin: z.enum(["catalog", "external_refresh", "direct_url"]).optional(),
  queryRelevance: z.number().min(0).max(1).optional(),
  qualificationReason: z.string().optional(),
});

export type SourceDiscoveryCandidate = z.infer<typeof sourceDiscoveryCandidateSchema>;

export const sourceDiscoveryAgentYoutubeCandidateSchema = z.object({
  youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  canonical_url: z.string().url(),
  title: z.string().min(3).max(500),
  channel: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  language: z.string().nullable().optional(),
  learning_format: z.string().nullable().optional(),
  estimated_level: z.string().nullable().optional(),
  has_implementation: z.boolean().nullable().optional(),
  evidence: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

export const sourceDiscoveryAgentArxivCandidateSchema = z.object({
  arxiv_id: z.string().min(3).max(100),
  canonical_url: z.string().url(),
  title: z.string().min(3).max(500),
  authors: z.array(z.string()).optional(),
  abstract: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  estimated_level: z.string().nullable().optional(),
  paper_class: z.enum(["current", "foundational"]).optional(),
  evidence: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

export const sourceDiscoveryInstantBatchSchema = z.object({
  trace_id: z.string(),
  youtube: z.array(sourceDiscoveryAgentYoutubeCandidateSchema).max(SOURCE_DISCOVERY_MAX_RESULTS).default([]),
  arxiv: z.array(sourceDiscoveryAgentArxivCandidateSchema).max(SOURCE_DISCOVERY_MAX_RESULTS).default([]),
  cache_hit: z.boolean().default(false),
  failures: z.array(z.string()).default([]),
  provider_calls: z.number().int().nonnegative().default(0),
});

export type SourceDiscoveryInstantBatch = z.infer<typeof sourceDiscoveryInstantBatchSchema>;

export const sourcePreviewSchema = z.object({
  resourceId: z.string().uuid(),
  mode: sourceDiscoveryModeSchema,
  provider: z.enum(["youtube", "arxiv", "doi"]),
  title: z.string(),
  description: z.string().nullable(),
  canonicalUrl: z.string(),
  thumbnailUrl: z.string().nullable(),
  author: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  authors: z.array(z.string()),
  venue: z.string().nullable(),
  year: z.number().int().nullable(),
  arxivId: z.string().nullable(),
  doi: z.string().nullable(),
  sourceOrigin: z.literal("direct_url").optional(),
});

export type SourcePreview = z.infer<typeof sourcePreviewSchema>;

export const sourceDiscoverySearchResponseSchema = z.object({
  status: z.enum(["completed", "searching", "preview"]),
  runId: z.string().uuid().nullable(),
  mode: sourceDiscoveryModeSchema,
  query: z.string(),
  candidates: z.array(sourceDiscoveryCandidateSchema).max(SOURCE_DISCOVERY_MAX_RESULTS),
  preview: sourcePreviewSchema.optional(),
  retrieval: z.enum(["memory", "redis", "catalog", "live_web", "blended"]).optional(),
  cacheState: z.enum(["fresh", "stale", "miss"]).optional(),
  timings: z.object({
    cacheMs: z.number().nonnegative().optional(),
    catalogMs: z.number().nonnegative().optional(),
    exaMs: z.number().nonnegative().optional(),
    rankMs: z.number().nonnegative().optional(),
    totalMs: z.number().nonnegative().optional(),
  }).optional(),
});

export type SourceDiscoverySearchResponse = z.infer<typeof sourceDiscoverySearchResponseSchema>;

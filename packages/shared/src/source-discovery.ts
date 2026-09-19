import { z } from "zod";
import { isAllowedYoutubeHost, youtubeIdFromUrl } from "./discovery.js";

export const SOURCE_MODES = ["learn", "research"] as const;
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

export const sourceDiscoverySearchRequestSchema = z.object({
  mode: sourceDiscoveryModeSchema,
  query: z.string().trim().min(1).max(240),
  rankingIntent: sourceRankingIntentSchema.default("best_match"),
  correlationId: z.string().uuid(),
});

export const sourceDiscoveryResolveRequestSchema = z.object({
  mode: sourceDiscoveryModeSchema,
  url: z.string().trim().min(1).max(2_048),
  correlationId: z.string().uuid(),
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
  return id && arxivIdPattern.test(id) ? id.toLowerCase() : null;
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
  "strong_topic_match",
  "highly_relevant",
  "good_concept_coverage",
  "fits_your_level",
  "practical_examples",
  "matches_how_you_learn",
  "foundational_paper",
  "recent_work",
]);

export type SourceDiscoveryReason = z.infer<typeof sourceDiscoveryReasonSchema>;

export const sourceDiscoveryCandidateSchema = z.object({
  resourceId: z.string().uuid(),
  type: z.enum(["video", "paper"]),
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
  recommendationRunId: z.string().uuid(),
});

export type SourceDiscoveryCandidate = z.infer<typeof sourceDiscoveryCandidateSchema>;

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
});

export type SourcePreview = z.infer<typeof sourcePreviewSchema>;

export const sourceDiscoverySearchResponseSchema = z.object({
  status: z.enum(["completed", "searching", "preview"]),
  runId: z.string().uuid().nullable(),
  mode: sourceDiscoveryModeSchema,
  query: z.string(),
  candidates: z.array(sourceDiscoveryCandidateSchema),
  preview: sourcePreviewSchema.optional(),
});

export type SourceDiscoverySearchResponse = z.infer<typeof sourceDiscoverySearchResponseSchema>;

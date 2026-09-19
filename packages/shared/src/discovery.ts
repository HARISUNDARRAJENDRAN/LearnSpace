import { z } from "zod";
import { DISCOVERY_ACTIONS, RECOMMENDATION_SURFACES } from "./domain-values.js";

export const DISCOVERY_LEARNING_FORMATS = [
  "clear_explanations",
  "deep_dive",
  "hands_on",
  "research_backed",
  "quick_learning",
  "conversational",
  "mixed",
] as const;
export type DiscoveryLearningFormat = (typeof DISCOVERY_LEARNING_FORMATS)[number];

export const discoverySurfaceSchema = z.enum(RECOMMENDATION_SURFACES);
export const discoveryActionSchema = z.enum(DISCOVERY_ACTIONS);

const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function isAllowedYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be";
}

export function youtubeIdFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase();
    if (!isAllowedYoutubeHost(host)) return null;
    const id = host === "youtu.be"
      ? parsed.pathname.slice(1)
      : parsed.searchParams.get("v") ?? parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
    return id && youtubeIdPattern.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function canonicalYoutubeUrl(youtubeId: string): string {
  if (!youtubeIdPattern.test(youtubeId)) throw new Error("Invalid YouTube ID");
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

export const discoveryImpressionRequestSchema = z.object({
  runId: z.string().uuid(),
  resourceId: z.string().uuid(),
  position: z.number().int().nonnegative(),
  surface: discoverySurfaceSchema,
  visibleDurationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  traceId: z.string().min(1).max(128).optional(),
});

export const discoveryInteractionRequestSchema = z.object({
  runId: z.string().uuid().optional(),
  impressionId: z.string().uuid().optional(),
  resourceId: z.string().uuid(),
  action: discoveryActionSchema,
  correlationId: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type DiscoverySurface = z.infer<typeof discoverySurfaceSchema>;
export type DiscoveryAction = z.infer<typeof discoveryActionSchema>;
export type DiscoveryImpressionRequest = z.infer<typeof discoveryImpressionRequestSchema>;
export type DiscoveryInteractionRequest = z.infer<typeof discoveryInteractionRequestSchema>;

export type DiscoveryCard = {
  resourceId: string;
  type: "video" | "paper";
  title: string;
  description: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  author: string | null;
  durationMs: number | null;
  publishedAt: string | null;
  reason: string;
  reasonCodes: string[];
  position: number;
  runId: string;
  score: number;
};

export type DiscoveryHomeResponse = {
  runId: string | null;
  generatedAt: string;
  stale: boolean;
  sections: {
    continueLearning: DiscoveryCard[];
    recommendedVideos: DiscoveryCard[];
    researchPapers: DiscoveryCard[];
    freshForYou: DiscoveryCard[];
    interests: Array<{ id: string; slug: string; name: string; kind: string }>;
  };
};

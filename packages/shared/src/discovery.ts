import { z } from "zod";
import { DISCOVERY_ACTIONS, RECOMMENDATION_SURFACES } from "./domain-values.js";

export const discoverySurfaceSchema = z.enum(RECOMMENDATION_SURFACES);
export const discoveryActionSchema = z.enum(DISCOVERY_ACTIONS);

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

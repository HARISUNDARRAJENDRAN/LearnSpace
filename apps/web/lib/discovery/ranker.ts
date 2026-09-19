export const DISCOVERY_STRATEGY_VERSION = "cold-start-v3";
export const DISCOVERY_FEATURE_VERSION = "discovery-v2";

export const DISCOVERY_EXPLORATION_CONFIG = {
  version: "exploration-v1",
  emergingConceptMatchMultiplier: 0.85,
  emergingAffinityMultiplier: 0.8,
  adjacentConceptMatchMultiplier: 0.45,
  adjacentAffinityMultiplier: 0.4,
  adjacentBehaviorMultiplier: 0.25,
  emergingThreshold: 0.1,
} as const;

export const DISCOVERY_BEHAVIOR_CONFIG = {
  version: "behavior-v2",
  minimumRelevance: 0.35,
  strongRelevance: 0.7,
  fullRelevance: 0.9,
  secondaryMultiplier: 0.7,
  adjacentSourceRelevance: 0.7,
  adjacentBehaviorMultiplier: 0.25,
} as const;

export const DISCOVERY_REFRESH_CONFIG = {
  version: "refresh-v1",
  catalogCoverageFloor: 12,
} as const;

export const VIDEO_RANKING_WEIGHTS = {
  conceptMatch: 0.3,
  learnerAffinity: 0.2,
  quality: 0.15,
  levelFit: 0.1,
  formatFit: 0.1,
  durationFit: 0.05,
  freshness: 0.05,
  exploration: 0.05,
} as const;

export const PAPER_RANKING_WEIGHTS = {
  conceptMatch: 0.3,
  learnerAffinity: 0.2,
  researchIntent: 0.15,
  levelFit: 0.1,
  recency: 0.1,
  sourcePrior: 0.1,
  exploration: 0.05,
} as const;

export type LearnerAffinity = {
  conceptId: string;
  score: number;
  confidence: number;
  positiveWeight?: number;
  negativeWeight?: number;
  featureVersion: string;
  lastEventAt?: Date | null;
  updatedAt?: Date | null;
};

export type LearnerProfile = {
  conceptIds: string[];
  coreConceptIds?: string[];
  emergingConceptIds?: string[];
  adjacentConceptIds?: string[];
  conceptNames: Map<string, string>;
  affinities: Map<string, LearnerAffinity>;
  persona: string | null;
  learningIntents: string[];
  preferredFormats: string[];
  preferredDuration: string | null;
  selfReportedLevel: "beginner" | "intermediate" | "advanced" | "mixed" | null;
};

export type DiscoveryResource = {
  id: string;
  type: "video" | "paper";
  provider: string;
  externalId: string | null;
  canonicalUrl: string | null;
  title: string;
  description: string | null;
  language: string | null;
  qualityScore: number | null;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  authors?: string[];
  durationMs: number | null;
  publishedAt: Date | null;
  paperAbstract: string | null;
  venue: string | null;
  publicationDate: Date | null;
  citationCount: number | null;
  metadata: Record<string, unknown>;
  concepts: Array<{ id: string; name: string; relevance: number }>;
  quality: {
    finalQualityScore: number;
    freshnessPrior: number | null;
    sourceAuthority: number | null;
  } | null;
};

export type RankedResource = {
  resource: DiscoveryResource;
  candidateRank: number;
  finalRank: number | null;
  score: number;
  semanticRelevance: number;
  qualityScore: number;
  learnerAffinity: number;
  masteryFit: number | null;
  coverageScore: number;
  freshnessScore: number;
  diversityPenalty: number;
  reasonCodes: string[];
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function stableExploration(id: string): number {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 0.25 + ((hash >>> 0) % 750) / 1000;
}

function ageInDays(value: Date | null, now: Date): number | null {
  if (!value) {
    return null;
  }
  return Math.max(0, (now.getTime() - value.getTime()) / 86_400_000);
}

function freshness(value: Date | null, now: Date, halfLifeDays: number): number {
  const age = ageInDays(value, now);
  return age === null ? 0.5 : Math.exp(-age / halfLifeDays);
}

function coreConceptIds(profile: LearnerProfile): string[] {
  return profile.coreConceptIds ?? profile.conceptIds;
}

function adjacentConceptIds(profile: LearnerProfile): string[] {
  return profile.adjacentConceptIds ?? [];
}

function emergingConceptIds(profile: LearnerProfile): string[] {
  return profile.emergingConceptIds ?? [];
}

function conceptMatch(resource: DiscoveryResource, profile: LearnerProfile): number {
  return resource.concepts.reduce((best, concept) => {
    const relevance = clamp(concept.relevance);
    if (coreConceptIds(profile).includes(concept.id)) return Math.max(best, relevance);
    if (emergingConceptIds(profile).includes(concept.id)) {
      return Math.max(best, relevance * DISCOVERY_EXPLORATION_CONFIG.emergingConceptMatchMultiplier);
    }
    if (adjacentConceptIds(profile).includes(concept.id)) {
      return Math.max(best, relevance * DISCOVERY_EXPLORATION_CONFIG.adjacentConceptMatchMultiplier);
    }
    return best;
  }, 0);
}

function learnerAffinity(resource: DiscoveryResource, profile: LearnerProfile): number {
  const matches = resource.concepts
    .filter((concept) => coreConceptIds(profile).includes(concept.id) || emergingConceptIds(profile).includes(concept.id) || adjacentConceptIds(profile).includes(concept.id))
    .map((concept) => {
      const affinity = profile.affinities.get(concept.id);
      if (!affinity) {
        return adjacentConceptIds(profile).includes(concept.id) ? 0.25 : 0.5;
      }
      const value = clamp(((affinity.score + 1) / 2) * affinity.confidence);
      if (emergingConceptIds(profile).includes(concept.id)) {
        return value * DISCOVERY_EXPLORATION_CONFIG.emergingAffinityMultiplier;
      }
      return adjacentConceptIds(profile).includes(concept.id)
        ? value * DISCOVERY_EXPLORATION_CONFIG.adjacentAffinityMultiplier
        : value;
    });
  return matches.length === 0 ? 0 : Math.max(...matches);
}

function levelFit(resource: DiscoveryResource, profile: LearnerProfile): number {
  const estimated = metadataText(resource.metadata, "estimatedLevel");
  if (!estimated || !profile.selfReportedLevel || profile.selfReportedLevel === "mixed") {
    return estimated ? 0.75 : 0.5;
  }
  return estimated === profile.selfReportedLevel ? 1 : 0.35;
}

function formatFit(resource: DiscoveryResource, profile: LearnerProfile): number {
  if (profile.preferredFormats.length === 0) {
    return 0.5;
  }
  const format = metadataText(resource.metadata, "learningFormat");
  return format ? (profile.preferredFormats.includes(format) ? 1 : 0.25) : 0.5;
}

function durationFit(resource: DiscoveryResource, profile: LearnerProfile): number {
  if (!profile.preferredDuration || profile.preferredDuration === "no_preference") {
    return 1;
  }
  if (!resource.durationMs) {
    return 0.5;
  }
  const minutes = resource.durationMs / 60_000;
  if (profile.preferredDuration === "under_10_minutes") {
    return minutes < 10 ? 1 : 0.25;
  }
  if (profile.preferredDuration === "ten_to_thirty_minutes") {
    return minutes >= 10 && minutes <= 30 ? 1 : 0.35;
  }
  return minutes >= 30 && minutes <= 60 ? 1 : 0.35;
}

function quality(resource: DiscoveryResource): number {
  return clamp(resource.quality?.finalQualityScore ?? resource.qualityScore ?? 0.5);
}

function resourceCoverage(resource: DiscoveryResource): number {
  return clamp((resource.title.trim() ? 0.5 : 0) + (resource.description?.trim() ? 0.5 : 0));
}

function paperResearchIntent(profile: LearnerProfile): number {
  const researchIntents = new Set([
    "read_papers",
    "follow_research_area",
    "literature_review",
    "discover_related_work",
    "teaching_preparation",
    "research",
  ]);
  if (profile.persona === "researcher") {
    return 1;
  }
  return profile.learningIntents.some((intent) => researchIntents.has(intent)) ? 1 : 0.3;
}

function paperSourcePrior(resource: DiscoveryResource): number {
  const sourceAuthority = resource.quality?.sourceAuthority;
  const citationPrior = resource.citationCount === null ? 0.5 : clamp(Math.log10(resource.citationCount + 1) / 4);
  const foundational = metadataText(resource.metadata, "paperClass") === "foundational" ? 1 : 0.5;
  return clamp((sourceAuthority ?? 0.5) * 0.45 + citationPrior * 0.35 + foundational * 0.2);
}

function reasonCodes(resource: DiscoveryResource, components: {
  conceptMatch: number;
  learnerAffinity: number;
  levelFit: number;
  formatFit?: number;
  freshness?: number;
  recency?: number;
  researchIntent?: number;
}): string[] {
  const reasons: string[] = [];
  if (components.conceptMatch >= 0.5) reasons.push("concept_match");
  else if (components.conceptMatch >= 0.2) reasons.push("adjacent_concept");
  if (components.learnerAffinity >= 0.55) reasons.push("learner_affinity");
  if (components.levelFit >= 0.75) reasons.push("level_fit");
  if ((components.formatFit ?? 0) >= 0.75) reasons.push("format_fit");
  if ((components.researchIntent ?? 0) >= 0.75) reasons.push("research_intent");
  if ((components.freshness ?? components.recency ?? 0) >= 0.65) reasons.push("fresh");
  if (reasons.length === 0) reasons.push("explore");
  return reasons;
}

function diversify(scored: RankedResource[], limit: number): RankedResource[] {
  const remaining = [...scored];
  const selected: RankedResource[] = [];
  const channelCounts = new Map<string, number>();
  const conceptCounts = new Map<string, number>();

  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (!candidate) continue;
      const channel = candidate.resource.channelTitle ?? "unknown";
      const duplicateChannelPenalty = (channelCounts.get(channel) ?? 0) * 0.04;
      const duplicateConceptPenalty = candidate.resource.concepts.reduce(
        (total, concept) => total + (conceptCounts.get(concept.id) ?? 0) * 0.02,
        0,
      );
      const penalty = clamp(duplicateChannelPenalty + duplicateConceptPenalty, 0, 0.25);
      const adjusted = candidate.score - penalty;
      if (adjusted > bestAdjusted || (adjusted === bestAdjusted && candidate.resource.id < (remaining[bestIndex]?.resource.id ?? ""))) {
        bestIndex = index;
        bestAdjusted = adjusted;
      }
    }
    const candidate = remaining.splice(bestIndex, 1)[0];
    if (!candidate) break;
    const channel = candidate.resource.channelTitle ?? "unknown";
    const duplicateChannelPenalty = (channelCounts.get(channel) ?? 0) * 0.04;
    const duplicateConceptPenalty = candidate.resource.concepts.reduce(
      (total, concept) => total + (conceptCounts.get(concept.id) ?? 0) * 0.02,
      0,
    );
    const penalty = clamp(duplicateChannelPenalty + duplicateConceptPenalty, 0, 0.25);
    selected.push({
      ...candidate,
      finalRank: selected.length + 1,
      diversityPenalty: penalty,
    });
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    for (const concept of candidate.resource.concepts) {
      conceptCounts.set(concept.id, (conceptCounts.get(concept.id) ?? 0) + 1);
    }
  }

  const selectedIds = new Set(selected.map((candidate) => candidate.resource.id));
  return scored.map((candidate) => selected.find((item) => item.resource.id === candidate.resource.id) ?? {
    ...candidate,
    finalRank: null,
    diversityPenalty: candidate.diversityPenalty,
  }).map((candidate) => selectedIds.has(candidate.resource.id) ? candidate : { ...candidate, finalRank: null });
}

function rankVideos(resources: DiscoveryResource[], profile: LearnerProfile, now: Date): RankedResource[] {
  const scored = resources.map((resource, index) => {
    const components = {
      conceptMatch: conceptMatch(resource, profile),
      learnerAffinity: learnerAffinity(resource, profile),
      quality: quality(resource),
      levelFit: levelFit(resource, profile),
      formatFit: formatFit(resource, profile),
      durationFit: durationFit(resource, profile),
      freshness: freshness(resource.publishedAt, now, 365),
      exploration: stableExploration(resource.id),
    };
    const score =
      VIDEO_RANKING_WEIGHTS.conceptMatch * components.conceptMatch +
      VIDEO_RANKING_WEIGHTS.learnerAffinity * components.learnerAffinity +
      VIDEO_RANKING_WEIGHTS.quality * components.quality +
      VIDEO_RANKING_WEIGHTS.levelFit * components.levelFit +
      VIDEO_RANKING_WEIGHTS.formatFit * components.formatFit +
      VIDEO_RANKING_WEIGHTS.durationFit * components.durationFit +
      VIDEO_RANKING_WEIGHTS.freshness * components.freshness +
      VIDEO_RANKING_WEIGHTS.exploration * components.exploration;
    return {
      resource,
      candidateRank: index + 1,
      finalRank: null,
      score,
      semanticRelevance: components.conceptMatch,
      qualityScore: components.quality,
      learnerAffinity: components.learnerAffinity,
      masteryFit: null,
      coverageScore: resourceCoverage(resource),
      freshnessScore: components.freshness,
      diversityPenalty: 0,
      reasonCodes: reasonCodes(resource, components),
    } satisfies RankedResource;
  }).sort((left, right) => right.score - left.score || left.resource.id.localeCompare(right.resource.id))
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1 }));
  return diversify(scored, Math.min(24, scored.length));
}

function rankPapers(resources: DiscoveryResource[], profile: LearnerProfile, now: Date): RankedResource[] {
  const scored = resources.map((resource, index) => {
    const components = {
      conceptMatch: conceptMatch(resource, profile),
      learnerAffinity: learnerAffinity(resource, profile),
      researchIntent: paperResearchIntent(profile),
      levelFit: levelFit(resource, profile),
      recency: metadataText(resource.metadata, "paperClass") === "foundational"
        ? 0.75
        : freshness(resource.publicationDate ?? resource.publishedAt, now, 540),
      sourcePrior: paperSourcePrior(resource),
      exploration: stableExploration(resource.id),
    };
    const score =
      PAPER_RANKING_WEIGHTS.conceptMatch * components.conceptMatch +
      PAPER_RANKING_WEIGHTS.learnerAffinity * components.learnerAffinity +
      PAPER_RANKING_WEIGHTS.researchIntent * components.researchIntent +
      PAPER_RANKING_WEIGHTS.levelFit * components.levelFit +
      PAPER_RANKING_WEIGHTS.recency * components.recency +
      PAPER_RANKING_WEIGHTS.sourcePrior * components.sourcePrior +
      PAPER_RANKING_WEIGHTS.exploration * components.exploration;
    return {
      resource,
      candidateRank: index + 1,
      finalRank: null,
      score,
      semanticRelevance: components.conceptMatch,
      qualityScore: components.sourcePrior,
      learnerAffinity: components.learnerAffinity,
      masteryFit: null,
      coverageScore: resourceCoverage(resource),
      freshnessScore: components.recency,
      diversityPenalty: 0,
      reasonCodes: reasonCodes(resource, components),
    } satisfies RankedResource;
  }).sort((left, right) => right.score - left.score || left.resource.id.localeCompare(right.resource.id))
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1 }));
  return diversify(scored, Math.min(12, scored.length));
}

export function rankDiscoveryResources(resources: DiscoveryResource[], profile: LearnerProfile, now: Date): {
  videos: RankedResource[];
  papers: RankedResource[];
} {
  return {
    videos: rankVideos(resources.filter((resource) => resource.type === "video"), profile, now),
    papers: rankPapers(resources.filter((resource) => resource.type === "paper"), profile, now),
  };
}

function queryTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1))];
}

function queryRelevance(resource: DiscoveryResource, query: string): number {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;
  const text = [resource.title, resource.description, resource.paperAbstract, resource.channelTitle, resource.venue, ...(resource.authors ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const title = resource.title.toLowerCase();
  const matched = tokens.filter((token) => text.includes(token)).length / tokens.length;
  const titleMatched = tokens.filter((token) => title.includes(token)).length / tokens.length;
  return clamp(matched * 0.65 + titleMatched * 0.35);
}

export function rankSourceResources(
  resources: DiscoveryResource[],
  profile: LearnerProfile,
  query: string,
  mode: "learn" | "research",
  rankingIntent: string,
  now: Date,
): RankedResource[] {
  const base = mode === "learn"
    ? rankDiscoveryResources(resources, profile, now).videos
    : rankDiscoveryResources(resources, profile, now).papers;
  const ranked = base.map((candidate) => {
    const relevance = queryRelevance(candidate.resource, query);
    const metadataLevel = metadataText(candidate.resource.metadata, "estimatedLevel");
    const durationMinutes = candidate.resource.durationMs ? candidate.resource.durationMs / 60_000 : 0;
    const intentBoost = rankingIntent === "beginner_friendly" && metadataLevel === "beginner"
      ? 0.2
      : rankingIntent === "in_depth" && durationMinutes >= 20
        ? 0.15
        : rankingIntent === "practical" && metadataText(candidate.resource.metadata, "learningFormat") === "hands_on"
          ? 0.2
          : rankingIntent === "foundational" && metadataText(candidate.resource.metadata, "paperClass") === "foundational"
            ? 0.2
            : rankingIntent === "recent" && candidate.resource.publicationDate && now.getTime() - candidate.resource.publicationDate.getTime() < 365 * 86_400_000
              ? 0.2
              : 0;
    const reasonCodes = [...candidate.reasonCodes];
    if (relevance >= 0.55) reasonCodes.unshift("strong_topic_match");
    else if (relevance >= 0.25) reasonCodes.unshift("highly_relevant");
    if (candidate.resource.concepts.length > 0) reasonCodes.push("good_concept_coverage");
    if (intentBoost > 0) reasonCodes.push(rankingIntent === "foundational" ? "foundational_paper" : rankingIntent === "recent" ? "recent_work" : rankingIntent === "practical" ? "practical_examples" : rankingIntent === "beginner_friendly" ? "fits_your_level" : "matches_how_you_learn");
    return { ...candidate, score: candidate.score * 0.35 + relevance * 0.5 + intentBoost * 0.15, semanticRelevance: relevance, reasonCodes: [...new Set(reasonCodes)] };
  }).sort((left, right) => right.score - left.score || left.resource.id.localeCompare(right.resource.id))
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1, finalRank: null }));
  return diversify(ranked, Math.min(5, ranked.length));
}

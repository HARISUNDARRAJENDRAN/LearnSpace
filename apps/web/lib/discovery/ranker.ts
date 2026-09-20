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

export const SOURCE_QUERY_RELEVANCE_THRESHOLD = 0.5;
const sourceCandidatePoolLimit = 100;

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
  queryRelevance?: number;
  qualificationReason?: string;
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

function rankVideos(resources: DiscoveryResource[], profile: LearnerProfile, now: Date, diversityLimit = 24): RankedResource[] {
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
  return diversify(scored, Math.min(diversityLimit, scored.length));
}

function rankPapers(resources: DiscoveryResource[], profile: LearnerProfile, now: Date, diversityLimit = 12): RankedResource[] {
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
  return diversify(scored, Math.min(diversityLimit, scored.length));
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

const SOURCE_QUERY_STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "by", "can", "does", "for", "from", "how", "in", "is", "of", "on", "or", "the", "to", "what", "with",
  "best", "course", "explain", "explained", "explanation", "guide", "learn", "learning", "lesson", "paper", "research", "study", "tutorial", "video",
]);

const SOURCE_QUERY_INTENT_WORDS = new Set([
  "advanced", "basic", "beginner", "deep", "detailed", "dive", "expert", "foundational", "fundamental", "intro", "introduction", "novice", "practical", "project", "recent", "starter",
]);

type SourceQueryIntent = "beginner" | "practical" | "depth" | "foundational" | "recent" | null;

export type SourceQuerySignals = {
  relevance: number;
  qualified: boolean;
  qualificationReason: string | null;
  phraseMatch: boolean;
  topicTitleCoverage: number;
  topicDescriptionCoverage: number;
  canonicalCoverage: number;
  canonicalRelevance: number;
  nonCanonicalTopicCoverage: number;
  intent: SourceQueryIntent;
  intentFit: number;
};

function normalizedToken(token: string): string {
  const normalized = token.toLowerCase();
  if (normalized.length > 4 && normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  if (normalized.length > 4 && normalized.endsWith("s") && !normalized.endsWith("ss")) return normalized.slice(0, -1);
  return normalized;
}

function lexicalTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizedToken)
    .filter((token) => token.length > 1);
}

function queryTokens(query: string): string[] {
  return [...new Set(lexicalTokens(query).filter((token) => !SOURCE_QUERY_STOP_WORDS.has(token)))];
}

function textTokens(value: string): Set<string> {
  return new Set(lexicalTokens(value));
}

function oneEditAway(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + (left.length - leftIndex) + (right.length - rightIndex) <= 1;
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  return oneEditAway(queryToken, candidateToken);
}

function hasMatchingToken(queryToken: string, values: Set<string>): boolean {
  for (const value of values) {
    if (tokenMatches(queryToken, value)) return true;
  }
  return false;
}

function coverage(tokens: string[], values: Set<string>): number {
  return tokens.length === 0 ? 0 : tokens.filter((token) => hasMatchingToken(token, values)).length / tokens.length;
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return haystack.some((_, index) => needle.every((token, offset) => tokenMatches(token, haystack[index + offset] ?? "")));
}

function queryIntent(tokens: string[]): SourceQueryIntent {
  if (tokens.some((token) => ["beginner", "basic", "fundamental", "intro", "introduction", "novice", "starter"].includes(token))) return "beginner";
  if (tokens.some((token) => ["practical", "project", "implementation"].includes(token))) return "practical";
  if (tokens.some((token) => ["advanced", "deep", "depth", "detailed", "dive", "expert"].includes(token))) return "depth";
  if (tokens.includes("foundational")) return "foundational";
  if (tokens.includes("recent")) return "recent";
  return null;
}

function intentFit(resource: DiscoveryResource, intent: SourceQueryIntent, referenceDate = new Date()): number {
  if (!intent) return 0.5;
  const level = metadataText(resource.metadata, "estimatedLevel");
  const format = metadataText(resource.metadata, "learningFormat");
  const paperClass = metadataText(resource.metadata, "paperClass");
  const hasImplementation = resource.metadata.hasImplementation === true;
  const evidence = textTokens([
    resource.title,
    resource.description,
    resource.paperAbstract,
    level,
    format,
    paperClass,
  ].filter(Boolean).join(" "));
  if (intent === "beginner") {
    if (level === "beginner" || ["basic", "beginner", "fundamental", "intro", "introduction", "novice", "starter"].some((token) => evidence.has(token))) return 1;
    return level === "advanced" || evidence.has("advanced") || evidence.has("expert") || evidence.has("experienced") || evidence.has("production") ? 0 : 0.5;
  }
  if (intent === "practical") {
    if (hasImplementation || format === "hands_on" || ["implementation", "practical", "project"].some((token) => evidence.has(token))) return 1;
    return 0.5;
  }
  if (intent === "depth") {
    if (format === "deep_dive" || resource.durationMs !== null && resource.durationMs >= 20 * 60_000 || ["advanced", "deep", "depth", "detailed", "expert"].some((token) => evidence.has(token))) return 1;
    return 0;
  }
  if (intent === "foundational") return paperClass === "foundational" || evidence.has("foundational") ? 1 : 0;
  return resource.publicationDate !== null && referenceDate.getTime() - resource.publicationDate.getTime() <= 365 * 86_400_000 ? 1 : 0;
}

function requestedIntent(rankingIntent: string): SourceQueryIntent {
  if (rankingIntent === "beginner_friendly") return "beginner";
  if (rankingIntent === "practical") return "practical";
  if (rankingIntent === "in_depth") return "depth";
  if (rankingIntent === "foundational") return "foundational";
  if (rankingIntent === "recent") return "recent";
  return null;
}

export function sourceQuerySignals(resource: DiscoveryResource, query: string, resolvedConceptId?: string | null): SourceQuerySignals {
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return { relevance: 0, qualified: false, qualificationReason: null, phraseMatch: false, topicTitleCoverage: 0, topicDescriptionCoverage: 0, canonicalCoverage: 0, canonicalRelevance: 0, nonCanonicalTopicCoverage: 0, intent: null, intentFit: 0 };
  }
  const intent = queryIntent(tokens);
  const topicTokens = tokens.filter((token) => !SOURCE_QUERY_INTENT_WORDS.has(token));
  const titleTokens = lexicalTokens(resource.title);
  const metadataEvidence = Array.isArray(resource.metadata.evidence)
    ? resource.metadata.evidence.filter((value): value is string => typeof value === "string").join(" ")
    : "";
  const descriptionSet = textTokens([resource.description, resource.paperAbstract, metadataEvidence].filter(Boolean).join(" "));
  const titleSet = new Set(titleTokens);
  const topicTitleCoverage = coverage(topicTokens, titleSet);
  const topicDescriptionCoverage = coverage(topicTokens, descriptionSet);
  const phraseMatch = containsTokenSequence(titleTokens.filter((token) => !SOURCE_QUERY_STOP_WORDS.has(token)), tokens);
  const canonical = resource.concepts.find((item) => item.id === resolvedConceptId);
  const canonicalRelevance = canonical ? clamp(canonical.relevance) : 0;
  const canonicalTerms = canonical ? textTokens(canonical.name) : new Set<string>();
  const canonicalCoverage = coverage(tokens, canonicalTerms);
  const nonCanonicalTopicTokens = topicTokens.filter((token) => !hasMatchingToken(token, canonicalTerms));
  const nonCanonicalTopicCoverage = coverage(nonCanonicalTopicTokens, new Set([...titleSet, ...descriptionSet]));
  const evidenceSet = new Set([...titleSet, ...descriptionSet]);
  const topicEvidenceCoverage = coverage(topicTokens, evidenceSet);
  const titleAnchorMatch = topicTokens.some((token) => token.length >= 3 && hasMatchingToken(token, titleSet));
  const anchoredEvidenceMatch = titleAnchorMatch && topicEvidenceCoverage >= (topicTokens.length > 1 ? 0.75 : 1);
  const lexical = phraseMatch
    ? 1
    : clamp(Math.max(topicTitleCoverage * 0.65 + topicDescriptionCoverage * 0.25, anchoredEvidenceMatch ? topicEvidenceCoverage * 0.85 : 0));
  const canonicalQueryOnly = topicTokens.length > 0 && nonCanonicalTopicTokens.length === 0;
  const canonicalContextMatch = canonicalRelevance >= 0.5 && canonicalCoverage >= 0.5 && (
    nonCanonicalTopicCoverage >= 0.25
    || (canonicalQueryOnly && (!intent || topicTitleCoverage >= 0.5 || topicDescriptionCoverage >= 0.25))
  );
  const relevance = clamp(Math.max(lexical, canonicalContextMatch ? Math.max(0.55, canonicalRelevance * (0.55 + canonicalCoverage * 0.45)) : 0));
  const matchedIntent = intentFit(resource, intent);
  const intentAdjustedRelevance = intent && matchedIntent < 0.5 ? Math.min(relevance, 0.52) : relevance;
  const strongLexicalMatch = phraseMatch || topicTitleCoverage >= 0.75 || anchoredEvidenceMatch || (topicTokens.length > 1 && topicTitleCoverage >= 0.5 && topicDescriptionCoverage >= 0.5);
  const qualified = intentAdjustedRelevance > SOURCE_QUERY_RELEVANCE_THRESHOLD
    && (strongLexicalMatch || canonicalContextMatch)
    && (!intent || matchedIntent > 0.5);
  return {
    relevance: intentAdjustedRelevance,
    qualified,
    qualificationReason: qualified
      ? phraseMatch ? "query_phrase_match" : canonicalContextMatch && !strongLexicalMatch ? "query_concept_match" : "query_high_relevance"
      : null,
    phraseMatch,
    topicTitleCoverage,
    topicDescriptionCoverage,
    canonicalCoverage,
    canonicalRelevance,
    nonCanonicalTopicCoverage,
    intent,
    intentFit: matchedIntent,
  };
}

export function sourceQueryRelevance(resource: DiscoveryResource, query: string, resolvedConceptId?: string | null): number {
  return sourceQuerySignals(resource, query, resolvedConceptId).relevance;
}

function sourceReasonCodes(candidate: RankedResource, signals: SourceQuerySignals, rankingIntent: string, requestedFit: number): string[] {
  const reasons: string[] = [];
  if (signals.phraseMatch) reasons.push("query_phrase_match");
  else if (signals.qualificationReason === "query_concept_match") reasons.push("query_concept_match");
  else reasons.push("query_high_relevance");
  if (signals.intent === "beginner" && signals.intentFit >= 0.75) reasons.push("beginner_intent_match");
  if (signals.intent === "practical" && signals.intentFit >= 0.75) reasons.push("practical_intent_match");
  if (signals.intent === "depth" && signals.intentFit >= 0.75) reasons.push("depth_intent_match");
  if (requestedFit >= 0.75) {
    reasons.push(rankingIntent === "foundational" ? "foundational_paper" : rankingIntent === "recent" ? "recent_work" : rankingIntent === "practical" ? "practical_examples" : rankingIntent === "beginner_friendly" ? "fits_your_level" : rankingIntent === "in_depth" ? "in_depth" : "matches_how_you_learn");
  }
  if (candidate.reasonCodes.includes("learner_affinity")) reasons.push("learner_affinity");
  if (candidate.reasonCodes.includes("level_fit")) reasons.push("level_fit");
  if (candidate.reasonCodes.includes("format_fit")) reasons.push("format_fit");
  if (candidate.resource.concepts.length > 0) reasons.push("good_concept_coverage");
  return [...new Set(reasons)];
}

export function rankSourceResources(
  resources: DiscoveryResource[],
  profile: LearnerProfile,
  query: string,
  mode: "learn" | "research",
  rankingIntent: string,
  now: Date,
  resolvedConceptId?: string | null,
): RankedResource[] {
  // ponytail: keep source-picker retrieval bounded at 100 until indexed query retrieval is wired into this path.
  const signalsById = new Map(resources.map((resource) => [resource.id, sourceQuerySignals(resource, query, resolvedConceptId)]));
  const relevantResources = resources
    .filter((resource) => (
      resource.type === (mode === "learn" ? "video" : "paper")
        && signalsById.get(resource.id)?.qualified === true
    ))
    .sort((left, right) => (signalsById.get(right.id)?.relevance ?? 0) - (signalsById.get(left.id)?.relevance ?? 0) || left.id.localeCompare(right.id))
    .slice(0, sourceCandidatePoolLimit);
  const base = mode === "learn"
    ? rankVideos(relevantResources, profile, now, relevantResources.length)
    : rankPapers(relevantResources, profile, now, relevantResources.length);
  const ranked = base.map((candidate) => {
    const signals = signalsById.get(candidate.resource.id);
    if (!signals) return candidate;
    const relevance = signals.relevance;
    const requestedFit = intentFit(candidate.resource, requestedIntent(rankingIntent), now);
    const reasonCodes = sourceReasonCodes(candidate, signals, rankingIntent, requestedFit);
    return {
      ...candidate,
      score: relevance * 0.65 + requestedFit * 0.15 + candidate.qualityScore * 0.1 + candidate.score * 0.05 + candidate.learnerAffinity * 0.05,
      semanticRelevance: relevance,
      queryRelevance: relevance,
      ...(signals.qualificationReason ? { qualificationReason: signals.qualificationReason } : {}),
      reasonCodes,
    };
  }).sort((left, right) => right.score - left.score || left.resource.id.localeCompare(right.resource.id))
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1, finalRank: null }));
  return diversify(ranked, Math.min(30, ranked.length));
}

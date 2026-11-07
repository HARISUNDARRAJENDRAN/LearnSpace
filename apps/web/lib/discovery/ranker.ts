import { RECOMMENDATION_CONFIG as recommendationConfig } from "@learnspace/shared/recommendation-config";
import { observedAffinity, personalizationWeights, type LearnerAffinity } from "./learner-model";
export type { LearnerAffinity } from "./learner-model";

export const DISCOVERY_STRATEGY_VERSION = "adaptive-learning-v1";
export const DISCOVERY_FEATURE_VERSION = "discovery-v5";

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
  version: "behavior-v3",
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
  conceptMatch: 0.24,
  learnerAffinity: 0.16,
  quality: 0.18,
  levelFit: 0.08,
  formatFit: 0.07,
  durationFit: 0.05,
  freshness: 0.03,
  exploration: 0.02,
  masteryFit: 0.07,
  continuity: 0.05,
  goalFit: 0.03,
  intentFit: 0.02,
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

export type MasteryState = { score: number; uncertainty: number; evidenceCount: number; nextReviewAt: Date | null; updatedAt: Date };

export type LearnerProfile = {
  conceptIds: string[];
  recentInterests?: Record<string, number>;
  longTermInterests?: Record<string, number>;
  semanticRanking?: boolean;
  completedIntroConceptIds?: string[];
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
  onboardingAt?: Date | null;
  preferredLanguages?: string[];
  goalConceptIds?: string[];
  sessionConceptIds?: string[];
  prerequisites?: Array<{ sourceConceptId: string; targetConceptId: string }>;
  mastery?: Map<string, MasteryState>;
  progress?: Map<string, { progressPct: number; completedAt: Date | null; updatedAt: Date }>;
  ignoredImpressions?: Map<string, number>;
  explorationSeed?: string;
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
  semanticSimilarity?: number;
  playlistContinuation?: boolean;
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
    completionRate?: number | null;
    retentionRate?: number | null;
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
  features?: Record<string, number>;
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

function conceptMatch(resource: DiscoveryResource, profile: LearnerProfile, now = new Date()): number {
  const weights = personalizationWeights(profile.affinities.values(), profile.onboardingAt, now);
  return resource.concepts.reduce((best, concept) => {
    const relevance = clamp(concept.relevance);
    const observed = observedAffinity(profile.affinities.get(concept.id), now);
    const prior = coreConceptIds(profile).includes(concept.id) ? weights.onboarding : 0;
    const behavior = weights.behavior * clamp(.5 + observed.score * .5) * observed.confidence;
    const context = profile.sessionConceptIds?.includes(concept.id) || profile.goalConceptIds?.includes(concept.id) ? .75 : 0;
    const adjacent = adjacentConceptIds(profile).includes(concept.id) ? .3 : 0;
    const emerging = emergingConceptIds(profile).includes(concept.id) ? observed.confidence * .4 : 0;
    return Math.max(best, relevance * clamp(Math.max(prior + behavior, context, adjacent, emerging)));
  }, 0);
}

function learnerAffinity(resource: DiscoveryResource, profile: LearnerProfile, now = new Date()): number {
  const weights = personalizationWeights(profile.affinities.values(), profile.onboardingAt, now);
  return resource.concepts.reduce((best, concept) => {
    const observed = observedAffinity(profile.affinities.get(concept.id), now);
    const prior = coreConceptIds(profile).includes(concept.id) ? weights.onboarding * .5 : 0;
    const blended = profile.semanticRanking ? (Math.min(1, profile.longTermInterests?.[concept.id] ?? 0) * recommendationConfig.longTermShare + Math.min(1, profile.recentInterests?.[concept.id] ?? 0) * recommendationConfig.recentShare) * concept.relevance : 0;
    return Math.max(best, blended, clamp((prior + observed.confidence * clamp(.5 + observed.score * .5)) * concept.relevance));
  }, 0);
}

function levelFit(resource: DiscoveryResource, profile: LearnerProfile): number {
  const estimated = metadataText(resource.metadata, "estimatedLevel");
  const learned = resource.concepts.flatMap((concept) => {
    const mastery = profile.mastery?.get(concept.id);
    return mastery && mastery.evidenceCount >= 3 && mastery.uncertainty < .5 ? [mastery.score] : [];
  });
  const level = learned.length ? Math.max(...learned) >= .8 ? "advanced" : Math.max(...learned) >= .45 ? "intermediate" : "beginner" : profile.selfReportedLevel;
  if (!estimated || !level || level === "mixed") {
    return estimated ? 0.75 : 0.5;
  }
  return estimated === level ? 1 : estimated === "beginner" && level === "intermediate" ? .65 : 0.35;
}

function formatFit(resource: DiscoveryResource, profile: LearnerProfile): number {
  if (profile.preferredFormats.length === 0) {
    return 0.5;
  }
  const format = metadataText(resource.metadata, "learningFormat");
  const formatByPreference: Record<string, string> = { deep_dives: "deep_dive", learn_by_building: "hands_on", conversational_tutor_led: "conversational" };
  const preferred = profile.preferredFormats.map((value) => formatByPreference[value] ?? value);
  return format ? (preferred.includes(format) || preferred.includes("mixed") ? 1 : 0.25) : 0.5;
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
  const base = clamp(resource.quality?.finalQualityScore ?? resource.qualityScore ?? 0.5);
  const priors = [resource.quality?.completionRate, resource.quality?.retentionRate].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return priors.length ? clamp(base * .7 + priors.reduce((sum, value) => sum + clamp(value), 0) / priors.length * .3) : base;
}

function reviewDue(resource: DiscoveryResource, profile: LearnerProfile, now: Date): boolean {
  return resource.concepts.some((concept) => {
    const mastery = profile.mastery?.get(concept.id);
    return mastery?.nextReviewAt && mastery.nextReviewAt <= now;
  });
}

function pedagogicalFit(resource: DiscoveryResource, profile: LearnerProfile, now: Date): number {
  const missingPrerequisites = (profile.prerequisites ?? []).filter((edge) => resource.concepts.some((concept) => concept.id === edge.targetConceptId))
    .filter((edge) => (profile.mastery?.get(edge.sourceConceptId)?.score ?? 0) < .5);
  if (missingPrerequisites.length) return .15;
  if (reviewDue(resource, profile, now)) return 1;
  if ((profile.prerequisites ?? []).some((edge) => resource.concepts.some((concept) => concept.id === edge.sourceConceptId) && (profile.goalConceptIds?.includes(edge.targetConceptId) || coreConceptIds(profile).includes(edge.targetConceptId) || emergingConceptIds(profile).includes(edge.targetConceptId)) && (profile.mastery?.get(edge.sourceConceptId)?.score ?? 0) < .5)) return .9;
  const mastered = resource.concepts.map((concept) => profile.mastery?.get(concept.id)).filter((state): state is MasteryState => Boolean(state));
  return mastered.length ? clamp(1 - Math.max(...mastered.map((state) => state.score * (1 - state.uncertainty)))) : .65;
}

function intentMatch(resource: DiscoveryResource, profile: LearnerProfile): number {
  const format = metadataText(resource.metadata, "learningFormat");
  if ((profile.persona === "builder" || profile.learningIntents.some((intent) => ["build_project", "build_something", "reproduce_implementations", "prototype_idea", "upskill_current_role"].includes(intent))) && format === "hands_on") return 1;
  if ((profile.persona === "researcher" || profile.learningIntents.includes("understand_something_deeply")) && ["research_backed", "deep_dive"].includes(format ?? "")) return 1;
  if (profile.persona === "student" && format === "clear_explanations") return .85;
  return .5;
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

function reasonCodes(components: {
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

function diversify(scored: RankedResource[], limit: number, reserveExploration = false): RankedResource[] {
  const remaining = [...scored];
  const selected: RankedResource[] = [];
  const counts = new Map<string, number>();
  const channelLimit = Math.max(2, Math.ceil(limit * recommendationConfig.creatorShare));
  const explorationLimit = Math.max(1, Math.floor(limit * recommendationConfig.explorationShare));
  const keys = (candidate: RankedResource) => [
    `channel:${candidate.resource.channelTitle ?? candidate.resource.id}`,
    `playlist:${metadataText(candidate.resource.metadata, "playlistId") ?? candidate.resource.id}`,
    `concept:${candidate.resource.concepts.toSorted((a, b) => b.relevance - a.relevance)[0]?.id ?? candidate.resource.id}`,
    `subtopic:${metadataText(candidate.resource.metadata, "subtopic") ?? candidate.resource.concepts[0]?.id ?? candidate.resource.id}`,
    `level:${metadataText(candidate.resource.metadata, "estimatedLevel") ?? "unknown"}`,
    `format:${metadataText(candidate.resource.metadata, "learningFormat") ?? "unknown"}`,
    `duration:${candidate.resource.durationMs === null ? "unknown" : candidate.resource.durationMs < 600_000 ? "short" : candidate.resource.durationMs < 1_800_000 ? "medium" : "long"}`,
  ] as const;
  const penalties = [.14, .1, .08, .04, .015, .025, .015];
  while (remaining.length && selected.length < limit) {
    const explorationSlot = reserveExploration && selected.length >= Math.min(4, limit - 1) && (selected.length - Math.min(4, limit - 1)) % Math.max(1, Math.floor(limit / explorationLimit)) === 0;
    const allowed = remaining.filter((candidate) => !reserveExploration || !["review_due", "continue_learning", "adjacent_concept"].some((reason) => candidate.reasonCodes.includes(reason) && selected.filter((item) => item.reasonCodes.includes(reason)).length >= (reason === "adjacent_concept" ? explorationLimit : Math.max(1, Math.floor(limit / 6)))));
    const exploratory = allowed.filter((candidate) => candidate.reasonCodes.includes("adjacent_concept") && candidate.qualityScore >= recommendationConfig.explorationQualityFloor && (candidate.features?.levelFit ?? 0) >= .65 && (counts.get(keys(candidate)[0]) ?? 0) < channelLimit);
    const channelEligible = allowed.filter((candidate) => (counts.get(keys(candidate)[0]) ?? 0) < channelLimit);
    const eligible = explorationSlot && exploratory.length ? exploratory : channelEligible.length ? channelEligible : allowed;
    let best: RankedResource | null = null;
    let bestScore = -Infinity;
    let bestPenalty = 0;
    for (const candidate of eligible) {
      const penalty = clamp(keys(candidate).reduce((sum, key, index) => sum + (counts.get(key) ?? 0) * (penalties[index] ?? 0), 0), 0, .6);
      const adjusted = candidate.score - penalty;
      if (adjusted > bestScore || adjusted === bestScore && candidate.resource.id < (best?.resource.id ?? "")) { best = candidate; bestScore = adjusted; bestPenalty = penalty; }
    }
    if (!best) break;
    remaining.splice(remaining.indexOf(best), 1);
    selected.push({ ...best, finalRank: selected.length + 1, diversityPenalty: bestPenalty });
    for (const key of keys(best)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const selectedById = new Map(selected.map((candidate) => [candidate.resource.id, candidate]));
  return scored.map((candidate) => selectedById.get(candidate.resource.id) ?? { ...candidate, finalRank: null });
}

function rankVideos(resources: DiscoveryResource[], profile: LearnerProfile, now: Date, diversityLimit = 6, feed = true): RankedResource[] {
  const weights = personalizationWeights(profile.affinities.values(), profile.onboardingAt, now);
  const scored = resources.filter((resource) => {
    if (!feed) return true;
    if (quality(resource) < recommendationConfig.qualityFloor || !resource.canonicalUrl) return false;
    if (profile.preferredLanguages?.length && resource.language && !profile.preferredLanguages.some((language) => language.split("-")[0] === resource.language?.split("-")[0])) return false;
    const progress = profile.progress?.get(resource.id);
    return !progress?.completedAt || reviewDue(resource, profile, now) && now.getTime() - progress.completedAt.getTime() >= 7 * 86_400_000;
  }).map((resource, index) => {
    const progress = profile.progress?.get(resource.id);
    const components = {
      semantic: resource.semanticSimilarity ?? 0,
      recentInterest: Math.max(0, ...resource.concepts.map((concept) => Math.min(1, profile.recentInterests?.[concept.id] ?? 0) * concept.relevance)),
      conceptMatch: conceptMatch(resource, profile, now),
      learnerAffinity: learnerAffinity(resource, profile, now),
      quality: quality(resource),
      levelFit: levelFit(resource, profile),
      formatFit: formatFit(resource, profile),
      durationFit: durationFit(resource, profile),
      freshness: freshness(resource.publishedAt, now, 365),
      exploration: stableExploration(`${profile.explorationSeed ?? ""}:${resource.id}`),
      masteryFit: pedagogicalFit(resource, profile, now),
      continuity: resource.playlistContinuation ? 1 : progress && !progress.completedAt && progress.progressPct > 5 && progress.progressPct < 95 ? 1 : resource.concepts.some((concept) => profile.sessionConceptIds?.includes(concept.id)) ? .7 : 0,
      goalFit: resource.concepts.some((concept) => profile.goalConceptIds?.includes(concept.id)) ? 1 : 0,
      intentFit: intentMatch(resource, profile),
    };
    const reasons = reasonCodes(components).filter((reason) => reason !== "adjacent_concept");
    const behavioralConcept = resource.concepts.some((concept) => concept.relevance >= recommendationConfig.minimumTopicRelevance && observedAffinity(profile.affinities.get(concept.id), now).score > .05 && observedAffinity(profile.affinities.get(concept.id), now).confidence >= .15);
    const adjacent = resource.concepts.some((concept) => adjacentConceptIds(profile).includes(concept.id)) && !resource.concepts.some((concept) => coreConceptIds(profile).includes(concept.id) || emergingConceptIds(profile).includes(concept.id) || profile.sessionConceptIds?.includes(concept.id));
    if (adjacent && !reasons.includes("adjacent_concept")) reasons.push("adjacent_concept");
    if (resource.concepts.some((concept) => concept.relevance >= .35 && (coreConceptIds(profile).includes(concept.id) || emergingConceptIds(profile).includes(concept.id) || profile.goalConceptIds?.includes(concept.id))) && !reasons.includes("concept_match")) reasons.push("concept_match");
    if (behavioralConcept) reasons.push("recent_learning");
    if (resource.semanticSimilarity !== undefined && resource.semanticSimilarity >= recommendationConfig.minimumSemanticSimilarity) reasons.push("semantic_match");
    if (resource.playlistContinuation) reasons.push("playlist_continuation");
    if (resource.concepts.some((concept) => profile.completedIntroConceptIds?.includes(concept.id)) && metadataText(resource.metadata, "estimatedLevel") === "intermediate") { components.levelFit = Math.max(components.levelFit, .85); reasons.push("next_level"); }
    if (components.continuity === 1) reasons.push("continue_learning");
    else if (components.continuity > 0) reasons.push("session_context");
    if (components.goalFit) reasons.push("active_goal");
    if (reviewDue(resource, profile, now)) reasons.push("review_due");
    if ((profile.prerequisites ?? []).some((edge) => resource.concepts.some((concept) => concept.id === edge.sourceConceptId) && (profile.goalConceptIds?.includes(edge.targetConceptId) || coreConceptIds(profile).includes(edge.targetConceptId) || emergingConceptIds(profile).includes(edge.targetConceptId)) && (profile.mastery?.get(edge.sourceConceptId)?.score ?? 0) < .5)) reasons.push("prerequisite_gap");
    const ignored = Math.min(.18, (profile.ignoredImpressions?.get(resource.id) ?? 0) * .03);
    const negative = Math.max(0, ...resource.concepts.map((concept) => -observedAffinity(profile.affinities.get(concept.id), now).score * .2));
    const rankingWeights = profile.semanticRanking ? recommendationConfig.weights : VIDEO_RANKING_WEIGHTS;
    const availableWeights = Object.entries(rankingWeights).filter(([key]) => key !== "semantic" || resource.semanticSimilarity !== undefined);
    const weightTotal = availableWeights.reduce((sum, [, weight]) => sum + weight, 0);
    const score = availableWeights.reduce((total, [key, weight]) => total + components[key as keyof typeof components] * weight / weightTotal, 0) - ignored - negative;
    return {
      resource, candidateRank: index + 1, finalRank: null, score,
      semanticRelevance: components.conceptMatch, qualityScore: components.quality,
      learnerAffinity: components.learnerAffinity, masteryFit: components.masteryFit,
      coverageScore: resourceCoverage(resource), freshnessScore: components.freshness,
      diversityPenalty: 0, reasonCodes: reasons,
      features: { ...components, ignoredImpressionPenalty: ignored, negativeAffinityPenalty: negative, onboardingWeight: weights.onboarding, behaviorWeight: weights.behavior, observedEvidence: weights.evidence },
    } satisfies RankedResource;
  }).filter((candidate) => {
    if (!feed || !profile.semanticRanking || !(profile.conceptIds.length || profile.emergingConceptIds?.length || profile.sessionConceptIds?.length || profile.goalConceptIds?.length)) return true;
    return candidate.reasonCodes.some((code) => ["concept_match", "semantic_match", "playlist_continuation", "continue_learning", "session_context", "prerequisite_gap", "review_due", "active_goal", "adjacent_concept", "recent_learning"].includes(code));
  }).filter((candidate) => !feed || !candidate.reasonCodes.includes("adjacent_concept") || candidate.qualityScore >= .65 && candidate.features.levelFit >= .65)
    .sort((a, b) => b.score - a.score || a.resource.id.localeCompare(b.resource.id))
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1 }));
  return diversify(scored, Math.min(diversityLimit, scored.length), feed);
}

function rankPapers(resources: DiscoveryResource[], profile: LearnerProfile, now: Date, diversityLimit = 12): RankedResource[] {
  const scored = resources.map((resource, index) => {
    const components = {
      conceptMatch: conceptMatch(resource, profile, now),
      learnerAffinity: learnerAffinity(resource, profile, now),
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
      reasonCodes: reasonCodes(components),
    } satisfies RankedResource;
  }).sort((left, right) => right.score - left.score || left.resource.id.localeCompare(right.resource.id))
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1 }));
  return diversify(scored, Math.min(diversityLimit, scored.length));
}

export function rankDiscoveryResources(resources: DiscoveryResource[], profile: LearnerProfile, now: Date, videoLimit = 6): {
  videos: RankedResource[];
  papers: RankedResource[];
} {
  return {
    videos: rankVideos(resources.filter((resource) => resource.type === "video"), profile, now, videoLimit),
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
    ? rankVideos(relevantResources, profile, now, relevantResources.length, false)
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

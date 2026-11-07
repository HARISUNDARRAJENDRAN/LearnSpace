export const YOUTUBE_QUALITY_FEATURE_VERSION = "youtube-quality-v3";
const neutralSourceAuthorityPrior = 0.6;
// Missing evidence shrinks toward this prior instead of being dropped, so an
// unmeasured video never outranks a measured one on missing data alone.
const missingFeaturePrior = 0.5;

export type YoutubeQualityFeatures = {
  featureVersion: string;
  sourceAuthorityKind: "neutral_prior" | "channel_subscribers";
  sourceAuthorityPrior: number;
  metricAgeDays: number | null;
  missingFeatureCodes: string[];
  availableFeatureNames: string[];
};

export type YoutubeQualityInput = {
  title: string;
  description: string | null;
  channelTitle: string | null;
  durationMs: number | null;
  publishedAt: Date | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  metricsCapturedAt: Date | null;
  channelSubscriberCount: number | null;
  channelViewCount: number | null;
  channelVideoCount: number | null;
};

export type YoutubeQualityResult = {
  finalQualityScore: number;
  bayesianEngagement: number | null;
  commentQuality: number | null;
  viewVelocity: number | null;
  outlierScore: number | null;
  freshnessPrior: number | null;
  contentCoverage: number | null;
  sourceAuthority: number | null;
  features: YoutubeQualityFeatures;
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageInDays(value: Date | null, now: Date): number | null {
  if (!value) {
    return null;
  }
  return Math.max(0, (now.getTime() - value.getTime()) / 86_400_000);
}

function wilsonLowerBound(successes: number, trials: number): number {
  if (trials <= 0) {
    return 0;
  }
  const z = 1.96;
  const proportion = clamp(successes / trials);
  const denominator = 1 + (z * z) / trials;
  const centre = proportion + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * trials)) / trials);
  return clamp((centre - spread) / denominator);
}

/** Views per day between publish and measurement; one day minimum avoids launch-hour spikes. */
export function viewsPerDay(viewCount: number, publishedAt: Date, measuredAt: Date): number {
  return Math.max(0, viewCount) / Math.max(1, (measuredAt.getTime() - publishedAt.getTime()) / 86_400_000);
}

/** Log-scaled view velocity: 10 views/day ≈ 0.2, 1k ≈ 0.6, 100k+ = 1. */
export function viewVelocityScore(perDay: number): number {
  return clamp(Math.log10(Math.max(0, perDay) + 1) / 5);
}

/**
 * Lifetime views relative to the channel's average views per video, so a small
 * channel's breakout ranks like a large channel's. Recency is viewVelocity's job.
 * Ratio 0.1 → 0, a typical video (1) → 0.5, 10× the channel's average → 1.
 */
export function outlierScore(viewCount: number, channelViewCount: number, channelVideoCount: number): number | null {
  if (channelVideoCount <= 0 || channelViewCount <= 0) return null;
  const ratio = viewCount / (channelViewCount / channelVideoCount);
  return ratio > 0 ? clamp((Math.log10(ratio) + 1) / 2) : 0;
}

/** Comments per view; educational videos sit around 0.1–0.5%, so 0.5% scores 1. */
export function commentScore(commentCount: number, viewCount: number): number {
  return clamp(commentCount / viewCount / 0.005);
}

/** Mild authority prior from subscribers: 1k ≈ 0.43, 100k ≈ 0.71, 10M = 1. */
export function channelAuthorityScore(subscriberCount: number): number {
  return clamp(Math.log10(Math.max(0, subscriberCount) + 1) / 7);
}

export function scoreYoutubeQuality(input: YoutubeQualityInput, now: Date): YoutubeQualityResult {
  const values: Array<[string, number | null, number]> = [];
  const missingFeatureCodes: string[] = [];
  const metricAge = ageInDays(input.metricsCapturedAt, now);
  const ageConfidence = metricAge === null ? 0.5 : Math.exp(-metricAge / 180);
  const add = (name: string, value: number | null, weight: number, missingCode: string) => {
    values.push([name, value, weight]);
    if (value === null) missingFeatureCodes.push(missingCode);
  };

  add("bayesianEngagement", input.viewCount !== null && input.likeCount !== null && input.viewCount > 0
    ? clamp(wilsonLowerBound(input.likeCount, input.viewCount) * 18 * ageConfidence)
    : null, 0.3, "engagement_metrics_missing");

  add("commentQuality", input.viewCount !== null && input.commentCount !== null && input.viewCount > 0
    ? clamp(commentScore(input.commentCount, input.viewCount) * ageConfidence)
    : null, 0.05, "comment_metrics_missing");

  const perDay = input.viewCount !== null && input.publishedAt
    ? viewsPerDay(input.viewCount, input.publishedAt, input.metricsCapturedAt ?? now)
    : null;
  add("viewVelocity", perDay === null ? null : viewVelocityScore(perDay), 0.15, "view_velocity_missing");
  add("outlierScore", input.viewCount !== null && input.channelViewCount !== null && input.channelVideoCount !== null
    ? outlierScore(input.viewCount, input.channelViewCount, input.channelVideoCount)
    : null, 0.15, "channel_metrics_missing");

  // Reported for the ranker's own freshness weight, but kept out of quality: an evergreen lecture is not worse for being old.
  const publishedAge = ageInDays(input.publishedAt, now);
  const freshnessPrior = publishedAge === null ? null : Math.exp(-publishedAge / 730);
  if (freshnessPrior === null) missingFeatureCodes.push("published_at_missing");

  add("contentCoverage", input.title.trim() ? 0.5 + (input.description?.trim() ? 0.5 : 0) : null, 0.15, "title_missing");

  const authorityKind = input.channelSubscriberCount !== null ? "channel_subscribers" : "neutral_prior";
  add("sourceAuthority", input.channelSubscriberCount !== null
    ? channelAuthorityScore(input.channelSubscriberCount)
    : input.channelTitle?.trim() ? neutralSourceAuthorityPrior : null, 0.1, "channel_missing");

  const weightedTotal = values.reduce((total, [, value, weight]) => total + (value ?? missingFeaturePrior) * weight, 0);
  const totalWeight = values.reduce((total, [, , weight]) => total + weight, 0);
  const valueOf = (name: string) => values.find(([key]) => key === name)?.[1] ?? null;

  return {
    finalQualityScore: clamp(weightedTotal / totalWeight),
    bayesianEngagement: valueOf("bayesianEngagement"),
    commentQuality: valueOf("commentQuality"),
    viewVelocity: valueOf("viewVelocity"),
    outlierScore: valueOf("outlierScore"),
    freshnessPrior,
    contentCoverage: valueOf("contentCoverage"),
    sourceAuthority: valueOf("sourceAuthority"),
    features: {
      featureVersion: YOUTUBE_QUALITY_FEATURE_VERSION,
      sourceAuthorityKind: authorityKind,
      sourceAuthorityPrior: neutralSourceAuthorityPrior,
      metricAgeDays: metricAge,
      missingFeatureCodes,
      availableFeatureNames: values.filter(([, value]) => value !== null).map(([name]) => name),
    },
  };
}

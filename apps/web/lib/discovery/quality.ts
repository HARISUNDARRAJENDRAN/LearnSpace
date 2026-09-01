export const YOUTUBE_QUALITY_FEATURE_VERSION = "youtube-quality-v1";
const neutralSourceAuthorityPrior = 0.6;

export type YoutubeQualityFeatures = {
  featureVersion: string;
  sourceAuthorityKind: "neutral_prior";
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
};

export type YoutubeQualityResult = {
  finalQualityScore: number;
  bayesianEngagement: number | null;
  commentQuality: number | null;
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

export function scoreYoutubeQuality(input: YoutubeQualityInput, now: Date): YoutubeQualityResult {
  const values: Array<[string, number, number]> = [];
  const missingFeatureCodes: string[] = [];
  const metricAge = ageInDays(input.metricsCapturedAt, now);

  if (input.viewCount !== null && input.likeCount !== null && input.viewCount > 0) {
    const smoothedEngagement = wilsonLowerBound(input.likeCount, input.viewCount);
    const ageConfidence = metricAge === null ? 0.5 : Math.exp(-metricAge / 180);
    values.push(["bayesianEngagement", clamp(smoothedEngagement * 18 * ageConfidence), 0.4]);
  } else {
    missingFeatureCodes.push("engagement_metrics_missing");
  }

  if (input.viewCount !== null && input.commentCount !== null && input.viewCount > 0) {
    const commentRatio = clamp(input.commentCount / input.viewCount, 0, 0.1) / 0.1;
    const ageConfidence = metricAge === null ? 0.5 : Math.exp(-metricAge / 180);
    values.push(["commentQuality", clamp(commentRatio * ageConfidence), 0.1]);
  } else {
    missingFeatureCodes.push("comment_metrics_missing");
  }

  const publishedAge = ageInDays(input.publishedAt, now);
  if (publishedAge !== null) {
    values.push(["freshnessPrior", Math.exp(-publishedAge / 730), 0.2]);
  } else {
    missingFeatureCodes.push("published_at_missing");
  }

  if (input.title.trim()) {
    const descriptionBonus = input.description?.trim() ? 0.5 : 0;
    values.push(["contentCoverage", 0.5 + descriptionBonus, 0.2]);
  } else {
    missingFeatureCodes.push("title_missing");
  }

  if (input.channelTitle?.trim()) {
    values.push(["sourceAuthority", neutralSourceAuthorityPrior, 0.1]);
  } else {
    missingFeatureCodes.push("channel_missing");
  }

  const weightedTotal = values.reduce((total, [, value, weight]) => total + value * weight, 0);
  const availableWeight = values.reduce((total, [, , weight]) => total + weight, 0);
  const finalQualityScore = availableWeight > 0 ? clamp(weightedTotal / availableWeight) : 0.5;

  return {
    finalQualityScore,
    bayesianEngagement: values.find(([name]) => name === "bayesianEngagement")?.[1] ?? null,
    commentQuality: values.find(([name]) => name === "commentQuality")?.[1] ?? null,
    freshnessPrior: values.find(([name]) => name === "freshnessPrior")?.[1] ?? null,
    contentCoverage: values.find(([name]) => name === "contentCoverage")?.[1] ?? null,
    sourceAuthority: values.find(([name]) => name === "sourceAuthority")?.[1] ?? null,
    features: {
      featureVersion: YOUTUBE_QUALITY_FEATURE_VERSION,
      sourceAuthorityKind: "neutral_prior",
      sourceAuthorityPrior: neutralSourceAuthorityPrior,
      metricAgeDays: metricAge,
      missingFeatureCodes,
      availableFeatureNames: values.map(([name]) => name),
    },
  };
}

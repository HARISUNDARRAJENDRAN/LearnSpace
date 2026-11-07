import assert from "node:assert/strict";
import test from "node:test";
import { channelAuthorityScore, commentScore, outlierScore, scoreYoutubeQuality, viewVelocityScore, viewsPerDay, type YoutubeQualityInput } from "./youtube-quality.js";

const now = new Date("2026-11-01T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const video = (overrides: Partial<YoutubeQualityInput> = {}): YoutubeQualityInput => ({
  title: "A lesson", description: "Details", channelTitle: "Teacher", durationMs: 600_000, publishedAt: daysAgo(100),
  viewCount: 100_000, likeCount: 4_000, commentCount: 300, metricsCapturedAt: now,
  channelSubscriberCount: 50_000, channelViewCount: 5_000_000, channelVideoCount: 100, ...overrides,
});

test("views per day uses a one-day floor and the measurement time", () => {
  assert.equal(viewsPerDay(1_000, daysAgo(10), now), 100);
  assert.equal(viewsPerDay(500, now, now), 500);
});

test("view velocity is log-scaled and bounded", () => {
  assert.equal(viewVelocityScore(0), 0);
  assert.ok(Math.abs(viewVelocityScore(999) - 0.6) < 1e-9);
  assert.equal(viewVelocityScore(10_000_000), 1);
});

test("outlier score compares a video's views to its own channel's average", () => {
  // Same views: the small channel's video is the bigger outlier.
  const small = outlierScore(1_000, 100_000, 100)!;
  const large = outlierScore(1_000, 100_000_000, 100)!;
  assert.ok(small > large);
  assert.equal(outlierScore(1_000, 1_000, 1), 0.5);
  assert.equal(outlierScore(10_000, 1_000, 1), 1);
  assert.equal(outlierScore(100, 1_000, 1), 0);
  assert.equal(outlierScore(0, 1_000, 1), 0);
  assert.equal(outlierScore(1_000, 0, 0), null);
});

test("comment score saturates at a realistic 0.5% of views", () => {
  assert.equal(commentScore(0, 1_000), 0);
  assert.ok(Math.abs(commentScore(1, 1_000) - 0.2) < 1e-9);
  assert.equal(commentScore(5, 1_000), 1);
  assert.equal(commentScore(50, 1_000), 1);
});

test("an old video is not penalised in quality; freshness is reported for the ranker only", () => {
  // Same daily views, likes and comments over a longer life: never worse for its age.
  const recent = scoreYoutubeQuality(video({ publishedAt: daysAgo(30), viewCount: 30_000, likeCount: 1_200, commentCount: 90 }), now);
  const old = scoreYoutubeQuality(video({ publishedAt: daysAgo(2_000), viewCount: 2_000_000, likeCount: 80_000, commentCount: 6_000 }), now);
  assert.ok(old.finalQualityScore >= recent.finalQualityScore);
  assert.ok(old.freshnessPrior! < recent.freshnessPrior!);
  assert.ok(!old.features.availableFeatureNames.includes("freshnessPrior"));
});

test("channel authority is a mild log prior", () => {
  assert.equal(channelAuthorityScore(0), 0);
  assert.ok(channelAuthorityScore(100_000) > channelAuthorityScore(1_000));
  assert.equal(channelAuthorityScore(50_000_000), 1);
});

test("measured videos spread out while unmeasured ones sit near the neutral prior", () => {
  const strong = scoreYoutubeQuality(video({ viewCount: 2_000_000, likeCount: 120_000 }), now).finalQualityScore;
  const weak = scoreYoutubeQuality(video({ viewCount: 2_000, likeCount: 10, commentCount: 0 }), now).finalQualityScore;
  const unmeasured = scoreYoutubeQuality(video({ viewCount: null, likeCount: null, commentCount: null, metricsCapturedAt: null, publishedAt: null, channelSubscriberCount: null, channelViewCount: null, channelVideoCount: null }), now);
  assert.ok(strong > unmeasured.finalQualityScore && unmeasured.finalQualityScore > weak);
  assert.ok(unmeasured.finalQualityScore > 0.5 && unmeasured.finalQualityScore < 0.6);
  assert.equal(unmeasured.outlierScore, null);
  assert.deepEqual(unmeasured.features.missingFeatureCodes, ["engagement_metrics_missing", "comment_metrics_missing", "view_velocity_missing", "channel_metrics_missing", "published_at_missing"]);
});

test("hidden likes keep velocity and outlier evidence without fabricating engagement", () => {
  const result = scoreYoutubeQuality(video({ likeCount: null }), now);
  assert.equal(result.bayesianEngagement, null);
  assert.notEqual(result.viewVelocity, null);
  assert.notEqual(result.outlierScore, null);
  assert.equal(result.features.sourceAuthorityKind, "channel_subscribers");
});

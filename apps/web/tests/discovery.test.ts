import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { homeFeedCacheKey } from "../lib/discovery/cache";
import { canonicalYoutubeId, datasetRows, normalizeYoutubeRow, profileYoutubeDataset, parseDurationMs } from "../lib/discovery/dataset";
import { scoreYoutubeQuality } from "../lib/discovery/quality";
import { rankDiscoveryResources, type DiscoveryResource, type LearnerProfile } from "../lib/discovery/ranker";

const conceptId = "00000000-0000-0000-0000-000000000001";
const behavioralConceptId = "00000000-0000-0000-0000-000000000002";
const now = new Date("2026-08-31T00:00:00.000Z");

function profile(overrides: Partial<LearnerProfile> = {}): LearnerProfile {
  return {
    conceptIds: [conceptId],
    conceptNames: new Map([[conceptId, "Artificial Intelligence"]]),
    affinities: new Map(),
    persona: "student",
    learningIntents: ["coursework"],
    preferredFormats: ["clear_explanations"],
    preferredDuration: "no_preference",
    selfReportedLevel: "beginner",
    ...overrides,
  };
}

function resource(id: string, type: "video" | "paper", concepts: string[]): DiscoveryResource {
  return {
    id,
    type,
    provider: type === "video" ? "youtube" : "arxiv",
    externalId: id,
    canonicalUrl: `https://example.com/${id}`,
    title: `${type} ${id}`,
    description: "A complete explanation with examples.",
    language: "en",
    qualityScore: 0.8,
    thumbnailUrl: null,
    channelTitle: type === "video" ? id : null,
    durationMs: type === "video" ? 20 * 60_000 : null,
    publishedAt: now,
    paperAbstract: type === "paper" ? "A research abstract." : null,
    venue: type === "paper" ? "arXiv" : null,
    publicationDate: type === "paper" ? now : null,
    citationCount: type === "paper" ? 20 : null,
    metadata: { estimatedLevel: "beginner", learningFormat: "clear_explanations" },
    concepts: concepts.map((id) => ({ id, name: id, relevance: 1 })),
    quality: type === "video" ? { finalQualityScore: 0.8, freshnessPrior: 1, sourceAuthority: 0.6 } : null,
  };
}

test("selected interests and stronger affinity affect deterministic ranking", () => {
  const ranked = rankDiscoveryResources(
    [resource("other", "video", ["other-concept"]), resource("selected", "video", [conceptId])],
    profile(),
    now,
  );
  assert.equal(ranked.videos[0]?.resource.id, "selected");
  assert.equal(ranked.videos[0]?.candidateRank, 1);
  const behaviorRanked = rankDiscoveryResources(
    [resource("strong", "video", [behavioralConceptId]), resource("cold", "video", [conceptId])],
    profile({
      conceptIds: [conceptId, behavioralConceptId],
      affinities: new Map([[behavioralConceptId, { conceptId: behavioralConceptId, score: 0.95, confidence: 0.95, featureVersion: "behavior-v1" }]]),
    }),
    now,
  );
  assert.equal(behaviorRanked.videos[0]?.resource.id, "strong");
});

test("paper ranking stays separate from video engagement features", () => {
  const ranked = rankDiscoveryResources(
    [resource("paper", "paper", [conceptId]), resource("video", "video", [conceptId])],
    profile({ persona: "researcher", learningIntents: ["read_papers"] }),
    now,
  );
  assert.equal(ranked.papers[0]?.resource.type, "paper");
  assert.equal(ranked.videos[0]?.resource.type, "video");
});

test("current and foundational papers remain distinct ranking inputs", () => {
  const ranked = rankDiscoveryResources(
    [
      resource("current-paper", "paper", [conceptId]),
      { ...resource("foundational-paper", "paper", [conceptId]), metadata: { paperClass: "foundational", estimatedLevel: "beginner" }, citationCount: 10_000, publicationDate: new Date("2017-06-12T00:00:00.000Z") },
    ],
    profile({ persona: "researcher", learningIntents: ["read_papers"] }),
    now,
  );
  assert.deepEqual(new Set(ranked.papers.map((candidate) => candidate.resource.id)), new Set(["current-paper", "foundational-paper"]));
});

test("old metric snapshots reduce quality confidence without fabricated values", () => {
  const recent = scoreYoutubeQuality({
    title: "A lesson",
    description: "Details",
    channelTitle: "Teacher",
    durationMs: 600_000,
    publishedAt: now,
    viewCount: 10_000,
    likeCount: 700,
    commentCount: 80,
    metricsCapturedAt: now,
  }, now);
  const old = scoreYoutubeQuality({
    title: "A lesson",
    description: "Details",
    channelTitle: "Teacher",
    durationMs: 600_000,
    publishedAt: now,
    viewCount: 10_000,
    likeCount: 700,
    commentCount: 80,
    metricsCapturedAt: new Date("2024-01-01T00:00:00.000Z"),
  }, now);
  const missing = scoreYoutubeQuality({
    title: "A lesson",
    description: null,
    channelTitle: "Teacher",
    durationMs: null,
    publishedAt: now,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    metricsCapturedAt: null,
  }, now);
  assert.ok(recent.finalQualityScore > old.finalQualityScore);
  assert.equal(missing.bayesianEngagement, null);
  assert.ok((missing.features.missingFeatureCodes as string[]).includes("engagement_metrics_missing"));
});

test("dataset profile counts malformed and duplicate YouTube records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "learnspace-discovery-"));
  const filePath = join(directory, "videos.csv");
  await writeFile(filePath, [
    "url,title,description,channel,duration,published_at,views,likes,comments,category,language",
    "https://youtu.be/dQw4w9WgXcQ,Intro to AI,\"Start here,",
    "with a second line\",Learn Lab,10:00,2026-01-01,1000,50,4,AI / Machine Learning,en",
    "dQw4w9WgXcQ,Intro to AI,Updated,Learn Lab,PT10M,2026-01-02,1100,55,5,AI / Machine Learning,en",
    "abcdefghijk,,Missing title,Learn Lab,10:00,2026-01-03,1000,50,4,AI / Machine Learning,en",
    "not-a-video-id,Missing,Ignored,,,,,,,",
  ].join("\n"));
  try {
    const profileResult = await profileYoutubeDataset(filePath, "CC BY 4.0");
    assert.equal(profileResult.rowCount, 4);
    assert.equal(profileResult.uniqueYoutubeIds, 1);
    assert.equal(profileResult.duplicateYoutubeIds, 1);
    assert.equal(profileResult.invalidUrls, 1);
    assert.equal(profileResult.missingFields.title, 1);
    assert.equal(profileResult.licence, "CC BY 4.0");
    const rows = [];
    for await (const row of datasetRows(filePath)) rows.push(normalizeYoutubeRow(row));
    assert.equal(rows[0]?.description, "Start here,\nwith a second line");
    assert.equal(parseDurationMs("PT1M30S"), 90_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dataset duration units and URL hosts are normalized explicitly", () => {
  assert.equal(parseDurationMs("600000", "milliseconds"), 600_000);
  assert.equal(parseDurationMs("600000ms"), 600_000);
  assert.equal(parseDurationMs("600s"), 600_000);
  assert.equal(parseDurationMs("600", "seconds"), 600_000);
  assert.equal(parseDurationMs("10:00"), 600_000);
  assert.equal(parseDurationMs("01:02:03"), 3_723_000);
  assert.equal(parseDurationMs("PT10M"), 600_000);
  assert.equal(parseDurationMs("10:99"), null);
  assert.equal(parseDurationMs("not-a-duration"), null);
  assert.equal(canonicalYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(canonicalYoutubeId("https://evil-youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(normalizeYoutubeRow({ youtube_id: "dQw4w9WgXcQ", title: "milliseconds", duration_ms: "600000" })?.durationMs, 600_000);
  assert.equal(normalizeYoutubeRow({ youtube_id: "dQw4w9WgXcQ", title: "seconds", duration_seconds: "600" })?.durationMs, 600_000);
  assert.deepEqual(normalizeYoutubeRow({ video_id: "dQw4w9WgXcQ", title: "genre", genre: "biology" })?.categoryLabels, ["biology"]);
});

test("home feed cache keys change with learner and catalogue versions", () => {
  const first = homeFeedCacheKey("user-1", { profileFingerprint: "profile-a", catalogFingerprint: "catalog-a" });
  const changedProfile = homeFeedCacheKey("user-1", { profileFingerprint: "profile-b", catalogFingerprint: "catalog-a" });
  const changedCatalog = homeFeedCacheKey("user-1", { profileFingerprint: "profile-a", catalogFingerprint: "catalog-b" });
  assert.notEqual(first, changedProfile);
  assert.notEqual(first, changedCatalog);
});

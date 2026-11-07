import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hasBrowsableResources } from "../lib/discovery/browse";
import { homeFeedCacheKey } from "../lib/discovery/cache";
import { getCurriculum, getCurriculumCategoryBySlug } from "../lib/discovery/curriculum";
import { loadCurriculumFromCsv } from "../lib/discovery/curriculum-source";
import { canonicalYoutubeId, datasetRows, normalizeYoutubeRow, profileYoutubeDataset, parseDurationMs } from "@learnspace/shared/youtube-dataset";
import { scoreYoutubeQuality } from "@learnspace/shared/youtube-quality";
import { rankDiscoveryResources, rankSourceResources, sourceQuerySignals, type DiscoveryResource, type LearnerProfile } from "../lib/discovery/ranker";

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

test("adjacent concepts provide a bounded exploratory ranking signal", () => {
  const ranked = rankDiscoveryResources(
    [resource("adjacent", "video", [behavioralConceptId]), resource("unrelated", "video", ["other-concept"])],
    profile({ adjacentConceptIds: [behavioralConceptId] }),
    now,
  );
  assert.equal(ranked.videos[0]?.resource.id, "adjacent");
  assert.ok(ranked.videos[0]?.reasonCodes.includes("adjacent_concept"));
});

test("meaningful behavior can introduce an emerging concept without changing onboarding interests", () => {
  const ranked = rankDiscoveryResources(
    [resource("emerging", "video", [behavioralConceptId]), resource("unrelated", "video", ["other-concept"])],
    profile({
      emergingConceptIds: [behavioralConceptId],
      affinities: new Map([[behavioralConceptId, { conceptId: behavioralConceptId, score: 0.55, confidence: 0.4, positiveWeight: 0.25, negativeWeight: 0, featureVersion: "discovery-behavior-v1" }]]),
    }),
    now,
  );
  assert.equal(ranked.videos[0]?.resource.id, "emerging");
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

test("paper recommendations respond to the shared learner affinity projection", () => {
  const papers = [resource("paper-a", "paper", [conceptId]), resource("paper-b", "paper", [behavioralConceptId])];
  const cold = rankDiscoveryResources(papers, profile({ conceptIds: [] }), now);
  const warm = rankDiscoveryResources(papers, profile({
    conceptIds: [],
    coreConceptIds: [conceptId],
    affinities: new Map([[conceptId, { conceptId, score: 0.95, confidence: 0.95, featureVersion: "discovery-behavior-v1" }]]),
  }), now);
  assert.equal(cold.papers[0]?.resource.id, "paper-b");
  assert.equal(warm.papers[0]?.resource.id, "paper-a");
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
    channelSubscriberCount: null,
    channelViewCount: null,
    channelVideoCount: null,
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
    channelSubscriberCount: null,
    channelViewCount: null,
    channelVideoCount: null,
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
    channelSubscriberCount: null,
    channelViewCount: null,
    channelVideoCount: null,
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

test("curriculum source preserves every item inside its area and category", async () => {
  const sourceRows = [];
  for await (const row of datasetRows(join(process.cwd(), "public/data/learnspace_youtube_curriculum_master.csv"))) sourceRows.push(row);
  const areas = await getCurriculum();
  const items = areas.flatMap((area) => area.categories.flatMap((category) => category.items));
  assert.equal(items.length, sourceRows.length);
  assert.equal(areas.length, 8);
  assert.ok(items.some((item) => item.resourceType === "dynamic-rule"));
  assert.ok(items.every((item) => item.title && item.id));
  const categories = areas.flatMap((area) => area.categories);
  assert.equal(new Set(categories.map((category) => category.slug)).size, categories.length);
});

test("curriculum category routes resolve canonical slugs", async () => {
  const coding = await getCurriculumCategoryBySlug("coding-programming");
  const dataScience = await getCurriculumCategoryBySlug("data-science-ai");
  assert.equal(coding?.category.name, "Coding & Programming");
  assert.equal(dataScience?.category.name, "Data Science & AI/ML");
  assert.ok((coding?.category.items.length ?? 0) > 0);
  assert.equal(await getCurriculumCategoryBySlug("not-a-category"), null);
});

test("dynamic recommendation rules do not create empty category routes", async () => {
  const areas = await getCurriculum();
  const categories = areas.flatMap((area) => area.categories);
  for (const slug of ["trending-now", "recommended-for-you", "based-on-interests"]) {
    const category = categories.find((item) => item.slug === slug);
    assert.ok(category);
    assert.equal(hasBrowsableResources(category), false);
  }
  const coding = categories.find((item) => item.slug === "coding-programming");
  assert.ok(coding);
  assert.equal(hasBrowsableResources(coding), true);
});

test("home feed cache keys change with learner and catalogue versions", () => {
  const first = homeFeedCacheKey("user-1", { profileFingerprint: "profile-a", catalogFingerprint: "catalog-a" });
  const changedProfile = homeFeedCacheKey("user-1", { profileFingerprint: "profile-b", catalogFingerprint: "catalog-a" });
  const changedCatalog = homeFeedCacheKey("user-1", { profileFingerprint: "profile-a", catalogFingerprint: "catalog-b" });
  assert.notEqual(first, changedProfile);
  assert.notEqual(first, changedCatalog);
});

test("source ranking lets explicit query relevance dominate general affinity", () => {
  const candidates = [
    { ...resource("affinity", "video", [conceptId]), title: "A broad introduction", description: "General programming concepts" },
    { ...resource("query", "video", ["other-concept"]), title: "Python generators explained", description: "Practical yield examples" },
  ];
  const ranked = rankSourceResources(candidates, profile(), "Python generators", "learn", "best_match", now);
  assert.equal(ranked[0]?.resource.id, "query");
  assert.ok(ranked[0]?.reasonCodes.includes("query_phrase_match"));
});

test("source coverage requires strong explicit relevance, not just catalog volume", () => {
  const candidates = [
    { ...resource("strong", "video", []), title: "Variational autoencoders and latent representations" },
    { ...resource("canonical", "video", [conceptId]), title: "Latent variable generative modeling", concepts: [{ id: conceptId, name: "Variational autoencoders", relevance: 1 }] },
    { ...resource("weak", "video", []), title: "A practical programming guide", description: "A short variational overview" },
    { ...resource("unrelated", "video", []), title: "React component patterns", description: "Building interfaces with hooks" },
  ];
  const ranked = rankSourceResources(candidates, profile(), "Variational autoencoders latent representations", "learn", "best_match", now, conceptId);
  assert.deepEqual(ranked.filter((candidate) => candidate.finalRank !== null).map((candidate) => candidate.resource.id), ["strong", "canonical"]);
  assert.equal(ranked.some((candidate) => candidate.resource.id === "weak"), false);
  assert.equal(ranked.some((candidate) => candidate.resource.id === "unrelated"), false);
});

test("a broad canonical concept does not qualify a weak explicit query match", () => {
  const ranked = rankSourceResources([
    { ...resource("broad", "video", [conceptId]), title: "Python tutorial", concepts: [{ id: conceptId, name: "Python", relevance: 1 }] },
  ], profile(), "Python generators", "learn", "best_match", now, conceptId);
  assert.equal(ranked.some((candidate) => candidate.finalRank !== null), false);
});

test("explicit query ranking stays ahead of historical affinity", () => {
  const affinityConcept = "00000000-0000-0000-0000-000000000099";
  const queryConcept = "00000000-0000-0000-0000-000000000098";
  const ranked = rankSourceResources([
    { ...resource("react", "video", [affinityConcept]), title: "React hooks deep dive" },
    { ...resource("bayesian", "video", [queryConcept]), title: "Bayesian optimization acquisition functions" },
  ], profile({ conceptIds: [affinityConcept], affinities: new Map([[affinityConcept, { conceptId: affinityConcept, score: 1, confidence: 1, featureVersion: "behavior-v1" }]]) }), "Bayesian optimization acquisition functions", "learn", "best_match", now, queryConcept);
  assert.equal(ranked[0]?.resource.id, "bayesian");
});

test("python beginner search qualifies only topical beginner resources", () => {
  const candidates = [
    { ...resource("python-course", "video", []), title: "Python for Beginners - Full Course", metadata: { estimatedLevel: "beginner", learningFormat: "clear_explanations" } },
    { ...resource("python-basics", "video", []), title: "Python Variables and Functions for Beginners", metadata: { estimatedLevel: "beginner", learningFormat: "clear_explanations" } },
    { ...resource("python-metaclasses", "video", []), title: "Advanced Python Metaclasses", metadata: { estimatedLevel: "advanced", learningFormat: "deep_dive" } },
    { ...resource("python-autoupdater", "video", []), title: "How to Add an Auto-Updater to ANY Python App", description: "A production app tutorial for experienced developers.", metadata: {} },
    { ...resource("pi-agent", "video", [conceptId]), title: "Meet Pi: The Minimalist, Self-Modifying Coding Agent", description: "An AI coding agent walkthrough." },
    { ...resource("openai-images", "video", [conceptId]), title: "OpenAI Image Generation Tutorial", description: "Generate images with modern AI tools." },
  ];
  const ranked = rankSourceResources(candidates, profile({
    affinities: new Map([[conceptId, { conceptId, score: 1, confidence: 1, featureVersion: "behavior-v1" }]]),
  }), "python for beginners", "learn", "best_match", now);
  const visible = ranked.filter((candidate) => candidate.finalRank !== null);
  assert.deepEqual(visible.map((candidate) => candidate.resource.id), ["python-course", "python-basics"]);
  assert.equal(ranked.find((candidate) => candidate.resource.id === "python-autoupdater"), undefined);
  assert.equal(ranked.find((candidate) => candidate.resource.id === "pi-agent"), undefined);
  assert.equal(ranked.find((candidate) => candidate.resource.id === "openai-images"), undefined);
  assert.ok(visible.every((candidate) => candidate.reasonCodes.some((code) => code.startsWith("query_"))));
  assert.ok(visible.every((candidate) => !candidate.reasonCodes.includes("concept_match")));
});

test("source ranking intent reorders qualified results without widening eligibility", () => {
  const candidates = [
    { ...resource("beginner-python", "video", []), title: "Python Fundamentals", durationMs: 10 * 60_000, metadata: { estimatedLevel: "beginner", learningFormat: "clear_explanations" } },
    { ...resource("deep-python", "video", []), title: "Python Internals Deep Dive", durationMs: 45 * 60_000, metadata: { estimatedLevel: "advanced", learningFormat: "deep_dive" } },
    { ...resource("python-agent", "video", [conceptId]), title: "Self-Modifying Coding Agent", description: "Python is mentioned only in a long related-topic description." },
  ];
  const beginner = rankSourceResources(candidates, profile(), "python", "learn", "beginner_friendly", now);
  const inDepth = rankSourceResources(candidates, profile(), "python", "learn", "in_depth", now);
  assert.equal(beginner.filter((candidate) => candidate.finalRank !== null)[0]?.resource.id, "beginner-python");
  assert.equal(inDepth.filter((candidate) => candidate.finalRank !== null)[0]?.resource.id, "deep-python");
  assert.equal(beginner.some((candidate) => candidate.resource.id === "python-agent"), false);
});

test("source relevance tolerates one typo without accepting substring matches", () => {
  const candidate = { ...resource("reinforcement", "video", []), title: "Reinforcement Learning for Beginners", description: "A gentle introduction to reinforcement learning." };
  const unrelated = { ...resource("reinforced-concrete", "video", []), title: "Reinforced Concrete Design for Beginners" };
  const signals = sourceQuerySignals(candidate, "Reinorcement learning for beginners");
  const ranked = rankSourceResources([candidate, unrelated], profile(), "Reinorcement learning for beginners", "learn", "best_match", now);
  assert.equal(signals.qualified, true);
  assert.deepEqual(ranked.filter((item) => item.finalRank !== null).map((item) => item.resource.id), ["reinforcement"]);
});

test("source relevance combines a distinctive title token with provider evidence", () => {
  const jev = { ...resource("jev", "video", []), title: "Jev Destroys Claude and GPT on Simple Tasks", description: "Typesafe AI's Jev model handles practical coding tasks." };
  const otherAi = { ...resource("other-ai", "video", [conceptId]), title: "Meet Pi: The Minimalist, Self-Modifying Coding Agent", description: "A Typesafe AI coding agent walkthrough." };
  const jevan = { ...resource("jevan", "video", []), title: "How Jevan Fox Closed a Stalled Deal", description: "A Typesafe AI sales story." };
  const ranked = rankSourceResources([jev, otherAi, jevan], profile(), "Jev by typesafe ai", "learn", "best_match", now);
  assert.deepEqual(ranked.filter((item) => item.finalRank !== null).map((item) => item.resource.id), ["jev"]);
  assert.equal(ranked.some((item) => item.resource.id === "other-ai"), false);
  assert.equal(ranked.some((item) => item.resource.id === "jevan"), false);
});

test("source ranking returns up to thirty qualified resources without padding", () => {
  const qualified = Array.from({ length: 30 }, (_, index) => ({
    ...resource(`python-${index}`, "video", []),
    title: `Python lesson ${index + 1}`,
  }));
  const ranked = rankSourceResources(qualified, profile(), "python", "learn", "best_match", now);
  const visible = ranked.filter((item) => item.finalRank !== null);
  assert.equal(visible.length, 30);
  assert.equal(visible.at(-1)?.finalRank, 30);
});

test("the bundled curriculum matches the curriculum CSV", async () => {
  assert.deepEqual(await getCurriculum(), await loadCurriculumFromCsv(), "run pnpm discovery:generate:category-intelligence");
});

import assert from "node:assert/strict";
import test from "node:test";
import { behaviorSignal, personalizationWeights, updateBehaviorAffinity, type LearnerAffinity } from "../lib/discovery/learner-model";
import { rankDiscoveryResources, type DiscoveryResource, type LearnerProfile } from "../lib/discovery/ranker";

const now = new Date("2026-10-02T12:00:00Z");
function learner(overrides: Partial<LearnerProfile> = {}): LearnerProfile {
  return { conceptIds: ["python"], conceptNames: new Map(), affinities: new Map(), persona: "student", learningIntents: ["coursework"], preferredFormats: ["clear_explanations"], preferredDuration: "no_preference", selfReportedLevel: "beginner", onboardingAt: now, ...overrides };
}
function video(id: string, concept = "python", channel = id, overrides: Partial<DiscoveryResource> = {}): DiscoveryResource {
  return { id, type: "video", provider: "youtube", externalId: id, canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: `Learn ${concept}: ${id}`, description: "An actual catalogue entry in this isolated test fixture", language: "en", qualityScore: .9, thumbnailUrl: null, channelTitle: channel, durationMs: 600_000, publishedAt: now, paperAbstract: null, venue: null, publicationDate: null, citationCount: null, metadata: { estimatedLevel: "beginner", learningFormat: "clear_explanations" }, concepts: [{ id: concept, name: concept, relevance: 1 }], quality: null, ...overrides };
}
function learned(conceptId: string, count: number, at = now): LearnerAffinity {
  let affinity: LearnerAffinity | undefined;
  for (let i = 0; i < count; i++) affinity = { conceptId, ...updateBehaviorAffinity(affinity, behaviorSignal({ kind: "complete", progress: .98, watchedSeconds: 550 }), at) };
  assert.ok(affinity); return affinity;
}
function selected(resources: DiscoveryResource[], profile = learner()) {
  return rankDiscoveryResources(resources, profile, now).videos.filter((candidate) => candidate.finalRank !== null).sort((a, b) => a.finalRank! - b.finalRank!);
}

test("cold start uses onboarding concepts with zero watch history", () => {
  const feed = selected([video("outside", "react"), video("interest")]);
  assert.equal(feed[0]?.resource.id, "interest");
  assert.equal(feed[0]?.features?.behaviorWeight, 0);
  assert.ok(feed[0]?.reasonCodes.includes("concept_match"));
});
test("no onboarding interests serves real quality candidates without invented padding", () => {
  assert.equal(selected([], learner({ conceptIds: [] })).length, 0);
  const feed = selected([video("poor", "other", "x", { qualityScore: .2 }), video("good", "react")], learner({ conceptIds: [] }));
  assert.deepEqual(feed.map((card) => card.resource.id), ["good"]);
});
test("repeated learning can outrank a different onboarding interest", () => {
  const affinity = learned("react", 20);
  const profile = learner({ emergingConceptIds: ["react"], affinities: new Map([["react", affinity]]) });
  const feed = selected([video("prior"), video("behavior", "react")], profile);
  assert.equal(feed[0]?.resource.id, "behavior");
  assert.ok(feed[0]?.reasonCodes.includes("recent_learning"));
  assert.ok(feed[0]!.features!.behaviorWeight! > feed[0]!.features!.onboardingWeight!);
});
test("clicks and seek-to-end claims do not provide consumption evidence", () => {
  for (const observation of [{ kind: "open" } as const, { kind: "complete", progress: 1, watchedSeconds: 0 } as const]) assert.equal(behaviorSignal(observation).positive, 0);
  assert.equal(behaviorSignal({ kind: "abandon", progress: .02, watchedSeconds: 5 }).negative > 0, true);
  assert.equal(behaviorSignal({ kind: "abandon", progress: .5, watchedSeconds: 100 }).negative, 0);
});
test("near completion and actual watched time provide stronger evidence than a session start", () => {
  assert.ok(behaviorSignal({ kind: "complete", progress: .98, watchedSeconds: 550 }).positive > behaviorSignal({ kind: "start_session" }).positive);
  assert.equal(behaviorSignal({ kind: "consumption", seconds: 15, totalSeconds: 15, rewatch: false }).positive, 0);
  assert.ok(behaviorSignal({ kind: "consumption", seconds: 15, totalSeconds: 90, rewatch: false }).positive > 0);
});
test("rewatches reinforce concepts through consumption, not repeated opens", () => {
  const initial = learned("python", 1);
  const rewatched = updateBehaviorAffinity(initial, behaviorSignal({ kind: "consumption", seconds: 30, totalSeconds: 120, rewatch: true }), now);
  assert.ok(rewatched.positiveWeight > initial.positiveWeight!);
  assert.ok(behaviorSignal({ kind: "consumption", seconds: 30, totalSeconds: 120, rewatch: true }).positive > behaviorSignal({ kind: "consumption", seconds: 30, totalSeconds: 120, rewatch: false }).positive);
});
test("dismissals lower observed affinity and updates still work at high confidence", () => {
  const initial = learned("python", 100);
  const updated = updateBehaviorAffinity(initial, behaviorSignal({ kind: "dismiss" }), now);
  assert.ok(updated.score < initial.score);
  assert.ok(updated.negativeWeight > 0);
  assert.ok(updated.confidence < 1);
});
test("recent behavior carries more information than months-old behavior", () => {
  const old = learned("python", 20, new Date("2026-04-02T12:00:00Z"));
  const recent = learned("react", 10);
  const profile = learner({ conceptIds: [], emergingConceptIds: ["python", "react"], affinities: new Map([["python", old], ["react", recent]]) });
  assert.equal(selected([video("old"), video("recent", "react")], profile)[0]?.resource.id, "recent");
});
test("adjacent exploration is bounded, deterministic, and respects quality and level", () => {
  const resources = [...Array.from({ length: 9 }, (_, i) => video(`core-${i}`)), video("adjacent", "react"), video("unsafe-adjacent", "react", "q", { qualityScore: .4 }), video("too-advanced", "react", "z", { metadata: { estimatedLevel: "advanced" } })];
  const profile = learner({ adjacentConceptIds: ["react"] });
  const first = selected(resources, profile);
  assert.equal(first.length, 6);
  assert.equal(first.filter((candidate) => candidate.reasonCodes.includes("adjacent_concept")).length, 1);
  assert.ok(first.some((candidate) => candidate.resource.id === "adjacent"));
  assert.deepEqual(first.map((card) => card.resource.id), selected(resources, profile).map((card) => card.resource.id));
  assert.ok(!first.some((card) => ["unsafe-adjacent", "too-advanced"].includes(card.resource.id)));
});
test("channel diversity limits repetitions when alternatives exist", () => {
  const resources = [...Array.from({ length: 10 }, (_, i) => video(`same-${i}`, "python", "Same channel")), ...Array.from({ length: 6 }, (_, i) => video(`other-${i}`, "python", `Channel ${i}`, { qualityScore: .85 }))];
  const feed = selected(resources);
  assert.equal(feed.length, 6);
  assert.ok(feed.filter((card) => card.resource.channelTitle === "Same channel").length <= 2);
});
test("completed videos are suppressed, with one evidence-backed due review allowed", () => {
  const completedAt = new Date("2026-09-01T12:00:00Z");
  const progress = new Map([["done", { progressPct: 100, completedAt, updatedAt: completedAt }]]);
  assert.deepEqual(selected([video("done"), video("new")], learner({ progress })).map((card) => card.resource.id), ["new"]);
  const mastery = new Map([["python", { score: .5, uncertainty: .2, evidenceCount: 10, nextReviewAt: new Date("2026-10-01"), updatedAt: now }]]);
  assert.ok(selected([video("done")], learner({ progress, mastery })).some((candidate) => candidate.reasonCodes.includes("review_due")));
});
test("confidence transitions continuously and keeps a weak onboarding prior", () => {
  const cold = personalizationWeights([], now, now);
  const blended = personalizationWeights([learned("python", 2)], now, now);
  const established = personalizationWeights([learned("python", 50)], new Date("2026-01-01"), now);
  assert.equal(cold.onboarding, 1);
  assert.ok(cold.behavior < blended.behavior && blended.behavior < established.behavior);
  assert.ok(established.onboarding > 0 && established.onboarding < .15);
});
test("goals, prerequisites and session continuity have truthful distinct reasons", () => {
  const profile = learner({ conceptIds: ["transformers"], goalConceptIds: ["transformers"], sessionConceptIds: ["transformers"], adjacentConceptIds: ["linear-algebra"], prerequisites: [{ sourceConceptId: "linear-algebra", targetConceptId: "transformers" }], progress: new Map([["ongoing", { progressPct: 50, completedAt: null, updatedAt: now }]]) });
  const feed = selected([video("goal", "transformers"), video("foundation", "linear-algebra"), video("ongoing", "transformers")], profile);
  assert.ok(feed.find((card) => card.resource.id === "foundation")?.reasonCodes.includes("prerequisite_gap"));
  assert.ok(feed.find((card) => card.resource.id === "ongoing")?.reasonCodes.includes("continue_learning"));
  assert.ok(feed.find((card) => card.resource.id === "goal")?.reasonCodes.includes("active_goal"));
});
test("format, duration and available language preferences are respected", () => {
  const profile = learner({ persona: "builder", preferredFormats: ["learn_by_building"], preferredDuration: "under_10_minutes", preferredLanguages: ["en"] });
  const resources = [video("hands-on", "python", "a", { durationMs: 300_000, metadata: { estimatedLevel: "beginner", learningFormat: "hands_on" } }), video("lecture"), video("wrong-language", "python", "b", { language: "es" })];
  const feed = selected(resources, profile);
  assert.equal(feed[0]?.resource.id, "hands-on");
  assert.ok(feed[0]?.reasonCodes.includes("format_fit"));
  assert.ok(!feed.some((card) => card.resource.id === "wrong-language"));
});
test("unacted impressions are a weak penalty and measured retention improves utility", () => {
  const resources = [video("ignored"), video("retained", "python", "r", { quality: { finalQualityScore: .9, freshnessPrior: .5, sourceAuthority: .8, completionRate: .95, retentionRate: .95 } })];
  const feed = selected(resources, learner({ ignoredImpressions: new Map([["ignored", 8]]) }));
  assert.equal(feed[0]?.resource.id, "retained");
  assert.equal(feed.find((card) => card.resource.id === "ignored")?.features?.ignoredImpressionPenalty, .18);
});


test("hybrid semantic relevance discovers related material beyond literal concept matching", () => {
  const feed = rankDiscoveryResources([video("semantic", "attention", "a", { semanticSimilarity: .91 }), video("unrelated", "quantum", "b", { semanticSimilarity: .2 })], learner({ semanticRanking: true }), now, 24).videos.filter((candidate) => candidate.finalRank);
  assert.deepEqual(feed.map((candidate) => candidate.resource.id), ["semantic"]);
  assert.ok(feed[0]?.reasonCodes.includes("semantic_match"));
  assert.equal(feed[0]?.features?.semantic, .91);
});
test("hybrid full feed preserves diversity and reserves controlled adjacent exploration", () => {
  const resources = [...Array.from({ length: 50 }, (_, i) => video(`core-${i}`, "python", `Creator ${i % 8}`, { semanticSimilarity: .8, metadata: { estimatedLevel: "beginner", playlistId: String(i % 12), subtopic: String(i % 6) } })), ...Array.from({ length: 8 }, (_, i) => video(`adjacent-${i}`, "react", `Adjacent ${i}`, { semanticSimilarity: .7 }))];
  const profile = learner({ semanticRanking: true, adjacentConceptIds: ["react"] });
  const feed = rankDiscoveryResources(resources, profile, now, 24).videos.filter((candidate) => candidate.finalRank);
  assert.equal(feed.length, 24);
  assert.equal(new Set(feed.map((candidate) => candidate.resource.id)).size, 24);
  const explorations = feed.filter((candidate) => candidate.reasonCodes.includes("adjacent_concept"));
  assert.ok(explorations.length >= 1 && explorations.length <= 3);
  for (const creator of new Set(feed.map((candidate) => candidate.resource.channelTitle))) assert.ok(feed.filter((candidate) => candidate.resource.channelTitle === creator).length <= 8);
});
test("playlist continuation and next-level material retain distinct evidence-backed reasons", () => {
  const resources = [video("next", "python", "a", { playlistContinuation: true, semanticSimilarity: .8 }), video("deeper", "python", "b", { semanticSimilarity: .8, metadata: { estimatedLevel: "intermediate" } })];
  const feed = rankDiscoveryResources(resources, learner({ semanticRanking: true, completedIntroConceptIds: ["python"] }), now, 24).videos;
  assert.ok(feed.find((candidate) => candidate.resource.id === "next")?.reasonCodes.includes("playlist_continuation"));
  assert.ok(feed.find((candidate) => candidate.resource.id === "deeper")?.reasonCodes.includes("next_level"));
  assert.ok((feed.find((candidate) => candidate.resource.id === "deeper")?.features?.levelFit ?? 0) >= .85);
});

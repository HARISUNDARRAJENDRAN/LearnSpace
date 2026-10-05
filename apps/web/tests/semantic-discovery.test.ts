import assert from "node:assert/strict";
import test from "node:test";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { normalizeVector, validVector, updateVector, retrievalVector, updateLearningState, observationFromActivity, type CompactLearningState } from "@learnspace/shared/recommendation-model";
import { recommendationCacheKey, recommendationProfileKey } from "@learnspace/shared/recommendation-cache";
const axis = (index: number) => Array.from({ length: config.embeddingDimensions }, (_, i) => i === index ? 1 : 0);
const now = new Date();
const state = (): CompactLearningState => ({ longTermInterests: { programming: 1 }, recentInterests: {}, longTermVector: axis(0), recentVector: null, evidence: 0, updatedAt: now.toISOString() });
test("finite nonzero vectors and normalized bounded incremental math", () => {
  for (const value of [null, [], [1], axis(0).map(() => 0), axis(0).map(() => NaN), axis(0).map(() => Infinity)]) assert.equal(validVector(value), false);
  assert.equal(validVector(axis(0)), true);
  assert.throws(() => normalizeVector([0, 0]));
  assert.deepEqual(updateVector(axis(0), axis(1), 0), axis(0));
  const blended = updateVector(axis(0), axis(1), .2);
  assert.ok(Math.abs(Math.hypot(...blended) - 1) < 1e-9);
  assert.ok(blended[0]! > blended[1]!);
  assert.deepEqual(updateVector(axis(0), axis(0).map((n) => -n), .5), axis(0));
  assert.equal(validVector(retrievalVector({ ...state(), recentVector: axis(0).map((n) => -n), evidence: 7 / 6, updatedAt: new Date(Date.now() + 1000).toISOString() })), true);
});
test("accidental click and playback ticks leave the profile untouched", () => {
  const previous = state();
  assert.equal(updateLearningState(previous, { kind: "open" }, { quantum: 1 }, axis(1), now), previous);
  assert.equal(observationFromActivity("resource.progressed", { progressPct: 12, watchedSeconds: 80 }), null);
  assert.equal(observationFromActivity("unsupported", {}), null);
  assert.deepEqual(observationFromActivity("resource.completed", { progressPct: 95, watchedSeconds: 200 }), { kind: "complete", progress: .95, watchedSeconds: 200 });
});
test("recent repeated behavior shifts retrieval while retaining durable interests", () => {
  let current = state();
  for (let i = 0; i < 20; i++) current = updateLearningState(current, { kind: "complete", progress: .95, watchedSeconds: 300 }, { transformers: 1 }, axis(1), now);
  assert.ok(current.longTermInterests.programming! > 0);
  assert.ok(current.recentInterests.transformers! > 1);
  assert.ok(retrievalVector(current)![1]! > retrievalVector(current)![0]!);
  assert.equal(state().recentVector, null);
  assert.deepEqual(retrievalVector(state()), axis(0));
});
test("historical catch-up never rewinds the clock and recent evidence decays faster", () => {
  const old = new Date(now.getTime() - 28 * 86400000);
  const current = updateLearningState(state(), { kind: "complete", progress: .98, watchedSeconds: 300 }, { transformers: 1 }, axis(1), old);
  assert.equal(current.updatedAt, now.toISOString());
  assert.ok(current.recentInterests.transformers! < current.longTermInterests.transformers! / 5);
  const dismissed = updateLearningState(current, { kind: "dismiss" }, { transformers: 1 }, axis(1), now);
  assert.ok(dismissed.longTermInterests.transformers! < current.longTermInterests.transformers!);
  assert.deepEqual(dismissed.recentVector, current.recentVector);
});
test("scoring weights normalize and cache scopes cannot collide across users or topics", () => {
  assert.ok(Math.abs(Object.values(config.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.notEqual(recommendationCacheKey("a:b", "c"), recommendationCacheKey("a", "b:c"));
  assert.notEqual(recommendationCacheKey("a", "topic"), recommendationCacheKey("b", "topic"));
  assert.notEqual(recommendationCacheKey("a"), recommendationCacheKey("a", "topic"));
  assert.notEqual(recommendationProfileKey("a"), recommendationProfileKey("b"));
});

test("explicit vector can be removed without deleting learned durable evidence", () => {
  const explicit = { ...state(), longTermInterests: {}, longTermVector: null, onboardingVector: axis(0) };
  assert.deepEqual(retrievalVector(explicit), axis(0));
  const learned = updateLearningState(explicit, { kind: "save" }, { ai: 1 }, axis(1), now);
  assert.equal(learned.longTermInterests.programming, undefined);
  assert.ok(learned.longTermInterests.ai! > 0);
  assert.deepEqual(learned.onboardingVector, axis(0));
  assert.deepEqual(retrievalVector({ ...learned, onboardingVector: null }), axis(1));
});

import assert from "node:assert/strict";
import test from "node:test";
import { discoveryAgentPayload, discoveryPayload, nextRefreshAt, parseBatch, refreshIntervalHours, resourceIdsFromJobResult } from "./discovery.js";

test("discovery jobs are scoped to one canonical concept", () => {
  const payload = discoveryPayload(
    "trace",
    "00000000-0000-0000-0000-000000000101",
    "Physics",
  );
  assert.deepEqual(payload.concept_ids, ["00000000-0000-0000-0000-000000000101"]);
  assert.deepEqual(payload.concept_names, ["Physics"]);
  assert.equal(payload.concept_id, "00000000-0000-0000-0000-000000000101");
  assert.equal(payload.level, "mixed");
  assert.deepEqual(payload.preferred_formats, []);
  assert.equal(payload.audit_user_id, null);
  assert.equal(payload.force_refresh, false);
});

test("agent requests exclude worker-only scheduling fields", () => {
  const payload = discoveryAgentPayload({
    ...discoveryPayload(
      "trace",
      "00000000-0000-0000-0000-000000000101",
      "Physics",
    ),
    refresh_reason: "scheduled",
  });
  assert.equal("concept_id" in payload, false);
  assert.equal("concept_name" in payload, false);
  assert.equal("refresh_reason" in payload, false);
  assert.deepEqual(payload.concept_ids, ["00000000-0000-0000-0000-000000000101"]);
  assert.deepEqual(payload.concept_names, ["Physics"]);
  assert.equal(payload.level, "mixed");
  assert.deepEqual(payload.preferred_formats, []);
  assert.equal(payload.audit_user_id, null);
});

test("shared concept agent requests cannot inherit a learner profile", () => {
  const payload = discoveryAgentPayload({
    concept_ids: ["00000000-0000-0000-0000-000000000101"],
    concept_names: ["Physics"],
    level: "beginner",
    preferred_formats: ["clear_explanations"],
    audit_user_id: "00000000-0000-0000-0000-000000000001",
  });
  assert.equal(payload.level, "mixed");
  assert.deepEqual(payload.preferred_formats, []);
  assert.equal(payload.audit_user_id, null);
});

test("smoke agent requests can explicitly bypass a stale cache", () => {
  const payload = discoveryAgentPayload({
    ...discoveryPayload(
      "trace",
      "00000000-0000-0000-0000-000000000101",
      "Physics",
    ),
    force_refresh: true,
  });
  assert.equal(payload.force_refresh, true);
});

test("agent payload construction rejects multi-concept refreshes", () => {
  assert.throws(() => discoveryAgentPayload({
    concept_ids: ["concept-a", "concept-b"],
    concept_names: ["A", "B"],
  }), /one canonical concept/);
});

test("refresh policy is tiered, configurable, and jittered deterministically", () => {
  assert.equal(refreshIntervalHours("AI / Machine Learning"), 12);
  assert.equal(refreshIntervalHours("Physics"), 72);
  const finishedAt = new Date("2026-01-01T00:00:00.000Z");
  const first = nextRefreshAt("concept-a", "Physics", finishedAt);
  assert.equal(first.getTime(), nextRefreshAt("concept-a", "Physics", finishedAt).getTime());
  assert.ok(first.getTime() > finishedAt.getTime() + 60 * 60 * 1000);
});

test("scheduled payloads contain no learner-specific state", () => {
  const scheduled = {
    ...discoveryPayload("trace", "concept", "Physics"),
    level: "beginner",
    preferred_formats: ["hands_on"],
    audit_user_id: "user",
    refresh_reason: "scheduled",
  };
  const agentPayload = discoveryAgentPayload(scheduled);
  assert.equal(agentPayload.level, "mixed");
  assert.deepEqual(agentPayload.preferred_formats, []);
  assert.equal(agentPayload.audit_user_id, null);
  assert.equal("refresh_reason" in agentPayload, false);
});

test("worker rejects YouTube candidates with an unknown learning format", () => {
  const result = parseBatch({
    trace_id: "trace",
    youtube: [{
      youtube_id: "dQw4w9WgXcQ",
      canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "A practical lesson",
      confidence: 0.8,
      learning_format: "not-a-learning-format",
    }],
  });
  assert.deepEqual(result.youtube, []);
});

test("smoke ownership comes only from bounded job result resource IDs", () => {
  const createdResourceId = "00000000-0000-0000-0000-000000000201";
  const existingResourceId = "00000000-0000-0000-0000-000000000202";
  const unrelatedResourceId = "00000000-0000-0000-0000-000000000203";
  assert.deepEqual(
    resourceIdsFromJobResult({
      resourceIds: [createdResourceId, existingResourceId, unrelatedResourceId, createdResourceId, "not-a-uuid"],
    }),
    [createdResourceId, existingResourceId, unrelatedResourceId],
  );
  assert.deepEqual(resourceIdsFromJobResult({}), []);
});

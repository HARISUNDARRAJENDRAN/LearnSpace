import assert from "node:assert/strict";
import test from "node:test";
import { discoveryAgentPayload, discoveryPayload, nextRefreshAt, refreshIntervalHours } from "./discovery.js";

test("discovery jobs are scoped to one canonical concept", () => {
  const payload = discoveryPayload(
    { level: "beginner", preferredFormats: ["clear_explanations"] },
    "00000000-0000-0000-0000-000000000001",
    "trace",
    "00000000-0000-0000-0000-000000000101",
    "Physics",
  );
  assert.deepEqual(payload.concept_ids, ["00000000-0000-0000-0000-000000000101"]);
  assert.deepEqual(payload.concept_names, ["Physics"]);
  assert.equal(payload.concept_id, "00000000-0000-0000-0000-000000000101");
});

test("agent requests exclude worker-only scheduling fields", () => {
  const payload = discoveryAgentPayload({
    ...discoveryPayload(
      { level: "beginner", preferredFormats: ["clear_explanations"] },
      "00000000-0000-0000-0000-000000000001",
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
});

test("refresh policy is tiered, configurable, and jittered deterministically", () => {
  assert.equal(refreshIntervalHours("AI / Machine Learning"), 12);
  assert.equal(refreshIntervalHours("Physics"), 72);
  const finishedAt = new Date("2026-01-01T00:00:00.000Z");
  const first = nextRefreshAt("concept-a", "Physics", finishedAt);
  assert.equal(first.getTime(), nextRefreshAt("concept-a", "Physics", finishedAt).getTime());
  assert.ok(first.getTime() > finishedAt.getTime() + 60 * 60 * 1000);
});

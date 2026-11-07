import assert from "node:assert/strict";
import test from "node:test";
import { discoveryLanes } from "./discovery-lanes.js";

test("an unknown profile gets the basics and recent lanes", () => {
  assert.deepEqual(discoveryLanes({}), ["beginner_friendly", "recent"]);
});

test("builders get practical videos, researchers get depth", () => {
  assert.deepEqual(discoveryLanes({ persona: "builder", learningIntents: ["build_project"] }), ["practical", "recent"]);
  assert.deepEqual(discoveryLanes({ persona: "researcher", preferredFormats: ["research_backed"] }), ["in_depth", "recent"]);
});

test("a beginner who wants depth and building keeps basics first and at most two profile lanes", () => {
  assert.deepEqual(
    discoveryLanes({ persona: "student", learningIntents: ["build_project", "research"], preferredFormats: ["deep_dives"], level: "beginner" }),
    ["beginner_friendly", "practical", "recent"],
  );
});

test("an advanced builder skips the basics", () => {
  assert.deepEqual(discoveryLanes({ persona: "builder", level: "advanced", preferredFormats: ["learn_by_building"] }), ["practical", "in_depth", "recent"]);
});

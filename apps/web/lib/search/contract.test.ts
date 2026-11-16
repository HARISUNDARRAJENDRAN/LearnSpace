import assert from "node:assert/strict";
import { test } from "node:test";
import { isSearchResultAllowed, searchModeSchema, searchQuerySchema } from "./contract";

test("global search requires one of the two explicit modes", () => {
  assert.deepEqual(searchQuerySchema.parse({ mode: "learn", q: "  calculus " }), { mode: "learn", q: "calculus" });
  assert.equal(searchModeSchema.safeParse("research").success, true);
  assert.equal(searchModeSchema.safeParse("all").success, false);
  assert.equal(searchQuerySchema.safeParse({ q: "calculus" }).success, false);
});

test("search result scope admits only mode-appropriate content", () => {
  assert.equal(isSearchResultAllowed("learn", { kind: "resource", resourceType: "video" }), true);
  assert.equal(isSearchResultAllowed("learn", { kind: "resource", resourceType: "paper" }), false);
  assert.equal(isSearchResultAllowed("learn", { kind: "session", resourceType: "paper" }), false);
  assert.equal(isSearchResultAllowed("learn", { kind: "author", resourceType: "paper" }), false);
  assert.equal(isSearchResultAllowed("research", { kind: "resource", resourceType: "paper" }), true);
  assert.equal(isSearchResultAllowed("research", { kind: "resource", resourceType: "video" }), false);
  assert.equal(isSearchResultAllowed("research", { kind: "session", resourceType: "video" }), false);
  assert.equal(isSearchResultAllowed("research", { kind: "lesson", resourceType: null }), false);
  assert.equal(isSearchResultAllowed("research", { kind: "author", resourceType: null }), true);
});

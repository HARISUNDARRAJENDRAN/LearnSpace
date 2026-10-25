import assert from "node:assert/strict";
import test from "node:test";
import { AuthError } from "../lib/auth/errors";
import { loadHomeData } from "../lib/home/load";
import type { LearnHomeData } from "../lib/home/service";

const home: LearnHomeData = { activity: { today: "2026-09-27", days: [] }, continueWatching: null, relatedAnchor: null, relatedVideos: [], recentLessons: [] };

test("Home loads its dashboard data", async () => {
  const result = await loadHomeData("user", async () => home);
  assert.deepEqual(result, { home });
});

test("Home propagates authentication failures", async () => {
  const error = new AuthError("SESSION_INVALID", "Session invalid", 401);
  await assert.rejects(
    () => loadHomeData("user", async () => { throw error; }),
    error,
  );
});

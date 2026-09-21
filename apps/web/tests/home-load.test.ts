import assert from "node:assert/strict";
import test from "node:test";
import { AuthError } from "../lib/auth/errors";
import { loadHomeData } from "../lib/home/load";
import type { LearnHomeData } from "../lib/home/service";

const home: LearnHomeData = { continueWatching: null, relatedAnchor: null, relatedVideos: [] };

test("Home keeps core content when recommendations or history are temporarily unavailable", async () => {
  const result = await loadHomeData("user", {
    getLearnHome: async () => home,
    getHomeFeed: async () => { throw new Error("redis unavailable"); },
    listStudySessions: async () => { throw new Error("history unavailable"); },
  });
  assert.deepEqual(result.home, home);
  assert.equal(result.feed.runId, null);
  assert.deepEqual(result.sessions, []);
});

test("Home does not turn authentication failures into an empty section", async () => {
  const error = new AuthError("SESSION_INVALID", "Session invalid", 401);
  await assert.rejects(
    () => loadHomeData("user", {
      getLearnHome: async () => home,
      getHomeFeed: async () => { throw error; },
      listStudySessions: async () => [],
    }),
    error,
  );
});

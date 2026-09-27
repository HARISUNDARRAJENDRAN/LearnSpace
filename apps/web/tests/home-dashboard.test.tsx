import assert from "node:assert/strict";
import test from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeDashboard } from "../components/home/HomeDashboard";

const router = { bfcacheId: "home-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const now = new Date("2026-09-27T00:00:00Z").toISOString();
const continueWatching = {
  resourceId: "video-resource", title: "React Course", description: "Continue learning about React components.", channelTitle: "LearnSpace", youtubeId: "video-id",
  thumbnailUrl: null, thumbnailFallbackUrl: null, durationMs: 2_700_000, sessionId: "video-session", progressPct: 64, lastActiveAt: now,
};
const markup = renderToStaticMarkup(
  <AppRouterContext.Provider value={router}>
    <HomeDashboard home={{ continueWatching, relatedAnchor: null, relatedVideos: [] }} />
  </AppRouterContext.Provider>,
);

test("Home renders the dashboard without removed activity cards", () => {
  for (const title of ["Learning Overview", "Study Distribution", "Weekly Progress", "Continue Watching", "Learning Activity &amp; Progress Trends"]) {
    assert.match(markup, new RegExp(title));
  }
  assert.doesNotMatch(markup, /Learning Comparison|Recent Activity/);
  assert.match(markup, /\+36%/);
  assert.match(markup, /85\.2%/);
  assert.match(markup, /React Course/);
  assert.match(markup, /64%/);
  assert.match(markup, /href="\/app\/study\/video\/video-session"/);
  assert.match(markup, /Month/);
  assert.doesNotMatch(markup, /Good morning|Welcome back/);
});

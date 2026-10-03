import assert from "node:assert/strict";
import test from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { createHomeAnalytics } from "../lib/home/analytics";
import { formatLearningDuration } from "../lib/home/duration";
import type { HomeActivityDay, LearnHomeData } from "../lib/home/service";

const router = { bfcacheId: "home-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const now = new Date("2026-09-27T00:00:00Z").toISOString();
const continueWatching = {
  resourceId: "video-resource", title: "React Course", description: "Continue learning about React components.", channelTitle: "LearnSpace", youtubeId: "video-id",
  thumbnailUrl: null, thumbnailFallbackUrl: null, durationMs: 2_700_000, sessionId: "video-session", progressPct: 64, lastActiveAt: now,
};
const markup = renderToStaticMarkup(
  <AppRouterContext.Provider value={router}>
    <HomeDashboard home={{ activity: { today: "2026-09-27", days: [{ day: "2026-09-27", focusSeconds: 38, practiceSeconds: 0, researchSeconds: 0, videoSeconds: 38, paperSeconds: 0, otherSeconds: 0, resources: 1, completed: 0 }] }, continueWatching, relatedAnchor: null, relatedVideos: [] }} />
  </AppRouterContext.Provider>,
);

test("Home renders the dashboard without removed activity cards", () => {
  for (const title of ["Learning Overview", "Study Distribution", "Weekly Progress", "Continue Watching", "Learning Activity &amp; Progress Trends"]) {
    assert.match(markup, new RegExp(title));
  }
  assert.doesNotMatch(markup, /Learning Comparison|Recent Activity/);
  assert.doesNotMatch(markup, /Sample|sample|\+36%|85\.2%|8h 12m|0h/);
  assert.match(markup, /38 sec/);
  assert.match(markup, /Your learning trends will appear/);
  assert.match(markup, /React Course/);
  assert.match(markup, /aria-valuenow="64"/);
  assert.match(markup, /href="\/app\/study\/video\/video-session"/);
  assert.match(markup, /Month/);
  assert.doesNotMatch(markup, /Good morning|Welcome back/);
});

const emptyHome: LearnHomeData = { activity: { today: "2026-09-27", days: [] }, continueWatching: null, relatedAnchor: null, relatedVideos: [] };
const day = (date: string, duration: number): HomeActivityDay => ({ day: date, focusSeconds: duration, researchSeconds: 0, practiceSeconds: 0, videoSeconds: duration, paperSeconds: 0, otherSeconds: 0, resources: 1, completed: 0 });

test("empty Home keeps all five cards without fabricated charts or metrics", () => {
  const html = renderToStaticMarkup(<AppRouterContext.Provider value={router}><HomeDashboard home={emptyHome} /></AppRouterContext.Provider>);
  assert.equal((html.match(/<section class="analytics-card/g) ?? []).length, 5);
  assert.match(html, /Your learning starts here/);
  assert.match(html, /Your study mix will appear/);
  assert.match(html, /Your progress will appear/);
  assert.match(html, /Your next lesson awaits/);
  assert.match(html, /Your learning trends will appear/);
  assert.doesNotMatch(html, /analytics-bubble|analytics-ring-arc|analytics-trend-dot|0h|0 sec|Sample|sample|analytics-bar tone/);
});

test("duration units advance at their boundaries", () => {
  for (const [duration, expected] of [[0, "0 sec"], [38, "38 sec"], [59.9, "59 sec"], [60, "1 min"], [240, "4 min"], [2820, "47 min"], [3599, "59 min"], [3600, "1h"], [4440, "1h 14m"], [12240, "3h 24m"], [-1, "0 sec"], [NaN, "0 sec"], [Infinity, "0 sec"]] as const) assert.equal(formatLearningDuration(duration), expected);
});

test("real history powers calendar periods, comparisons and distributions", () => {
  const home = { ...emptyHome, activity: { today: "2026-09-27", days: [day("2025-12-31", 3600), day("2026-09-20", 60), day("2026-09-27", 120), day("2026-10-01", 999)] } };
  const analytics = createHomeAnalytics(home);
  assert.equal(analytics.learningOverview.seconds, 3780);
  assert.equal(analytics.learningOverview.activeDays, 3);
  assert.equal(analytics.learningOverview.changePct, 100);
  assert.equal(analytics.learningOverview.bars.length, 4);
  assert.deepEqual(analytics.weeklyProgress.map((period) => period.seconds), [120, 60, 180]);
  assert.deepEqual(analytics.studyDistribution.map(({ label, percent }) => [label, percent]), [["Videos", 100]]);
  assert.equal(analytics.activityTrends.Year.length, 2);
  assert.equal(analytics.activityTrends.Year[0]?.seconds, 3600);
  assert.equal(analytics.activityTrends.Month.find((point) => point.title === "September 2026")?.seconds, 180);
  assert.equal(analytics.activityTrends.Day.reduce((sum, point) => sum + point.seconds, 0), 120);
});

test("resource activity without time does not manufacture duration or percentages", () => {
  const analytics = createHomeAnalytics({ ...emptyHome, activity: { today: "2026-09-27", days: [day("2026-09-27", 0)] } });
  assert.equal(analytics.learningOverview.seconds, 0);
  assert.equal(analytics.learningOverview.changePct, null);
  assert.deepEqual(analytics.studyDistribution, []);
  assert.equal(analytics.weeklyProgress[0]?.resources, 1);
});

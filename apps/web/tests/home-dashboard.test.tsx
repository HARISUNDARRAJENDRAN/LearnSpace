import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { HomeActivity } from "../components/home/HomeActivity";
import { createHomeAnalytics } from "../lib/home/analytics";
import { formatLearningDuration } from "../lib/home/duration";
import type { HomeActivityDay, LearnHomeData } from "../lib/home/service";

const user = { displayName: "Hari Sundar", email: "hari@example.test" };
const emptyHome: LearnHomeData = { sessions: [], sessionCounts: { total: 0, completed: 0, videos: 0, videosCompleted: 0, papers: 0, papersCompleted: 0 }, activity: { today: "2026-09-27", days: [] }, continueWatching: null, relatedAnchor: null, relatedVideos: [] };
const day = (date: string, duration: number): HomeActivityDay => ({ day: date, focusSeconds: duration, researchSeconds: 0, practiceSeconds: 0, videoSeconds: duration, paperSeconds: 0, otherSeconds: 0, resources: 1, completed: 0 });

test("Home unifies video and paper sessions, real previews, progress and resume links", () => {
  const home: LearnHomeData = { ...emptyHome, sessionCounts: { total: 2, completed: 1, videos: 1, videosCompleted: 0, papers: 1, papersCompleted: 1 }, sessions: [
    { id: "video-session", resourceId: "video", title: "React Course", description: null, source: "LearnSpace", youtubeId: null, type: "video", progressPct: 64, completed: false, lastActiveAt: "2026-09-27T00:00:00Z" },
    { id: "paper-session", resourceId: "paper", title: "Learning from Research", description: "The actual paper abstract.", source: "arXiv", youtubeId: null, type: "paper", progressPct: 100, completed: true, lastActiveAt: "2026-09-26T00:00:00Z" },
  ] };
  const markup = renderToStaticMarkup(<HomeDashboard home={home} user={user} />);
  for (const heading of ["Welcome back, Hari!", "Your Learning Activity", "Continue Learning", "Learning Progress", "Quick Stats"]) assert.ok(markup.includes(heading));
  assert.match(markup, /The actual paper abstract/);
  assert.match(markup, /href="\/app\/study\/video\/video-session"/);
  assert.match(markup, /href="\/app\/study\/paper\/paper-session"/);
  assert.match(markup, /value="64"/);
  assert.match(markup, /aria-valuenow="50"/);
  assert.doesNotMatch(markup, /Today.s Plan|View Full Schedule|Calendar/);
});

test("empty Home keeps chart axes, statistics and useful navigation without invented history", () => {
  const markup = renderToStaticMarkup(<HomeDashboard home={emptyHome} user={user} />);
  assert.match(markup, /Your learning starts here/);
  assert.match(markup, /Your first lesson awaits/);
  assert.match(markup, /href="\/app\/discover"/);
  assert.match(markup, /aria-valuenow="0"/);
  assert.doesNotMatch(markup, /home-activity-bar|home-session-card|Sample data/);
});

test("activity periods respect learner dates, week boundaries and leap months", () => {
  const analytics = createHomeAnalytics({ ...emptyHome, activity: { today: "2026-09-27", days: [day("2025-12-31", 3600), day("2026-09-20", 60), day("2026-09-26", 120), day("2026-09-27", 38), day("2026-10-01", 999)] } });
  assert.equal(analytics.seconds, 3818);
  assert.equal(analytics.streak, 2);
  assert.equal(analytics.periods["This Week"].length, 7);
  assert.equal(analytics.periods["This Week"][0]?.label, "Mon");
  assert.equal(analytics.periods["This Week"].reduce((sum, point) => sum + point.seconds, 0), 158);
  assert.equal(analytics.periods["Last Week"].reduce((sum, point) => sum + point.seconds, 0), 60);
  const leap = createHomeAnalytics({ ...emptyHome, activity: { today: "2024-02-29", days: [] } });
  assert.equal(leap.periods["This Month"].length, 29);
  assert.equal(leap.streak, 0);
});

test("a streak continues through yesterday and excludes resource opens without measured time", () => {
  const analytics = createHomeAnalytics({ ...emptyHome, activity: { today: "2026-09-27", days: [day("2026-09-25", 60), day("2026-09-26", 60), day("2026-09-27", 0)] } });
  assert.equal(analytics.streak, 2);
  assert.equal(analytics.seconds, 120);
});

test("short activity uses readable second ticks and a single server-rendered tooltip string", () => {
  const analytics = createHomeAnalytics({ ...emptyHome, activity: { today: "2026-09-27", days: [day("2026-09-27", 38)] } });
  const markup = renderToStaticMarkup(<HomeActivity periods={analytics.periods} />);
  assert.match(markup, /15 sec/);
  assert.match(markup, /30 sec/);
  assert.match(markup, /<title>2026-09-27: 38 sec<\/title>/);
});

test("duration units advance at their boundaries", () => {
  for (const [duration, expected] of [[0, "0 sec"], [38, "38 sec"], [59.9, "59 sec"], [60, "1 min"], [240, "4 min"], [2820, "47 min"], [3599, "59 min"], [3600, "1h"], [4440, "1h 14m"], [12240, "3h 24m"], [-1, "0 sec"], [NaN, "0 sec"], [Infinity, "0 sec"]] as const) assert.equal(formatLearningDuration(duration), expected);
});

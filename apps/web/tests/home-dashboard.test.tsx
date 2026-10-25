import assert from "node:assert/strict";
import test from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { createHomePulse } from "../lib/home/analytics";
import { formatLearningDuration } from "../lib/home/duration";
import type { HomeActivityDay, HomeLesson, LearnHomeData } from "../lib/home/service";

const router = { bfcacheId: "home-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const emptyHome: LearnHomeData = { activity: { today: "2026-09-24", days: [] }, continueWatching: null, relatedAnchor: null, relatedVideos: [], recentLessons: [] };
const day = (date: string, duration: number, extra: Partial<HomeActivityDay> = {}): HomeActivityDay => ({ day: date, focusSeconds: duration, researchSeconds: 0, practiceSeconds: 0, videoSeconds: duration, paperSeconds: 0, otherSeconds: 0, resources: 1, completed: 0, ...extra });
const lesson = (title: string, extra: Partial<HomeLesson> = {}): HomeLesson => ({ resourceId: title, title, type: "video", source: "LearnSpace", durationMs: 2_700_000, progressPct: 64, status: "in_progress", spentSeconds: 840, startedDay: "2026-09-20", openedDay: "2026-09-23", ...extra });
const render = (home: LearnHomeData) => renderToStaticMarkup(<AppRouterContext.Provider value={router}><HomeDashboard home={home} name="Ada" /></AppRouterContext.Provider>);
const home: LearnHomeData = { ...emptyHome, activity: { today: "2026-09-24", days: [
  day("2026-09-07", 600),
  day("2026-09-14", 60, { completed: 1 }), day("2026-09-16", 120),
  day("2026-09-21", 120, { completed: 2 }), day("2026-09-23", 0), day("2026-09-24", 300, { paperSeconds: 300, videoSeconds: 0, researchSeconds: 300, focusSeconds: 0 }),
  day("2026-09-26", 999),
] } };

test("Home renders real lessons, rhythm and the week", () => {
  const markup = render({ ...home, recentLessons: [lesson("React Course"), lesson("Attention paper", { type: "pdf", status: "completed", durationMs: null, openedDay: "2026-08-01" })] });
  for (const text of ["Hello, Ada", "1-day streak, nice work", "Building · studied 2 of 4 days", "3 min by now last week", "\\+133%", "Your best day was Thu with 5 min", "Continue: React Course", "Resume lesson", "Yesterday", "1 Aug", "45<small> min", "Library"]) assert.match(markup, new RegExp(text));
  assert.doesNotMatch(markup, /Learning age|Research time|Total lessons|Find your next lesson/);
  assert.equal((markup.match(/class="home-lesson-row" aria-pressed="true"/g) ?? []).length, 1);
  assert.match(markup, /<h3 title="React Course">React Course<\/h3><p>LearnSpace · \d+% explored<\/p>/);
  assert.equal((markup.match(/home-week-fill/g) ?? []).length, 2);
  assert.match(markup, /Attention paper<\/b><small>LearnSpace<\/small><\/span><span>14 min<\/span><span>Completed/);
  assert.equal((markup.match(/<i class="is-on"/g) ?? []).length, 2 + 2 + 1 + 3);
});

test("only drops that matter turn orange", () => {
  const markup = render({ ...emptyHome, activity: { today: "2026-09-24", days: [day("2026-09-15", 60), day("2026-09-22", 60, { resources: 0 })] } });
  assert.match(markup, /home-pill is-grey">−100%/);
  assert.match(markup, /home-pill is-lime">Steady/);
  assert.doesNotMatch(markup, /home-pill is-orange/);
});

test("empty Home shows guidance instead of fabricated metrics", () => {
  const html = render(emptyHome);
  for (const text of ["Here is your learning rhythm", "Your recent lessons will appear here", "Find your next lesson", "Find a lesson", "Your study days will fill in here", "Building · studied 0 of 4 days", "Not yet"]) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /home-gauge-change|home-week-fill|<span>Length/);
});

test("duration units advance at their boundaries", () => {
  for (const [duration, expected] of [[0, "0 sec"], [38, "38 sec"], [59.9, "59 sec"], [60, "1 min"], [240, "4 min"], [2820, "47 min"], [3599, "59 min"], [3600, "1h"], [4440, "1h 14m"], [12240, "3h 24m"], [-1, "0 sec"], [NaN, "0 sec"], [Infinity, "0 sec"]] as const) assert.equal(formatLearningDuration(duration), expected);
});

test("pulse stats follow each period and ignore future days", () => {
  const pulse = createHomePulse(home);
  const { series: week, ...thisWeek } = pulse.periods.week;
  assert.deepEqual(thisWeek, { score: 50, previousScore: 50, days: 4, current: { studySeconds: 420, activeDays: 2, started: 3, completed: 2 }, previous: { studySeconds: 180, activeDays: 2, started: 2, completed: 1 } });
  const { series: month, ...thisMonth } = pulse.periods.month;
  assert.deepEqual(thisMonth, { score: 21, previousScore: 0, days: 24, current: { studySeconds: 1200, activeDays: 5, started: 6, completed: 3 }, previous: { studySeconds: 0, activeDays: 0, started: 0, completed: 0 } });
  const { series: all, ...allTime } = pulse.periods.all;
  assert.deepEqual(allTime, { score: 28, previousScore: null, days: 18, current: { studySeconds: 1200, activeDays: 5, started: 6, completed: 3 }, previous: null });
  assert.deepEqual(week.map(({ stats }) => stats.studySeconds), [120, 0, 0, 300, 0, 0, 0]);
  assert.equal(month.length, 24);
  assert.deepEqual(all.map(({ start, stats }) => [start, stats.studySeconds]), [["2026-09-01", 1200]]);
  assert.equal(pulse.streak, 1);
  assert.deepEqual(pulse.totals, { started: 6, completed: 3, inProgress: 3, studySeconds: 1200 });
  assert.equal(pulse.firstDay, "2026-09-07");
  assert.deepEqual(pulse.formats.map(({ label, percent }) => [label, percent]), [["Videos", 75], ["Papers", 25]]);
});

test("all time charts at most the last twelve months", () => {
  const series = createHomePulse({ ...emptyHome, activity: { today: "2026-09-24", days: [day("2019-03-01", 60), day("2026-02-14", 90)] } }).periods.all.series;
  assert.equal(series.length, 12);
  assert.equal(series[0]?.start, "2025-10-01");
  assert.equal(series.find(({ start }) => start === "2026-02-01")?.stats.studySeconds, 90);
});

test("a short previous month never overlaps the current one", () => {
  const pulse = createHomePulse({ ...emptyHome, activity: { today: "2026-03-31", days: [day("2026-02-10", 60), day("2026-03-02", 90)] } });
  assert.deepEqual(pulse.periods.month.previous, { studySeconds: 60, activeDays: 1, started: 1, completed: 0 });
  assert.equal(pulse.periods.month.previousScore, 4);
});

test("a streak counts back from yesterday until today is studied", () => {
  const days = [day("2026-09-20", 60), day("2026-09-22", 60), day("2026-09-23", 60)];
  assert.equal(createHomePulse({ ...emptyHome, activity: { today: "2026-09-24", days } }).streak, 2);
  assert.equal(createHomePulse({ ...emptyHome, activity: { today: "2026-09-24", days: [...days, day("2026-09-24", 60)] } }).streak, 3);
  assert.equal(createHomePulse({ ...emptyHome, activity: { today: "2026-09-24", days: [day("2026-09-21", 60)] } }).streak, 0);
});

test("resource activity without time does not manufacture study", () => {
  const pulse = createHomePulse({ ...emptyHome, activity: { today: "2026-09-24", days: [day("2026-09-24", 0)] } });
  assert.equal(pulse.periods.week.current.studySeconds, 0);
  assert.equal(pulse.periods.week.score, 0);
  assert.equal(pulse.streak, 0);
  assert.deepEqual(pulse.formats, []);
  assert.equal(pulse.totals.started, 1);
});

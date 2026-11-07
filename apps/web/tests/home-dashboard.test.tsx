import assert from "node:assert/strict";
import test from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { fromDmy, toDmy } from "../components/home/calendar/dates";
import { layoutDay, planTone } from "../components/home/calendar/plan";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { formatLearningDuration } from "../lib/home/duration";
import type { HomeLesson, LearnHomeData } from "../lib/home/service";
import { achievements, type ActivityDay, learnerStats, levelFor, progression } from "../lib/plan/levels";
import { fallbackActions, reconcileDay, reconcileStudyItem, shouldReplan } from "../lib/plan/observer";
import type { PlanItem } from "../lib/plan/service";

const router = { bfcacheId: "home-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const render = (home: LearnHomeData) => renderToStaticMarkup(<AppRouterContext.Provider value={router}><HomeDashboard home={home} /></AppRouterContext.Provider>);
const lesson = (title: string, extra: Partial<HomeLesson> = {}): HomeLesson => ({ resourceId: title, title, type: "video", source: "LearnSpace", youtubeId: null, durationMs: 2_700_000, progressPct: 64, status: "active", spentSeconds: 840, lastSessionSeconds: 300, startedDay: "2026-09-20", openedDay: "2026-09-23", ...extra });
const item = (extra: Partial<PlanItem> = {}): PlanItem => ({ id: "a", title: "Learn polymorphism", description: null, kind: "practice", status: "planned", source: "learner", startsAt: "2026-09-24T10:00:00.000Z", endsAt: "2026-09-24T11:00:00.000Z", allDay: false, progressPct: 0, observerNote: null, evaluatedAt: null, completedAt: null, resource: null, ...extra });
const emptyHome: LearnHomeData = { today: "2026-09-24", progression: progression([], "2026-09-24"), recentLessons: [], nextActions: [] };

test("levels follow the thresholds and five ranks", () => {
  assert.deepEqual(levelFor(0), { level: 1, rank: "Bronze", levelXp: 0, nextLevelXp: 100 });
  assert.deepEqual(levelFor(100), { level: 2, rank: "Bronze", levelXp: 100, nextLevelXp: 250 });
  assert.equal(levelFor(999).level, 5);
  assert.deepEqual(levelFor(1000), { level: 6, rank: "Silver", levelXp: 1000, nextLevelXp: 1500 });
  assert.equal(levelFor(10_000).rank, "Platinum");
  assert.deepEqual(levelFor(99_999), { level: 25, rank: "Diamond", levelXp: 35_000, nextLevelXp: null });
});

test("each activity earns its own points, questions are capped, and streak days earn a bonus", () => {
  const result = progression([
    { day: "2026-09-10", activity: "watch", amount: 90 },
    { day: "2026-09-22", activity: "read", amount: 10 },
    { day: "2026-09-23", activity: "finish_video", amount: 1 },
    { day: "2026-09-23", activity: "plan_practice", amount: 1 },
    { day: "2026-09-23", activity: "question", amount: 12 },
    { day: "2026-09-25", activity: "watch", amount: 999 },
  ], "2026-09-24");
  assert.equal(result.xp, 260);
  assert.equal(result.level, 3);
  assert.equal(result.weekXp, 170);
  assert.equal(result.todayXp, 0);
  assert.equal(result.streak, 2);
  assert.deepEqual(result.earned, { watch: 90, read: 20, finish_video: 50, finish_paper: 0, question: 50, plan_watch: 0, plan_read: 0, plan_practice: 40, plan_review: 0, streak: 10 });
  // A half-done Read item earns half of its 30 points.
  assert.equal(progression([{ day: "2026-09-24", activity: "plan_read", amount: 0.5 }], "2026-09-24").xp, 15);
});

test("profile stats and achievements come from the same evidence as XP", () => {
  const days: ActivityDay[] = [
    { day: "2026-09-01", activity: "watch", amount: 300 },
    { day: "2026-09-02", activity: "watch", amount: 400 },
    { day: "2026-09-02", activity: "finish_video", amount: 2 },
    { day: "2026-09-03", activity: "plan_review", amount: 2 },
    { day: "2026-09-03", activity: "question", amount: 3 },
    { day: "2026-09-10", activity: "read", amount: 20 },
    { day: "2026-09-30", activity: "watch", amount: 999 },
  ];
  const stats = learnerStats(days, "2026-09-24");
  assert.deepEqual(stats, { activeDays: 4, longestStreak: 3, focusMinutes: 720, lessonsFinished: 2, planDone: 2, questions: 3 });
  const progress = progression(days, "2026-09-24");
  assert.equal(progress.xp, 935);
  const unlocked = achievements(progress, stats);
  assert.deepEqual(unlocked.filter((entry) => entry.unlocked).map((entry) => entry.id), ["first-steps", "finisher", "deep-focus"]);
  assert.deepEqual(unlocked.find((entry) => entry.id === "on-a-roll"), { id: "on-a-roll", title: "On a roll", detail: "Study 7 days in a row", target: 7, value: 3, unlocked: false });
  assert.equal(unlocked.find((entry) => entry.id === "silver")?.value, 5);
});

test("the observer completes study items from that day's evidence", () => {
  const window = { startsAt: new Date("2026-09-24T10:00:00Z"), endsAt: new Date("2026-09-24T10:30:00Z"), allDay: false };
  const evidence = (seconds: number, finished = false) => ({ resourceId: "r", title: "Java inheritance", type: "video", seconds, finished });
  assert.deepEqual(reconcileStudyItem(window, undefined), { progressPct: 0, done: false, note: null });
  assert.deepEqual(reconcileStudyItem(window, evidence(600)), { progressPct: 33, done: false, note: "Studied 10 of 30 planned min." });
  assert.equal(reconcileStudyItem(window, evidence(1800)).done, true);
  assert.deepEqual(reconcileStudyItem(window, evidence(60, true)), { progressPct: 100, done: true, note: "Finished Java inheritance." });
  // All-day items expect a 30 minute session.
  assert.equal(reconcileStudyItem({ ...window, allDay: true, endsAt: null }, evidence(900)).progressPct, 50);
});

test("without material, a day's study is shared among its items by kind", () => {
  const at = (hour: number) => new Date(`2026-09-24T${String(hour).padStart(2, "0")}:00:00Z`);
  const hour = (id: string, kind: "watch" | "read" | "practice" | "review", start: number) => ({ id, kind, resourceId: null, startsAt: at(start), endsAt: at(start + 1), allDay: false });
  const studied = (type: string, minutes: number) => ({ resourceId: type, title: type, type, seconds: minutes * 60, finished: false });
  const verdicts = reconcileDay([hour("w1", "watch", 9), hour("w2", "watch", 11), hour("r", "read", 10), hour("p", "practice", 14)], [studied("video", 90), studied("paper", 20)]);
  assert.deepEqual(Object.fromEntries([...verdicts].map(([id, verdict]) => [id, [verdict.progressPct, verdict.done]])), {
    w1: [100, true],
    w2: [50, false],
    r: [33, false],
    p: [0, false],
  });
  // A suggestion for the same video, accepted later in the day, must not take minutes the earlier session already earned.
  const linked = reconcileDay([{ ...hour("later", "watch", 19), resourceId: "video" }, hour("first", "watch", 18)], [studied("video", 2)]);
  assert.deepEqual([linked.get("first")?.progressPct, linked.get("later")?.progressPct], [3, 0]);
  const finished = reconcileDay([hour("first", "watch", 18), { ...hour("later", "watch", 19), resourceId: "video" }], [{ ...studied("video", 2), finished: true }]);
  assert.deepEqual([finished.get("first")?.progressPct, finished.get("later")?.done], [3, true]);
});

test("dates read and write as dd/mm/yyyy and reject impossible days", () => {
  assert.equal(toDmy("2026-11-07"), "07/11/2026");
  assert.equal(fromDmy("7/11/2026"), "2026-11-07");
  assert.equal(fromDmy("31/02/2026"), null);
  assert.equal(fromDmy("2026-11-07"), null);
});

test("the agent replans only when evidence is new or its suggestions ran out", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  assert.equal(shouldReplan({ lastPlannedAt: null, pending: 0 }, null, now), true);
  assert.equal(shouldReplan({ lastPlannedAt: at(30), pending: 2 }, at(40), now), false);
  assert.equal(shouldReplan({ lastPlannedAt: at(30), pending: 2 }, at(5), now), true);
  assert.equal(shouldReplan({ lastPlannedAt: at(10), pending: 2 }, at(5), now), false);
  assert.equal(shouldReplan({ lastPlannedAt: at(60), pending: 0 }, at(5), now), false);
  assert.equal(shouldReplan({ lastPlannedAt: at(7 * 60), pending: 0 }, null, now), true);
});

test("without a model the agent finishes open lessons first, then related material", () => {
  const actions = fallbackActions([
    { resourceId: "done", title: "Done course", type: "video", progressPct: 100, completed: true, concepts: [] },
    { resourceId: "java", title: "Java inheritance", type: "video", progressPct: 40, completed: false, concepts: ["Java"] },
  ], [{ id: "poly", title: "Polymorphism in Java", type: "video", why: "Related to Java" }, { id: "x", title: "Extra", type: "paper", why: "Related to Java" }]);
  assert.deepEqual(actions.map((action) => [action.title, action.kind, action.resourceId, action.when]), [
    ["Finish Java inheritance", "watch", "java", "today"],
    ["Watch Polymorphism in Java", "watch", "poly", "tomorrow"],
    ["Read Extra", "read", "x", "tomorrow"],
  ]);
});

test("plan tones show what the observer saw", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  assert.equal(planTone(item({ status: "done", progressPct: 100 }), now), "done");
  assert.equal(planTone(item(), now), "missed");
  assert.equal(planTone(item({ progressPct: 40 }), now), "partial");
  assert.equal(planTone(item({ startsAt: "2026-09-24T13:00:00Z", endsAt: "2026-09-24T14:00:00Z" }), now), "planned");
  assert.equal(planTone(item({ startsAt: "2026-09-24T11:30:00Z", endsAt: "2026-09-24T13:00:00Z", progressPct: 20 }), now), "active");
});

test("overlapping plan items share the column width", () => {
  const placed = layoutDay([
    { item: item({ id: "a" }), start: 600, end: 660 },
    { item: item({ id: "b" }), start: 630, end: 690 },
    { item: item({ id: "c" }), start: 720, end: 780 },
  ]);
  assert.deepEqual(placed.map(({ item: entry, column, columns }) => [entry.id, column, columns]), [["a", 0, 2], ["b", 1, 2], ["c", 0, 1]]);
});

test("Home renders recent study, the agent's next actions and the level card", () => {
  const markup = render({
    today: "2026-09-24",
    progression: progression([{ day: "2026-09-23", activity: "watch", amount: 120 }, { day: "2026-09-24", activity: "plan_watch", amount: 1 }], "2026-09-24"),
    recentLessons: [lesson("Java inheritance", { openedDay: "2026-09-23" }), lesson("Attention paper", { type: "pdf", status: "completed" })],
    nextActions: [item({ status: "suggested", source: "agent", title: "Study polymorphism next", description: "It builds on inheritance." })],
  });
  for (const text of ["Recent study", "Java inheritance", "Yesterday", "64% complete", "Last session", "5 min", "Resume", "Attention paper", "Done",
    "Next actions", "Study polymorphism next", "It builds on inheritance.", "Add to plan",
    "Level &amp; rank", "Level 2", "Bronze", "150", "100 XP to Level 3", "2-day streak", "How every activity earns XP"]) assert.match(markup, new RegExp(text));
  assert.match(markup, /aria-label="Study plan" aria-busy="true"/);
});

test("empty Home shows guidance instead of fabricated metrics", () => {
  const markup = render(emptyHome);
  assert.match(markup, /Your last video or paper will appear here/);
  assert.match(markup, /Finding what to study next/);
  assert.match(markup, /Level 1/);
  assert.match(markup, /100 XP to Level 2/);
  assert.doesNotMatch(markup, /View all/);
});

test("duration units advance at their boundaries", () => {
  for (const [duration, expected] of [[0, "0 sec"], [38, "38 sec"], [59.9, "59 sec"], [60, "1 min"], [240, "4 min"], [2820, "47 min"], [3599, "59 min"], [3600, "1h"], [4440, "1h 14m"], [12240, "3h 24m"], [-1, "0 sec"], [NaN, "0 sec"], [Infinity, "0 sec"]] as const) assert.equal(formatLearningDuration(duration), expected);
});

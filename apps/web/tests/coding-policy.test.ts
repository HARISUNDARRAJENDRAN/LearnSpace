import assert from "node:assert/strict";
import test from "node:test";
import { attemptOutcome, creditCap, emptyTracker, hintAvailability, independentSolve, masteryStatus, nextDifficulty, recordActivity, recordDecline, recordExecution, recordHint, recordOffer, shouldOffer, stallReason, startingDifficulty, transition, TransitionError, updateMastery, type Tracker, COACH_RULES, coachMoment, coachSpoke, recordCoach } from "../lib/coding/policy";

const fail = (tracker: Tracker, hash: string, failure = "case2:wrong", verdict: "ran" | "wrong_answer" | "compile_error" = "ran") =>
  recordExecution(tracker, { codeHash: hash, verdict, passed: 1, total: 3, failure: verdict === "compile_error" ? null : failure });

test("the state machine moves through a guided solve and an optimization stage, and refuses skipped steps", () => {
  let state = transition("PROBLEM_INTRO", "begin", { guided: false });
  assert.equal(state, "INDEPENDENT_ATTEMPT");
  state = transition(state, "stall", { guided: false });
  state = transition(state, "offer", { guided: false });
  assert.equal(state, "HINT_OFFERED");
  assert.equal(transition(state, "decline", { guided: false }), "INDEPENDENT_ATTEMPT");
  state = transition(state, "hint", { guided: true });
  assert.equal(state, "GUIDED_ATTEMPT");
  state = transition(state, "submit", { guided: true });
  assert.equal(transition(state, "failed", { guided: true }), "GUIDED_ATTEMPT");
  state = transition(state, "correct_slow", { guided: true });
  assert.equal(state, "OPTIMIZATION_STAGE");
  // A hint during optimization stays in optimization.
  assert.equal(transition(state, "hint", { guided: true, optimizing: true }), "OPTIMIZATION_STAGE");
  state = transition(transition(state, "submit", { guided: true }), "solved", { guided: true });
  assert.equal(state, "CORRECTNESS_VERIFIED");
  assert.equal(transition(state, "confirm", { guided: true }), "MASTERY_CONFIRMED");
  assert.throws(() => transition("INDEPENDENT_ATTEMPT", "solved", { guided: false }), TransitionError);
  assert.throws(() => transition("MASTERY_CONFIRMED", "hint", { guided: false }), TransitionError);
  assert.throws(() => transition("INDEPENDENT_ATTEMPT", "offer", { guided: false }), TransitionError);
});

test("credit falls with each hint level, failed submission, skipped optimization, reveal and pasted solution", () => {
  assert.equal(creditCap({ hintLevel: 0, revealed: false, failedSubmissions: 0 }), 1);
  assert.deepEqual([1, 2, 3, 4].map((hintLevel) => creditCap({ hintLevel, revealed: false, failedSubmissions: 0 })), [0.8, 0.65, 0.5, 0.35]);
  assert.equal(creditCap({ hintLevel: 0, revealed: false, failedSubmissions: 2 }), 0.8);
  assert.equal(creditCap({ hintLevel: 0, revealed: false, failedSubmissions: 9 }), 0.6);
  assert.equal(creditCap({ hintLevel: 1, revealed: false, failedSubmissions: 1 }), 0.72);
  assert.equal(creditCap({ hintLevel: 0, revealed: false, failedSubmissions: 0, skippedOptimization: true }), 0.7);
  assert.equal(creditCap({ hintLevel: 0, revealed: true, failedSubmissions: 0 }), 0);
  assert.equal(creditCap({ hintLevel: 0, revealed: false, failedSubmissions: 0, pastedShare: 0.9 }), 0.7);
  assert.equal(independentSolve({ correct: true, hintLevel: 0, revealed: false, failedSubmissions: 0 }), true);
  assert.equal(independentSolve({ correct: true, hintLevel: 1, revealed: false, failedSubmissions: 0 }), false);
  assert.equal(independentSolve({ correct: true, hintLevel: 0, revealed: false, failedSubmissions: 0, pastedShare: 0.8 }), false);
});

test("a clean solve advances; assisted work transfers, then reinforces at most twice, then waits for review", () => {
  assert.equal(attemptOutcome({ credit: 1, role: "primary", depth: 0 }), "advance");
  assert.equal(attemptOutcome({ credit: 0.8, role: "primary", depth: 0 }), "advance");
  // One hint plus a failed submission is below the bar: the same concept again, on a changed problem.
  assert.equal(attemptOutcome({ credit: creditCap({ hintLevel: 1, revealed: false, failedSubmissions: 1 }), role: "primary", depth: 0 }), "transfer");
  assert.equal(attemptOutcome({ credit: 0.5, role: "transfer", depth: 0 }), "reinforce");
  assert.equal(attemptOutcome({ credit: 0.5, role: "reinforcement", depth: 1 }), "reinforce");
  assert.equal(attemptOutcome({ credit: 0.5, role: "reinforcement", depth: 2 }), "review_later");
  assert.equal(attemptOutcome({ credit: 0.9, role: "reinforcement", depth: 2 }), "advance");
  assert.equal(nextDifficulty("easy", { credit: 1, outcome: "advance" }), "medium");
  assert.equal(nextDifficulty("hard", { credit: 1, outcome: "advance" }), "hard");
  assert.equal(nextDifficulty("medium", { credit: 0.5, outcome: "reinforce" }), "easy");
  assert.equal(nextDifficulty("medium", { credit: 0.6, outcome: "transfer" }), "medium");
  assert.equal(startingDifficulty("easy", { score: 0.9, independentSolves: 2 }), "medium");
  assert.equal(startingDifficulty("easy", { score: 0.9, independentSolves: 0 }), "easy");
});

test("stalls come from repeated failures and stuck time, never from typing", () => {
  let tracker = recordActivity(emptyTracker(), { activeMs: 60_000, edits: 500 }, 1_000_000);
  assert.equal(stallReason(tracker, 0), null);
  tracker = fail(fail(tracker, "a"), "b");
  assert.equal(stallReason(tracker, 0), null);
  // Re-running the same code is not a new attempt.
  tracker = fail(tracker, "b");
  assert.equal(tracker.sameFailureStreak, 2);
  tracker = fail(tracker, "c");
  assert.equal(stallReason(tracker, 0), "same_failure");
  let compile = emptyTracker();
  for (const hash of ["x", "y", "z"]) compile = fail(compile, hash, "", "compile_error");
  assert.equal(stallReason(compile, 0), "compile_errors");
  // Lots of focused time with a failure and no progress.
  let stuck = fail(emptyTracker(), "a", "case1:IndexError");
  stuck = recordActivity({ ...stuck, lastReportAt: 0 }, { activeMs: 120_000, edits: 3 }, 9 * 60_000);
  for (let minute = 10; minute < 17; minute += 1) stuck = recordActivity(stuck, { activeMs: 60_000, edits: 3 }, minute * 60_000);
  assert.equal(stallReason(stuck, 0), "no_progress");
  // A new passing case is progress and resets the clock.
  const progressed = recordExecution(stuck, { codeHash: "q", verdict: "ran", passed: 2, total: 3, failure: "case3:wrong" });
  assert.equal(stallReason(progressed, 0), null);
});

test("focused time can't be claimed faster than the clock", () => {
  let tracker = recordActivity(emptyTracker(), { activeMs: 30_000, edits: 1 }, 100_000);
  tracker = recordActivity(tracker, { activeMs: 120_000, edits: 1 }, 110_000);
  assert.equal(tracker.activeMs, 30_000 + 15_000);
});

test("offers wait for a stall, then cool down, and stop after repeated declines", () => {
  let tracker = emptyTracker();
  for (const hash of ["a", "b", "c"]) tracker = fail(tracker, hash);
  const input = { failedSubmissions: 0, phaseLevel: 0, state: "INDEPENDENT_ATTEMPT" as const };
  assert.equal(shouldOffer(emptyTracker(), input), false);
  assert.equal(shouldOffer(tracker, input), true);
  tracker = recordDecline(recordOffer(tracker));
  assert.equal(shouldOffer(fail(tracker, "d"), input), false, "cooldown");
  tracker = fail({ ...tracker, activeMs: tracker.activeMs + 5 * 60_000 }, "d");
  assert.equal(shouldOffer(tracker, input), true);
  tracker = recordDecline(recordDecline(tracker));
  tracker = fail({ ...tracker, activeMs: tracker.activeMs + 5 * 60_000 }, "e");
  assert.equal(shouldOffer(tracker, input), false, "declined three times");
  assert.equal(shouldOffer(tracker, { ...input, state: "HINT_OFFERED" }), false);
});

test("each hint needs a new attempt or a few minutes' work since the last one", () => {
  let tracker = emptyTracker();
  assert.equal(hintAvailability(tracker, 0)?.available, false);
  tracker = fail(tracker, "a");
  assert.deepEqual(hintAvailability(tracker, 0), { level: 1, available: true, wait: null });
  tracker = recordHint(tracker, "correct");
  assert.equal(tracker.levels.correct, 1);
  const waiting = hintAvailability(tracker, 1);
  assert.equal(waiting?.available, false);
  assert.match(waiting?.wait ?? "", /last hint/);
  // Re-running unchanged code doesn't unlock the next level; new code does, and so does time.
  assert.equal(hintAvailability(fail(tracker, "a"), 1)?.available, false);
  assert.equal(hintAvailability(fail(tracker, "b"), 1)?.available, true);
  assert.equal(hintAvailability({ ...tracker, activeMs: tracker.activeMs + 3 * 60_000 }, 1)?.available, true);
  assert.equal(hintAvailability(tracker, 4), null);
});

test("concept mastery rises with independent solves and asks for review when shaky", () => {
  const now = new Date("2026-11-15T00:00:00Z");
  const first = updateMastery(null, { credit: 1, independent: true, outcome: "advance", solved: true }, now);
  assert.equal(first.score, 1);
  assert.equal(masteryStatus(first), "mastered");
  assert.equal(first.nextReviewAt?.toISOString(), "2026-11-21T00:00:00.000Z");
  const assisted = updateMastery(null, { credit: 0.5, independent: false, outcome: "transfer", solved: true }, now);
  assert.equal(masteryStatus(assisted), "practising");
  const slipping = updateMastery(assisted, { credit: 0, independent: false, outcome: "review_later", solved: false }, now);
  assert.equal(masteryStatus(slipping), "review");
  assert.equal(slipping.attempts, 2);
  assert.equal(masteryStatus(null), "new");
});

test("the live tutor speaks up on its own, at the right moments, one thing at a time", () => {
  const now = 10_000_000;
  const fresh = emptyTracker();
  // It greets the learner once as the problem opens.
  assert.equal(coachMoment(fresh, { kind: "open" }, "PROBLEM_INTRO", now), "kickoff");
  const greeted = coachSpoke(recordCoach(fresh, "kickoff", { kind: "open" }, now), now);
  assert.equal(coachMoment(greeted, { kind: "open" }, "PROBLEM_INTRO", now + 1_000), null);
  // While it is writing, it waits; a check-in lost for a minute frees it again.
  const thinking = recordCoach(greeted, "idle", { kind: "activity", idleMs: 150_000, visible: true }, now);
  assert.equal(coachMoment(thinking, { kind: "submit", outcome: "solved" }, "INDEPENDENT_ATTEMPT", now + 5_000), null);
  assert.equal(coachMoment(thinking, { kind: "submit", outcome: "solved" }, "INDEPENDENT_ATTEMPT", now + COACH_RULES.pendingMs + 1), "solved");
  // A run that fails a new way is always answered; the same failure again only after the cooldown.
  const working = { ...greeted, coachAt: now };
  assert.equal(coachMoment(working, { kind: "run", passedAll: false, firstAllPass: false, newFailure: true }, "INDEPENDENT_ATTEMPT", now + 5_000), "ran");
  assert.equal(coachMoment(working, { kind: "run", passedAll: false, firstAllPass: false, newFailure: false }, "INDEPENDENT_ATTEMPT", now + 5_000), null);
  assert.equal(coachMoment(working, { kind: "run", passedAll: false, firstAllPass: false, newFailure: false }, "INDEPENDENT_ATTEMPT", now + COACH_RULES.cooldownMs), "ran");
  // A quiet stretch in front of the page gets one check-in; the same stretch never a second, and a hidden page none.
  const quiet = { kind: "activity" as const, idleMs: 130_000, visible: true };
  assert.equal(coachMoment(working, quiet, "INDEPENDENT_ATTEMPT", now + 100_000), "idle");
  assert.equal(coachMoment(working, { ...quiet, visible: false }, "INDEPENDENT_ATTEMPT", now + 100_000), null);
  assert.equal(coachMoment(working, { ...quiet, idleMs: 30_000 }, "INDEPENDENT_ATTEMPT", now + 100_000), null);
  const checked = coachSpoke(recordCoach(working, "idle", quiet, now + 100_000), now + 100_000);
  assert.equal(coachMoment(checked, { ...quiet, idleMs: 130_000 + 200_000 }, "INDEPENDENT_ATTEMPT", now + 300_000), null, "still the same quiet stretch");
  // A question still unanswered gets a few minutes' thought before a quiet stretch counts.
  const asked = coachSpoke(recordCoach(working, "ran", { kind: "run", passedAll: false, firstAllPass: false, newFailure: true }, now), now, true);
  assert.equal(coachMoment(asked, quiet, "INDEPENDENT_ATTEMPT", now + 150_000), null);
  assert.equal(coachMoment(asked, quiet, "INDEPENDENT_ATTEMPT", now + COACH_RULES.questionMs + 1_000), "idle");
  // Lots of code, minutes of work and no run: a nudge to check it.
  const writing = { ...working, edits: 80, activeMs: 7 * 60_000 };
  assert.equal(coachMoment(writing, { kind: "activity", idleMs: 2_000, visible: true }, "INDEPENDENT_ATTEMPT", now + 100_000), "unrun");
  const nudged = coachSpoke(recordCoach(writing, "unrun", { kind: "activity", idleMs: 2_000, visible: true }, now + 100_000), now + 100_000);
  assert.equal(coachMoment(nudged, { kind: "activity", idleMs: 2_000, visible: true }, "INDEPENDENT_ATTEMPT", now + 300_000), null);
  // A hint offer on screen speaks for the tutor, and a finished attempt only gets its debrief.
  assert.equal(coachMoment(working, { kind: "submit", outcome: "failed" }, "HINT_OFFERED", now + 5_000), null);
  assert.equal(coachMoment(working, { kind: "submit", outcome: "failed" }, "GUIDED_ATTEMPT", now + 5_000), "submitted");
  assert.equal(coachMoment(working, quiet, "MASTERY_CONFIRMED", now + 100_000), null);
  // Answers to its questions are bounded too.
  assert.equal(coachMoment({ ...working, replies: COACH_RULES.maxReplies }, { kind: "reply" }, "GUIDED_ATTEMPT", now + 5_000), null);
});

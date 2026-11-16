import type { AttemptOutcome, AttemptRole, CoachMoment, Difficulty, TutorState, Verdict } from "@learnspace/shared/coding";

/**
 * The tutoring policy: every decision about progression, help and credit. It is plain functions over stored numbers, so
 * the language model never decides whether a learner passed, may see a hint, or moves on; it only words what this allows.
 */

// ---------------------------------------------------------------------------------------------------------------------
// The state machine.

export type TutorEvent =
  | "begin"            // the learner starts working (first edit, run or submit)
  | "stall"            // the stall detector fired
  | "offer"            // the tutor offered a hint
  | "hint"             // a hint was shown (asked for, or an offer accepted)
  | "decline"          // the learner declined an offer
  | "submit"           // a submission went to the grader
  | "failed"           // it failed
  | "correct_slow"     // correct, but the efficiency stage remains
  | "solved"           // correct (and efficient, where that is a stage)
  | "skip_optimization"
  | "reveal"           // the learner gave up and looked at the solution
  | "transfer"         // the attempt ended and a transfer or reinforcement problem follows
  | "confirm";         // the attempt ended with the concept confirmed

const WORKING: TutorState[] = ["PROBLEM_INTRO", "INDEPENDENT_ATTEMPT", "PROBABLE_STALL", "HINT_OFFERED", "GUIDED_ATTEMPT", "OPTIMIZATION_STAGE"];
const ENDED: TutorState[] = ["TRANSFER_PROBLEM", "MASTERY_CONFIRMED"];

export class TransitionError extends Error {}

/** The next state; `guided` says the learner has taken help, which decides where a failure or a declined offer returns to. */
export function transition(state: TutorState, event: TutorEvent, context: { guided: boolean; optimizing?: boolean }): TutorState {
  const working = context.optimizing ? "OPTIMIZATION_STAGE" : context.guided ? "GUIDED_ATTEMPT" : "INDEPENDENT_ATTEMPT";
  const from = (allowed: TutorState[], to: TutorState) => {
    if (!allowed.includes(state)) throw new TransitionError(`${event} is not allowed in ${state}`);
    return to;
  };
  switch (event) {
    case "begin":
      return state === "PROBLEM_INTRO" ? "INDEPENDENT_ATTEMPT" : from(WORKING, state);
    case "stall":
      return from(["INDEPENDENT_ATTEMPT", "GUIDED_ATTEMPT", "OPTIMIZATION_STAGE", "PROBABLE_STALL"], "PROBABLE_STALL");
    case "offer":
      return from(["PROBABLE_STALL"], "HINT_OFFERED");
    case "hint":
      return from(WORKING, context.optimizing ? "OPTIMIZATION_STAGE" : "GUIDED_ATTEMPT");
    case "decline":
      return from(["HINT_OFFERED", "PROBABLE_STALL"], working);
    case "submit":
      return from(WORKING, "SOLUTION_SUBMITTED");
    case "failed":
      return from(["SOLUTION_SUBMITTED"], working);
    case "correct_slow":
      return from(["SOLUTION_SUBMITTED"], "OPTIMIZATION_STAGE");
    case "solved":
      return from(["SOLUTION_SUBMITTED"], "CORRECTNESS_VERIFIED");
    case "skip_optimization":
      return from(["OPTIMIZATION_STAGE"], "CORRECTNESS_VERIFIED");
    case "reveal":
      return from([...WORKING, "SOLUTION_SUBMITTED"], "CORRECTNESS_VERIFIED");
    case "transfer":
      return from(["CORRECTNESS_VERIFIED"], "TRANSFER_PROBLEM");
    case "confirm":
      return from(["CORRECTNESS_VERIFIED"], "MASTERY_CONFIRMED");
  }
}

export const isEnded = (state: TutorState) => ENDED.includes(state);
export const isWorking = (state: TutorState) => WORKING.includes(state);

// ---------------------------------------------------------------------------------------------------------------------
// Credit and what follows an attempt.

/** The most an attempt can earn after the deepest hint taken: none, then levels 1 to 4. A reveal earns nothing. */
export const HINT_CAPS = [1, 0.8, 0.65, 0.5, 0.35] as const;
export const ADVANCE_CREDIT = 0.75;
export const MAX_REINFORCEMENTS = 2;
const FAIL_PENALTY = 0.1;
const MAX_FAIL_PENALTY = 0.4;
const SKIPPED_OPTIMIZATION = 0.7;
/** A solution mostly pasted in is not shown to be the learner's own: it counts as assisted. */
const PASTED_SHARE = 0.6;
const PASTED_CAP = 0.7;

export type CreditInput = { hintLevel: number; revealed: boolean; failedSubmissions: number; skippedOptimization?: boolean; pastedShare?: number };

export function creditCap(input: CreditInput): number {
  if (input.revealed) return 0;
  const hints = HINT_CAPS[Math.min(4, Math.max(0, input.hintLevel))]!;
  const failures = 1 - Math.min(MAX_FAIL_PENALTY, FAIL_PENALTY * input.failedSubmissions);
  let cap = hints * failures * (input.skippedOptimization ? SKIPPED_OPTIMIZATION : 1);
  if ((input.pastedShare ?? 0) >= PASTED_SHARE) cap = Math.min(cap, PASTED_CAP);
  return Math.round(cap * 10_000) / 10_000;
}

/** Whether a solve shows independent mastery: correct, unaided, first submission or close to it, and typed by the learner. */
export function independentSolve(input: CreditInput & { correct: boolean }): boolean {
  return input.correct && !input.revealed && input.hintLevel === 0 && input.failedSubmissions <= 1 && (input.pastedShare ?? 0) < PASTED_SHARE;
}

/**
 * What a finished attempt leads to. Enough credit moves on to the lesson's next concept. Otherwise the concept is practised
 * again on a different problem of the same kind: a transfer after the primary problem, then at most two reinforcements,
 * after which the concept is left for review rather than looping forever.
 */
export function attemptOutcome(input: { credit: number; role: AttemptRole; depth: number }): AttemptOutcome {
  if (input.credit >= ADVANCE_CREDIT) return "advance";
  if (input.role === "primary") return "transfer";
  return input.depth < MAX_REINFORCEMENTS ? "reinforce" : "review_later";
}

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

/** The next problem's difficulty: up after a clean, confident solve, down when practising again, otherwise the same. */
export function nextDifficulty(current: Difficulty, input: { credit: number; outcome: AttemptOutcome }): Difficulty {
  const index = DIFFICULTY_ORDER.indexOf(current);
  if (input.outcome === "advance" && input.credit >= 0.9) return DIFFICULTY_ORDER[Math.min(2, index + 1)]!;
  if (input.outcome === "reinforce") return DIFFICULTY_ORDER[Math.max(0, index - 1)]!;
  return current;
}

/** Where a learner starts on a concept: the lesson's level, one up if they have already shown mastery of it. */
export function startingDifficulty(lesson: Difficulty, mastery: { score: number; independentSolves: number } | null): Difficulty {
  if (mastery && mastery.score >= 0.8 && mastery.independentSolves >= 1) return DIFFICULTY_ORDER[Math.min(2, DIFFICULTY_ORDER.indexOf(lesson) + 1)]!;
  return lesson;
}

// ---------------------------------------------------------------------------------------------------------------------
// Concept mastery across videos.

export type MasteryRecord = { score: number; independentSolves: number; assistedSolves: number; attempts: number; needsReview: boolean; nextReviewAt: Date | null };

const DAY = 86_400_000;

export function updateMastery(previous: MasteryRecord | null, attempt: { credit: number; independent: boolean; outcome: AttemptOutcome; solved: boolean }, now = new Date()): MasteryRecord {
  const prior = previous ?? { score: 0, independentSolves: 0, assistedSolves: 0, attempts: 0, needsReview: false, nextReviewAt: null };
  // Recent work weighs more; a first attempt starts from what it showed.
  const score = previous ? 0.6 * prior.score + 0.4 * attempt.credit : attempt.credit;
  const independentSolves = prior.independentSolves + (attempt.independent ? 1 : 0);
  const assistedSolves = prior.assistedSolves + (attempt.solved && !attempt.independent ? 1 : 0);
  const needsReview = attempt.outcome === "review_later" || score < 0.5;
  // Spaced review: soon when shaky, further out with each independent solve.
  const days = needsReview ? 1 : attempt.independent ? Math.min(30, 3 * (independentSolves + 1)) : 2;
  return { score: Math.round(score * 10_000) / 10_000, independentSolves, assistedSolves, attempts: prior.attempts + 1, needsReview, nextReviewAt: new Date(now.getTime() + days * DAY) };
}

export function masteryStatus(record: MasteryRecord | null): "new" | "practising" | "mastered" | "review" {
  if (!record || record.attempts === 0) return "new";
  if (record.needsReview) return "review";
  return record.score >= 0.8 && record.independentSolves >= 1 ? "mastered" : "practising";
}

// ---------------------------------------------------------------------------------------------------------------------
// Struggle and help. Typing is not struggle: the detector reads executions and focused working time only.

export type Tracker = {
  /** Focused working time in the attempt, as credited (never more than the wall clock allows). */
  activeMs: number;
  edits: number;
  lastReportAt: number | null;
  /** Consecutive runs or submissions failing the same way. */
  failureSignature: string | null;
  sameFailureStreak: number;
  compileErrorStreak: number;
  /** Runs and submissions with code the learner had not already tried. */
  attempts: number;
  failures: number;
  lastCodeHash: string | null;
  /** Active time at the last real progress (a new case passing, or the first correct submission). */
  progressAtMs: number;
  bestPassed: number;
  /** Help so far: the level reached in each phase, and when the last hint and offer happened. */
  levels: { correct: number; efficient: number };
  hintAtMs: number | null;
  attemptsAtHint: number;
  offerAtMs: number | null;
  attemptsAtOffer: number;
  offersDeclined: number;
  pasted: number;
  /** The live tutor: how often it has spoken, when (wall clock), and whether a check-in is being written now. */
  coachCount: number;
  coachAt: number | null;
  coachPendingAt: number | null;
  /** When the idle stretch the tutor last checked in on began, so one quiet stretch gets one check-in. */
  coachIdleFrom: number | null;
  /** Working time and edits at the last run (or the tutor's last nudge to run). */
  runAtActiveMs: number;
  editsAtRun: number;
  replies: number;
  /** The tutor's last words were a question the learner hasn't answered yet. */
  coachAsked: boolean;
};

export const emptyTracker = (): Tracker => ({
  activeMs: 0, edits: 0, lastReportAt: null, failureSignature: null, sameFailureStreak: 0, compileErrorStreak: 0, attempts: 0, failures: 0,
  lastCodeHash: null, progressAtMs: 0, bestPassed: 0, levels: { correct: 0, efficient: 0 }, hintAtMs: null, attemptsAtHint: 0, offerAtMs: null,
  attemptsAtOffer: 0, offersDeclined: 0, pasted: 0, coachCount: 0, coachAt: null, coachPendingAt: null, coachIdleFrom: null, runAtActiveMs: 0, editsAtRun: 0, replies: 0, coachAsked: false,
});

/** Merges a stored tracker with defaults, so trackers written before a field existed still work. */
export const readTracker = (stored: unknown): Tracker => ({ ...emptyTracker(), ...(stored && typeof stored === "object" ? stored as Partial<Tracker> : {}) });

const REPORT_SLACK_MS = 5_000;

/** Credits focused time from the browser, never more than the wall clock since its last report allows. */
export function recordActivity(tracker: Tracker, report: { activeMs: number; edits: number; pasted?: number }, now: number): Tracker {
  const allowed = tracker.lastReportAt === null ? report.activeMs : Math.max(0, now - tracker.lastReportAt + REPORT_SLACK_MS);
  return { ...tracker, activeMs: tracker.activeMs + Math.min(report.activeMs, allowed), edits: tracker.edits + report.edits, pasted: tracker.pasted + (report.pasted ?? 0), lastReportAt: now };
}

export type ExecutionSummary = {
  codeHash: string;
  /** "ran" for a run, else the submission's verdict. */
  verdict: Verdict | "ran" | "time_limit" | "memory_limit" | "output_limit" | "runtime_error" | "compile_error";
  passed: number;
  total: number;
  /** Which case failed first and how (an error type, or "wrong"), for telling repeated failures from new ones. */
  failure: string | null;
};

export function recordExecution(tracker: Tracker, execution: ExecutionSummary): Tracker {
  const fresh = execution.codeHash !== tracker.lastCodeHash;
  const failed = execution.failure !== null || execution.verdict === "compile_error";
  const signature = failed ? `${execution.verdict}:${execution.failure ?? ""}` : null;
  const next: Tracker = { ...tracker, lastCodeHash: execution.codeHash, attempts: tracker.attempts + (fresh ? 1 : 0), runAtActiveMs: tracker.activeMs, editsAtRun: tracker.edits };
  if (!fresh) return next;
  next.failures = tracker.failures + (failed ? 1 : 0);
  next.compileErrorStreak = execution.verdict === "compile_error" ? tracker.compileErrorStreak + 1 : 0;
  next.sameFailureStreak = signature !== null && signature === tracker.failureSignature ? tracker.sameFailureStreak + 1 : signature ? 1 : 0;
  next.failureSignature = signature;
  if (execution.passed > tracker.bestPassed || (!failed && execution.verdict !== "ran")) {
    next.bestPassed = Math.max(tracker.bestPassed, execution.passed);
    next.progressAtMs = tracker.activeMs;
  }
  return next;
}

export const STALL_RULES = { sameFailure: 3, failedSubmissions: 2, compileErrors: 3, stuckMs: 8 * 60_000 } as const;

/** Why the learner looks stuck, or null. Each signal needs real attempts; time alone, or typing, never counts. */
export function stallReason(tracker: Tracker, failedSubmissions: number): string | null {
  if (tracker.compileErrorStreak >= STALL_RULES.compileErrors) return "compile_errors";
  if (tracker.sameFailureStreak >= STALL_RULES.sameFailure) return "same_failure";
  if (failedSubmissions >= STALL_RULES.failedSubmissions && tracker.attempts > tracker.attemptsAtOffer) return "failed_submissions";
  if (tracker.failures > 0 && tracker.activeMs - tracker.progressAtMs >= STALL_RULES.stuckMs) return "no_progress";
  return null;
}

export const OFFER_COOLDOWN_MS = 4 * 60_000;
export const HINT_UNLOCK_MS = 3 * 60_000;
const MAX_DECLINES = 3;

/** Whether to offer a hint now: stuck, help left to give, and not pestering (a cooldown, new attempts, few declines). */
export function shouldOffer(tracker: Tracker, input: { failedSubmissions: number; phaseLevel: number; state: TutorState }): boolean {
  if (!["INDEPENDENT_ATTEMPT", "GUIDED_ATTEMPT", "OPTIMIZATION_STAGE", "PROBABLE_STALL"].includes(input.state)) return false;
  if (input.phaseLevel >= 4 || tracker.offersDeclined >= MAX_DECLINES) return false;
  if (!stallReason(tracker, input.failedSubmissions)) return false;
  if (tracker.offerAtMs !== null && (tracker.activeMs - tracker.offerAtMs < OFFER_COOLDOWN_MS || tracker.attempts <= tracker.attemptsAtOffer)) return false;
  // Just after a hint, give it time to work.
  if (tracker.hintAtMs !== null && tracker.activeMs - tracker.hintAtMs < HINT_UNLOCK_MS && tracker.attempts <= tracker.attemptsAtHint + 1) return false;
  return true;
}

/**
 * Whether the next hint can be taken. The first needs a real attempt or a few minutes' work; each one after it needs a new
 * attempt (different code) or a few more minutes since the last, so the ladder cannot be climbed by clicking.
 */
export function hintAvailability(tracker: Tracker, phaseLevel: number): { level: number; available: boolean; wait: string | null } | null {
  if (phaseLevel >= 4) return null;
  const level = phaseLevel + 1;
  const sinceMs = tracker.hintAtMs === null ? tracker.activeMs : tracker.activeMs - tracker.hintAtMs;
  const newAttempt = tracker.attempts > (tracker.hintAtMs === null ? 0 : tracker.attemptsAtHint);
  if (newAttempt || sinceMs >= HINT_UNLOCK_MS) return { level, available: true, wait: null };
  const minutes = Math.max(1, Math.ceil((HINT_UNLOCK_MS - sinceMs) / 60_000));
  return { level, available: false, wait: tracker.hintAtMs === null ? `Try running your code first, or keep at it for ${minutes} more min.` : `Try the last hint in your code first, or keep at it for ${minutes} more min.` };
}

export function recordHint(tracker: Tracker, phase: "correct" | "efficient"): Tracker {
  return { ...tracker, levels: { ...tracker.levels, [phase]: tracker.levels[phase] + 1 }, hintAtMs: tracker.activeMs, attemptsAtHint: tracker.attempts };
}

export function recordOffer(tracker: Tracker): Tracker {
  return { ...tracker, offerAtMs: tracker.activeMs, attemptsAtOffer: tracker.attempts };
}

export function recordDecline(tracker: Tracker): Tracker {
  return { ...tracker, offersDeclined: tracker.offersDeclined + 1 };
}

/** The share of the accepted code that arrived by pasting, as far as the editor saw. */
export function pastedShare(tracker: Tracker, code: string): number {
  return code.length === 0 ? 0 : Math.min(1, tracker.pasted / code.length);
}

// ---------------------------------------------------------------------------------------------------------------------
// The live tutor. It sits beside the learner and speaks up on its own, the way a teacher looking over a shoulder would:
// as they start, when a run or submission tells it something new, when they go quiet, when they have written a lot
// without checking it, and when they finish. These rules decide when it speaks; the model only words what it says, and
// never with more help than the hints the learner has unlocked.

export type CoachTrigger =
  | { kind: "open" }
  | { kind: "run"; passedAll: boolean; firstAllPass: boolean; newFailure: boolean }
  | { kind: "submit"; outcome: "solved" | "slow" | "failed" }
  | { kind: "activity"; idleMs: number | null; visible: boolean }
  | { kind: "reply" };

export const COACH_RULES = {
  /** Between check-ins it starts itself; a result the learner just got, or their reply, is always answered. */
  cooldownMs: 90_000,
  /** Watching the page without typing or running this long is a quiet stretch worth a check-in. */
  idleMs: 120_000,
  /** A question of the tutor's still unanswered is left this long before a quiet stretch counts: they may be thinking it over. */
  questionMs: 5 * 60_000,
  /** Writing this long, and this much, without running it is worth a nudge to check. */
  unrunMs: 6 * 60_000,
  unrunEdits: 40,
  /** A check-in still unwritten after this was lost; another may start. */
  pendingMs: 60_000,
  maxPerAttempt: 30,
  maxReplies: 12,
} as const;

export const coachThinking = (tracker: Tracker, now: number) => tracker.coachPendingAt !== null && now - tracker.coachPendingAt < COACH_RULES.pendingMs;

/** Whether the tutor speaks now, and about what; null to stay quiet. */
export function coachMoment(tracker: Tracker, trigger: CoachTrigger, state: TutorState, now: number): CoachMoment | null {
  if (coachThinking(tracker, now)) return null;
  if (trigger.kind === "reply") return tracker.replies < COACH_RULES.maxReplies ? "reply" : null;
  if (trigger.kind === "submit" && trigger.outcome !== "failed") return trigger.outcome;
  if (tracker.coachCount >= COACH_RULES.maxPerAttempt || !isWorking(state)) return null;
  // A hint offer on screen is the tutor speaking already.
  if (state === "HINT_OFFERED") return null;
  if (trigger.kind === "open") return tracker.coachCount === 0 ? "kickoff" : null;
  if (trigger.kind === "submit") return "submitted";
  const rested = tracker.coachAt === null || now - tracker.coachAt >= COACH_RULES.cooldownMs;
  if (trigger.kind === "run") return trigger.newFailure || trigger.firstAllPass || (rested && !trigger.passedAll) ? "ran" : null;
  if (!rested || !trigger.visible) return null;
  const pondering = tracker.coachAsked && tracker.coachAt !== null && now - tracker.coachAt < COACH_RULES.questionMs;
  if (trigger.idleMs !== null && trigger.idleMs >= COACH_RULES.idleMs && !pondering) {
    const from = now - trigger.idleMs;
    return tracker.coachIdleFrom !== null && Math.abs(from - tracker.coachIdleFrom) < 30_000 ? null : "idle";
  }
  if (tracker.edits - tracker.editsAtRun >= COACH_RULES.unrunEdits && tracker.activeMs - tracker.runAtActiveMs >= COACH_RULES.unrunMs) return "unrun";
  return null;
}

/** Notes that the tutor is about to speak, so it says one thing at a time and isn't asked the same thing twice. */
export function recordCoach(tracker: Tracker, moment: CoachMoment, trigger: CoachTrigger, now: number): Tracker {
  const next: Tracker = { ...tracker, coachPendingAt: now, coachAsked: false };
  if (moment === "reply") return { ...next, replies: tracker.replies + 1 };
  next.coachCount = tracker.coachCount + 1;
  next.coachAt = now;
  if (moment === "idle" && trigger.kind === "activity" && trigger.idleMs !== null) next.coachIdleFrom = now - trigger.idleMs;
  if (moment === "unrun") { next.runAtActiveMs = tracker.activeMs; next.editsAtRun = tracker.edits; }
  return next;
}

/** The check-in landed (or was dropped): the tutor is free again, and waits on its question if it asked one. */
export const coachSpoke = (tracker: Tracker, now: number, asked = false): Tracker => ({ ...tracker, coachPendingAt: null, coachAt: tracker.coachAt ?? now, coachAsked: asked });

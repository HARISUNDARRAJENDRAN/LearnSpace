import { createHash } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, codingAttempts, codingEvents, codingMastery, codingProblems, codingSubmissions, paperCodingProfiles } from "@learnspace/db/schema";
import type { RunResult, SubmitResult } from "@learnspace/runner/api";
import {type AttemptOutcome, type AttemptRole,
  CODING_CONCEPT_SLUGS, CODING_CONCEPTS, CODING_LANGUAGES,
  type CoachMessageView, type CoachMoment, type CodingActivityRequest, type CodingAttemptView,
  type CodingConcept, type CodingEligibilityView, type CodingLanguage, type CodingProblemView, type CodingStateView, type ConceptMasteryView, type Difficulty, type HintView, type RunResultView,type SubmissionView, type TutorState,
} from "@learnspace/shared/coding";
import { parseCaseText, starterCode } from "@learnspace/shared/coding-code";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { TutorModel } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { studyContext, videoContext } from "../tutor/service";
import { paperProfileView, planPaperVersion } from "../research/practice";
import { authorProblem, findProblem, type ProblemSpec, type ProblemTutor, type Slot, slotPending } from "./author";
import {
  attemptOutcome, COACH_RULES, type CoachTrigger, coachMoment, coachSpoke, coachThinking,
  codingEligible,creditCap, emptyTracker, hintAvailability, independentSolve, masteryStatus, nextDifficulty, pastedShare, readTracker, recordActivity,
  recordCoach, recordDecline,recordExecution, recordHint, recordOffer, shouldOffer, stallReason, startingDifficulty, type Tracker, transition, updateMastery,
} from "./policy";
import { classifyVersion, loadProfile, profileView, type StoredConcept } from "./profile";
import { problemSolution, runProblem, submitProblem } from "./runner";
import { RUN_GOALS } from "./runs";
import { type CoachTurn, type TutorContext, writeCoach, writeHint } from "./tutor";

type AttemptRow = typeof codingAttempts.$inferSelect;
type ProblemRow = typeof codingProblems.$inferSelect;
type Tracked = Tracker & { skippedOptimization?: boolean; lastResults?: string | null };
export type Options = { keepAlive?: (work: Promise<unknown>) => void; model?: TutorModel };

const PREPARING_WINDOW_MS = 9 * 60_000;
const REVEAL_AFTER_MS = 5 * 60_000;

const hash = (language: string, code: string) => createHash("sha256").update(`${language}\n${code}`).digest("hex").slice(0, 32);
const keep = (options: Options, work: Promise<unknown>) => {
  const guarded = work.catch((error: unknown) => console.error("[coding] background work failed", error instanceof Error ? error.message : error));
  if (options.keepAlive) options.keepAlive(guarded);
};

// ---------------------------------------------------------------------------------------------------------------------
// Views.

function problemView(row: ProblemRow): CodingProblemView {
  const spec = row.spec as ProblemSpec;
  const concept = row.concept as CodingConcept;
  return {
    id: row.id, title: row.title ?? "Problem", difficulty: row.difficulty as Difficulty, concept, conceptLabel: CODING_CONCEPTS[concept] ?? concept,
    statement: spec.statement, signature: spec.signature, compare: spec.compare, numericTolerance: spec.numericTolerance ?? null, constraints: spec.constraints,
    examples: spec.examples.map((example) => ({ args: example.args, expected: example.expected, explanation: example.explanation })),
    starter: Object.fromEntries(CODING_LANGUAGES.map((language) => [language, starterCode(spec.signature, language)])) as Record<CodingLanguage, string>,
    moments: spec.moments, paper: spec.paper ?? null, efficiencyStage: (row.verification as { efficiencyStage?: boolean } | null)?.efficiencyStage === true, related: spec.related,
  };
}

const phaseLevel = (tracker: Tracker, phase: string) => tracker.levels[phase === "efficient" ? "efficient" : "correct"];
const nextLevelCap = (row: AttemptRow, tracker: Tracker) => {
  const phase = row.phase === "efficient" ? "efficient" : "correct";
  const levels = { ...tracker.levels, [phase]: tracker.levels[phase] + 1 };
  return creditCap({ hintLevel: Math.max(levels.correct, levels.efficient), revealed: false, failedSubmissions: row.failedSubmissions });
};

async function attemptView(tx: Transaction, row: AttemptRow, problem: ProblemRow): Promise<CodingAttemptView> {
  const tracker = readTracker(row.tracker) as Tracked;
  const [events, submissions] = await Promise.all([
    tx.select().from(codingEvents).where(eq(codingEvents.attemptId, row.id)).orderBy(asc(codingEvents.createdAt)),
    tx.select().from(codingSubmissions).where(eq(codingSubmissions.attemptId, row.id)).orderBy(desc(codingSubmissions.createdAt)).limit(20),
  ]);
  const spec = problem.spec as ProblemSpec;
  const hints: HintView[] = events.filter((event) => event.kind === "hint").map((event) => ({
    level: event.level ?? 1, stage: (event.data as { stage?: "correct" | "efficient" }).stage ?? "correct", text: event.text ?? "", requested: (event.data as { requested?: boolean }).requested !== false, createdAt: event.createdAt.toISOString(),
  }));
  const messages: CoachMessageView[] = events.filter((event) => event.kind === "learner" || event.kind === "tutor").map((event) => {
    const data = (event.data ?? {}) as { moment?: CoachMoment; asks?: boolean };
    return { role: event.kind as "learner" | "tutor", text: event.text ?? "", moment: data.moment ?? null, asks: data.asks === true, createdAt: event.createdAt.toISOString() };
  });
  const thinking = coachThinking(tracker, Date.now());
  const last = messages.at(-1);
  const coach = { messages, thinking, canReply: !thinking && last?.role === "tutor" && last.asks && tracker.replies < COACH_RULES.maxReplies };
  const lastOffer = [...events].reverse().find((event) => event.kind === "offer");
  const solution = [...events].reverse().find((event) => event.kind === "reveal")?.data as CodingAttemptView["solution"] | undefined;
  const completed = row.completedAt !== null;
  const available = completed ? null : hintAvailability(tracker, phaseLevel(tracker, row.phase));
  return {
    id: row.id, problem: problemView(problem), role: row.role as AttemptRole, state: row.state as TutorState, phase: row.phase as "correct" | "efficient",
    language: row.language as CodingLanguage, drafts: row.drafts as CodingAttemptView["drafts"], correctSolved: row.correctSolved, efficientSolved: row.efficientSolved, hints, coach,
    nextHint: available ? { ...available, capAfter: nextLevelCap(row, tracker) } : null,
    offer: row.state === "HINT_OFFERED" && lastOffer ? { text: lastOffer.text ?? "" } : null,
    submissions: submissions.map((submission): SubmissionView => {
      const result = submission.result as { failure?: SubmitResult["failure"]; compileOutput?: string | null };
      const failure = result.failure ?? null;
      const example = failure?.exampleIndex === null || failure?.exampleIndex === undefined ? null : spec.examples[failure.exampleIndex] ?? null;
      return {
        id: submission.id, language: submission.language as CodingLanguage, verdict: submission.verdict as SubmissionView["verdict"], passed: submission.passed, total: submission.total,
        runtimeMs: submission.runtimeMs, memoryKb: submission.memoryKb, compileOutput: result.compileOutput ?? null, createdAt: submission.createdAt.toISOString(),
        failure: failure ? { example: example ? { args: example.args, expected: example.expected, explanation: example.explanation } : null, output: failure.output, error: failure.error } : null,
      };
    }),
    failedSubmissions: row.failedSubmissions, revealed: row.revealed,
    creditCap: creditCap({ hintLevel: row.hintLevel, revealed: row.revealed, failedSubmissions: row.failedSubmissions, skippedOptimization: tracker.skippedOptimization === true }),
    credit: row.credit === null ? null : Number(row.credit), outcome: row.outcome as AttemptOutcome | null, solution: completed ? solution ?? null : null,
    focus: { interruptions: Number((row.focus as { interruptions?: number }).interruptions ?? 0), awayMs: Number((row.focus as { awayMs?: number }).awayMs ?? 0) },
    startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function latestAttempt(tx: Transaction, userId: string, resourceId: string): Promise<AttemptRow | null> {
  const [open] = await tx.select().from(codingAttempts).where(and(eq(codingAttempts.userId, userId), eq(codingAttempts.resourceId, resourceId), isNull(codingAttempts.completedAt))).limit(1);
  if (open) return open;
  const [last] = await tx.select().from(codingAttempts).where(and(eq(codingAttempts.userId, userId), eq(codingAttempts.resourceId, resourceId))).orderBy(desc(codingAttempts.startedAt)).limit(1);
  return last ?? null;
}

/** The lesson's concepts the learner has finished here (moved on from, or left for review). */
async function finishedConcepts(tx: Transaction, userId: string, resourceId: string): Promise<Set<string>> {
  const rows = await tx.select({ concept: codingProblems.concept }).from(codingAttempts).innerJoin(codingProblems, eq(codingProblems.id, codingAttempts.problemId))
    .where(and(eq(codingAttempts.userId, userId), eq(codingAttempts.resourceId, resourceId), inArray(codingAttempts.outcome, ["advance", "review_later"])));
  return new Set(rows.map((row) => row.concept));
}

type Plan = { slot: Slot; role: AttemptRole; depth: number; parentAttemptId: string | null; kind: NonNullable<CodingStateView["next"]>["kind"] };

/** What Next opens after a finished attempt: decided by the policy from its outcome, never by the tutor. */
async function planNext(tx: Transaction, userId: string, attempt: AttemptRow, concepts: StoredConcept[], lessonDifficulty: Difficulty): Promise<Plan> {
  const [problem] = await tx.select({ concept: codingProblems.concept, difficulty: codingProblems.difficulty }).from(codingProblems).where(eq(codingProblems.id, attempt.problemId)).limit(1);
  const concept = problem!.concept as CodingConcept;
  const difficulty = problem!.difficulty as Difficulty;
  const outcome = attempt.outcome as AttemptOutcome;
  const credit = Number(attempt.credit ?? 0);
  if (outcome === "transfer" || outcome === "reinforce") {
    return {
      slot: { resourceId: attempt.resourceId, concept, difficulty: nextDifficulty(difficulty, { credit, outcome }), parentProblemId: attempt.problemId },
      role: outcome === "transfer" ? "transfer" : "reinforcement", depth: outcome === "reinforce" ? attempt.depth + 1 : 0, parentAttemptId: attempt.id, kind: outcome === "transfer" ? "transfer" : "reinforcement",
    };
  }
  const finished = await finishedConcepts(tx, userId, attempt.resourceId);
  const upcoming = concepts.find((item) => !finished.has(item.concept));
  if (upcoming) return { slot: { resourceId: attempt.resourceId, concept: upcoming.concept, difficulty: startingDifficulty(lessonDifficulty, await masteryOf(tx, userId, upcoming.concept)), parentProblemId: null }, role: "primary", depth: 0, parentAttemptId: null, kind: "concept" };
  // Every concept is done: more of the same lesson, on the concept the learner is weakest at, a level up from where it stood.
  const weakest = (await Promise.all(concepts.map(async (item) => ({ item, mastery: await masteryOf(tx, userId, item.concept) })))).sort((a, b) => (a.mastery?.score ?? 0) - (b.mastery?.score ?? 0))[0];
  const target = weakest?.item.concept ?? concept;
  return { slot: { resourceId: attempt.resourceId, concept: target, difficulty: nextDifficulty(target === concept ? difficulty : lessonDifficulty, { credit: 1, outcome: "advance" }), parentProblemId: null }, role: "primary", depth: 0, parentAttemptId: null, kind: "more" };
}

async function masteryOf(tx: Transaction, userId: string, concept: string) {
  const [row] = await tx.select().from(codingMastery).where(and(eq(codingMastery.userId, userId), eq(codingMastery.concept, concept))).limit(1);
  return row ?? null;
}

async function preparingView(tx: Transaction, userId: string, sessionId: string, since: Date | null): Promise<CodingStateView["preparing"]> {
  const [run] = await tx.select({ status: agentRuns.status, startedAt: agentRuns.startedAt, failureCode: agentRuns.failureCode }).from(agentRuns)
    .where(and(eq(agentRuns.userId, userId), eq(agentRuns.studySessionId, sessionId), eq(agentRuns.goal, RUN_GOALS.author))).orderBy(desc(agentRuns.startedAt)).limit(1);
  const startedAt = run?.startedAt ?? new Date(0);
  if (!run || (since && startedAt < since)) return { status: "idle", message: null };
  if (run.status === "executing" && startedAt.getTime() > Date.now() - PREPARING_WINDOW_MS) return { status: "preparing", message: "Writing a problem for this lesson and checking it against its tests..." };
  if (run.status === "failed") return { status: "failed", message: run.failureCode?.startsWith("provider") || run.failureCode === "budget_exhausted" ? "The tutor is unavailable right now." : "A problem couldn't be prepared this time." };
  return { status: "idle", message: null };
}

async function stateOf(tx: Transaction, userId: string, sessionId: string, options: Options = {}): Promise<CodingStateView> {
  const context = await studyContext(tx, userId, sessionId);
  if (context.resourceType === "paper") {
    const [paperRow] = context.versionId ? await tx.select().from(paperCodingProfiles).where(eq(paperCodingProfiles.resourceVersionId, context.versionId)).limit(1) : [];
    const profile = paperProfileView(paperRow ?? null);
    if (context.versionId && (!paperRow || paperRow.status === "planning" || paperRow.status === "failed")) keep(options, planPaperVersion(userId, sessionId));
    const attempt = await latestAttempt(tx, userId, context.resourceId);
    const [problem] = attempt ? await tx.select().from(codingProblems).where(eq(codingProblems.id, attempt.problemId)).limit(1) : [];
    return {
      profile, attempt: attempt && problem ? await attemptView(tx, attempt, problem) : null,
      preparing: { status: profile.status === "classifying" ? "preparing" : "idle", message: profile.status === "classifying" ? "Checking whether this paper has a useful CPU exercise..." : null },
      mastery: [], next: null,
    };
  }
  const video = await videoContext(tx, userId, sessionId);
  const profileRow = video.versionId ? await loadProfile(tx, video.versionId) : null;
  const profile = profileView(profileRow, video.transcript);
  if (video.versionId && (profile.status === "classifying" || profile.status === "failed")) {
    const versionId = video.versionId;
    keep(options, classifyVersion(userId, { resourceId: video.resourceId, versionId, title: video.title }));
  }
  const attempt = await latestAttempt(tx, userId, video.resourceId);
  const [problem] = attempt ? await tx.select().from(codingProblems).where(eq(codingProblems.id, attempt.problemId)).limit(1) : [];
  const concepts = (profileRow?.concepts ?? []) as StoredConcept[];
  const masteryRows = concepts.length ? await tx.select().from(codingMastery).where(and(eq(codingMastery.userId, userId), inArray(codingMastery.concept, concepts.map((item) => item.concept)))) : [];
  const mastery: ConceptMasteryView[] = concepts.map((item) => {
    const row = masteryRows.find((candidate) => candidate.concept === item.concept);
    const record = row ? { score: row.score, independentSolves: row.independentSolves, assistedSolves: row.assistedSolves, attempts: row.attempts, needsReview: row.needsReview, nextReviewAt: row.nextReviewAt } : null;
    return { concept: item.concept, label: CODING_CONCEPTS[item.concept], score: row?.score ?? 0, independentSolves: row?.independentSolves ?? 0, assistedSolves: row?.assistedSolves ?? 0, status: masteryStatus(record) };
  });
  let next: CodingStateView["next"] = null;
  if (attempt?.completedAt && attempt.outcome) {
    const plan = await planNext(tx, userId, attempt, concepts, (profileRow?.difficulty ?? "easy") as Difficulty);
    next = { kind: plan.kind, concept: plan.slot.concept, label: plan.kind === "transfer" ? `A changed ${CODING_CONCEPTS[plan.slot.concept]} problem` : plan.kind === "reinforcement" ? `Another ${CODING_CONCEPTS[plan.slot.concept]} problem, a step easier` : plan.kind === "more" ? `More ${CODING_CONCEPTS[plan.slot.concept]} practice` : `Next: ${CODING_CONCEPTS[plan.slot.concept]}` };
  }
  return {
    profile, attempt: attempt && problem ? await attemptView(tx, attempt, problem) : null,
    preparing: attempt && !attempt.completedAt ? { status: "idle", message: null } : await preparingView(tx, userId, sessionId, attempt?.completedAt ?? null),
    mastery, next,
  };
}

function requireEligibleVideo(profile: Awaited<ReturnType<typeof loadProfile>>): void {
  if (!codingEligible("video", profile ? { category: profile.category, practiceFit: profile.practiceFit === null ? null : Number(profile.practiceFit), concepts: profile.concepts as unknown[] } : null)) {
    throw new AuthError("CODING_NOT_ELIGIBLE", "Coding exercises aren't available for this lesson.", 403);
  }
}

/** The sidebar's resource capability without loading attempts or prefetching a problem. */
export async function getCodingEligibility(userId: string, sessionId: string, options: Options = {}): Promise<CodingEligibilityView> {
  return withUserTransaction(userId, async (tx) => {
    const context = await studyContext(tx, userId, sessionId);
    if (context.resourceType === "paper") {
      const [row] = context.versionId ? await tx.select().from(paperCodingProfiles).where(eq(paperCodingProfiles.resourceVersionId, context.versionId)).limit(1) : [];
      const profile = paperProfileView(row ?? null);
      if (context.versionId && (profile.status === "classifying" || profile.status === "failed")) keep(options, planPaperVersion(userId, sessionId));
      return { status: profile.status === "classifying" ? "pending" : profile.eligible ? "eligible" : "ineligible", eligible: profile.eligible, concepts: profile.concepts };
    }
    const video = await videoContext(tx, userId, sessionId);
    const row = video.versionId ? await loadProfile(tx, video.versionId) : null;
    const profile = profileView(row, video.transcript);
    if (video.versionId && (profile.status === "classifying" || profile.status === "failed")) {
      keep(options, classifyVersion(userId, { resourceId: video.resourceId, versionId: video.versionId, title: video.title }));
    }
    return { status: profile.status === "classifying" || profile.status === "waiting_transcript" ? "pending" : profile.eligible ? "eligible" : "ineligible", eligible: profile.eligible };
  });
}

/** The session's coding state for its active video; classifies the lesson in the background the first time it's needed. */
export async function getCodingState(userId: string, sessionId: string, options: Options = {}): Promise<CodingStateView> {
  let state = await withUserTransaction(userId, (tx) => stateOf(tx, userId, sessionId, options));
  if (!state.profile.eligible) {
    if (state.profile.status === "classifying" || state.profile.status === "waiting_transcript") {
      state = { ...state, attempt: null, preparing: { status: "preparing", message: "Checking whether this lesson calls for coding practice..." }, mastery: [], next: null };
    } else {
      throw new AuthError("CODING_NOT_ELIGIBLE", "Coding exercises aren't available for this lesson.", 403);
    }
  }
  // A recommended lesson's first problem is written ahead, so the Code button opens onto it.
  if (state.profile.status === "ready" && state.profile.eligible && !state.attempt && state.preparing.status === "idle" && state.profile.concepts[0]) {
    keep(options, prefetch(userId, sessionId, state.profile.concepts[0].concept, options));
  }
  // A problem just opened, with nothing said yet: the tutor greets the learner.
  const attempt = state.attempt;
  if (attempt && !attempt.completedAt && !attempt.coach.messages.length && !attempt.coach.thinking) return (await coachOpen(userId, sessionId, options)) ?? state;
  return state;
}

async function prefetch(userId: string, sessionId: string, concept: CodingConcept, options: Options) {
  const slot = await withUserTransaction(userId, async (tx) => {
    // A paper's exercises come from its planner, not from writing ahead.
    if ((await studyContext(tx, userId, sessionId)).resourceType === "paper") return null;
    const video = await videoContext(tx, userId, sessionId);
    const profile = video.versionId ? await loadProfile(tx, video.versionId) : null;
    requireEligibleVideo(profile);
    const target: Slot = { resourceId: video.resourceId, concept, difficulty: startingDifficulty((profile?.difficulty ?? "easy") as Difficulty, await masteryOf(tx, userId, concept)), parentProblemId: null };
    return (await findProblem(tx, userId, target)) || (await slotPending(tx, target)) ? null : target;
  });
  if (slot) await authorProblem(userId, sessionId, slot, { prefetch: true, ...(options.model ? { model: options.model } : {}) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening problems.

async function openAttempt(tx: Transaction, userId: string, sessionId: string, plan: Omit<Plan, "kind">, language: CodingLanguage): Promise<"opened" | "missing"> {
  const problemId = await findProblem(tx, userId, plan.slot);
  if (!problemId) return "missing";
  const tracker = emptyTracker();
  await tx.insert(codingAttempts).values({
    userId, studySessionId: sessionId, resourceId: plan.slot.resourceId, problemId, role: plan.role, parentAttemptId: plan.parentAttemptId, depth: plan.depth,
    state: "PROBLEM_INTRO", language, tracker,
  }).onConflictDoNothing();
  return "opened";
}

/**
 * Starts (or resumes) coding practice on the active video. With a problem ready it opens at once; otherwise one is written
 * and verified in the background, and the learner polls this until it is ready.
 */
export async function startCoding(userId: string, sessionId: string, input: { concept?: CodingConcept | undefined; retry?: boolean | undefined }, options: Options = {}): Promise<CodingStateView> {
  const paper = await withUserTransaction(userId, async (tx) => (await studyContext(tx, userId, sessionId)).resourceType === "paper");
  if (paper) return startPaperCoding(userId, sessionId, input, options);
  const author = await withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`coding.start:${userId}:${sessionId}`}, 0))`);
    const video = await videoContext(tx, userId, sessionId);
    const profile = video.versionId ? await loadProfile(tx, video.versionId) : null;
    requireEligibleVideo(profile);
    const current = await latestAttempt(tx, userId, video.resourceId);
    if (current && !current.completedAt) return null;
    const concepts = (profile?.concepts ?? []) as StoredConcept[];
    let plan: Omit<Plan, "kind">;
    if (current?.completedAt && !input.concept) {
      plan = await planNext(tx, userId, current, concepts, (profile?.difficulty ?? "easy") as Difficulty);
    } else {
      const finished = await finishedConcepts(tx, userId, video.resourceId);
      const concept = input.concept ?? concepts.find((item) => !finished.has(item.concept))?.concept ?? concepts[0]?.concept;
      if (!concept) throw new AuthError("CODING_CONCEPT_REQUIRED", "Pick what you'd like to practise.", 409);
      if (!CODING_CONCEPT_SLUGS.includes(concept)) throw new AuthError("CODING_CONCEPT_REQUIRED", "Pick what you'd like to practise.", 409);
      plan = { slot: { resourceId: video.resourceId, concept, difficulty: startingDifficulty((profile?.difficulty ?? "easy") as Difficulty, await masteryOf(tx, userId, concept)), parentProblemId: null }, role: "primary", depth: 0, parentAttemptId: null };
    }
    const language = (CODING_LANGUAGES as readonly string[]).includes(profile?.language ?? "") ? profile!.language as CodingLanguage : current ? current.language as CodingLanguage : "python";
    if ((await openAttempt(tx, userId, sessionId, plan, language)) === "opened") return null;
    if (await slotPending(tx, plan.slot)) return null;
    // A failure stands until the learner asks again, so a broken slot isn't retried on every poll.
    const preparing = await preparingView(tx, userId, sessionId, current?.completedAt ?? null);
    if (preparing.status === "failed" && !input.retry) return null;
    return plan.slot;
  });
  if (author) keep(options, authorProblem(userId, sessionId, author, options.model ? { model: options.model } : {}));
  const state = await getCodingState(userId, sessionId, options);
  // The writer has started but may not have recorded its run yet: say so rather than flash "idle".
  const open = state.attempt !== null && state.attempt.completedAt === null;
  return author && !open && state.preparing.status !== "preparing" ? { ...state, preparing: { status: "preparing", message: "Writing a problem for this lesson and checking it against its tests..." } } : state;
}

async function startPaperCoding(userId: string, sessionId: string, input: { concept?: CodingConcept | undefined }, options: Options): Promise<CodingStateView> {
  await withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`coding.start:${userId}:${sessionId}`}, 0))`);
    const paper = await studyContext(tx, userId, sessionId);
    if (paper.resourceType !== "paper" || !paper.versionId) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That session has no ready paper.", 404);
    const [profile] = await tx.select().from(paperCodingProfiles).where(eq(paperCodingProfiles.resourceVersionId, paper.versionId)).limit(1);
    const view = paperProfileView(profile ?? null);
    if (!view.eligible) throw new AuthError(view.status === "classifying" ? "CODING_PREPARING" : "CODING_NOT_ELIGIBLE", view.status === "classifying" ? "Paper exercises are still being prepared." : "Coding exercises aren't available for this paper.", view.status === "classifying" ? 409 : 403);
    const current = await latestAttempt(tx, userId, paper.resourceId);
    if (current && !current.completedAt) return;
    const used = await finishedConcepts(tx, userId, paper.resourceId);
    const component = view.concepts.find((item) => (!input.concept || item.concept === input.concept) && !used.has(item.concept))
      ?? view.concepts.find((item) => !input.concept || item.concept === input.concept);
    if (!component) throw new AuthError("CODING_CONCEPT_REQUIRED", "Pick a paper component to practise.", 409);
    const [problem] = await tx.select({ difficulty: codingProblems.difficulty }).from(codingProblems).where(and(eq(codingProblems.resourceId, paper.resourceId), eq(codingProblems.concept, component.concept), eq(codingProblems.status, "verified"))).orderBy(asc(codingProblems.verifiedAt)).limit(1);
    if (!problem) throw new AuthError("CODING_PREPARING", "This paper exercise is still being prepared.", 409);
    await openAttempt(tx, userId, sessionId, { slot: { resourceId: paper.resourceId, concept: component.concept, difficulty: problem.difficulty as Difficulty, parentProblemId: null }, role: "primary", depth: 0, parentAttemptId: null }, "python");
  });
  const state = await getCodingState(userId, sessionId, options);
  const attempt = state.attempt;
  if (attempt && !attempt.completedAt && !attempt.coach.messages.length && !attempt.coach.thinking) return (await coachOpen(userId, sessionId, options)) ?? state;
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------
// Working an attempt.

async function lockAttempt(tx: Transaction, userId: string, sessionId: string, attemptId: string, open = true): Promise<{ row: AttemptRow; problem: ProblemRow; tracker: Tracked }> {
  const [row] = await tx.select().from(codingAttempts).where(and(eq(codingAttempts.id, attemptId), eq(codingAttempts.userId, userId), eq(codingAttempts.studySessionId, sessionId))).for("update").limit(1);
  if (!row) throw new AuthError("CODING_ATTEMPT_NOT_FOUND", "That problem isn't part of this session.", 404);
  if (open && row.completedAt) throw new AuthError("CODING_ATTEMPT_CLOSED", "This problem is finished.", 409);
  const context = await studyContext(tx, userId, sessionId);
  if (context.resourceType === "paper") {
    const [paperProfile] = context.versionId ? await tx.select().from(paperCodingProfiles).where(eq(paperCodingProfiles.resourceVersionId, context.versionId)).limit(1) : [];
    if (context.resourceId !== row.resourceId || !paperProfileView(paperProfile ?? null).eligible) throw new AuthError("CODING_NOT_ELIGIBLE", "Coding exercises aren't available for this paper.", 403);
  } else {
    const video = await videoContext(tx, userId, sessionId);
    const profile = video.versionId ? await loadProfile(tx, video.versionId) : null;
    requireEligibleVideo(profile);
    if (video.resourceId !== row.resourceId) throw new AuthError("CODING_NOT_ELIGIBLE", "Coding exercises aren't available for this lesson.", 403);
  }
  const [problem] = await tx.select().from(codingProblems).where(eq(codingProblems.id, row.problemId)).limit(1);
  return { row, problem: problem!, tracker: readTracker(row.tracker) as Tracked };
}

const guided = (tracker: Tracker) => tracker.levels.correct + tracker.levels.efficient > 0;
const optimizing = (row: AttemptRow) => row.phase === "efficient";
const step = (row: AttemptRow, tracker: Tracker, event: Parameters<typeof transition>[1]) => transition(row.state as TutorState, event, { guided: guided(tracker), optimizing: optimizing(row) });

/** Starts working (the first edit or run), and offers a hint if the learner now looks stuck. */
async function settleWork(tx: Transaction, row: AttemptRow, tracker: Tracked): Promise<{ state: TutorState; tracker: Tracked }> {
  let state = row.state as TutorState;
  if (state === "PROBLEM_INTRO") state = "INDEPENDENT_ATTEMPT";
  if (shouldOffer(tracker, { failedSubmissions: row.failedSubmissions, phaseLevel: phaseLevel(tracker, row.phase), state })) {
    const reason = stallReason(tracker, row.failedSubmissions);
    state = transition(transition(state, "stall", { guided: guided(tracker) }), "offer", { guided: guided(tracker) });
    const cap = Math.round(nextLevelCap(row, tracker) * 100);
    const text = reason === "compile_errors" ? `The compiler keeps stopping you. Want a hint? It lowers the most this problem can earn to ${cap}%.`
      : reason === "failed_submissions" ? `A couple of submissions haven't passed. Want a hint? It lowers the most this problem can earn to ${cap}%.`
      : reason === "same_failure" ? `This has failed the same way a few times. Want a hint? It lowers the most this problem can earn to ${cap}%.`
      : `You've been at this a while. Want a hint? It lowers the most this problem can earn to ${cap}%.`;
    await tx.insert(codingEvents).values({ attemptId: row.id, userId: row.userId, kind: "offer", text, data: { reason } });
    tracker = recordOffer(tracker) as Tracked;
  }
  return { state, tracker };
}

// ---------------------------------------------------------------------------------------------------------------------
// The live tutor. A request that could warrant a check-in asks the policy inside its own transaction (so the state it
// returns already shows the tutor thinking), and the words are written after the response and land on the next poll.

type CoachJob = { userId: string; sessionId: string; attemptId: string; moment: CoachMoment; context: TutorContext; level: number; history: CoachTurn[] };

function tutorContext(row: AttemptRow, problem: ProblemRow, tracker: Tracked, code?: { language: CodingLanguage; code: string }): TutorContext {
  const language = code?.language ?? (row.language as CodingLanguage);
  return {
    title: problem.title ?? "", spec: problem.spec as ProblemSpec, tutor: problem.tutor as ProblemTutor, phase: row.phase === "efficient" ? "efficient" : "correct", language,
    code: code?.code ?? (row.drafts as Record<string, string>)[language] ?? "", results: tracker.lastResults ?? null,
  };
}

/** Decides whether the tutor speaks now; if so, marks it thinking on the returned tracker and gives the job to run after. */
async function planCoach(tx: Transaction, row: AttemptRow, problem: ProblemRow, tracker: Tracked, state: TutorState, trigger: CoachTrigger, code?: { language: CodingLanguage; code: string }): Promise<{ tracker: Tracked; job: CoachJob | null }> {
  const now = Date.now();
  const moment = coachMoment(tracker, trigger, state, now);
  if (!moment) return { tracker, job: null };
  const turns = await tx.select({ kind: codingEvents.kind, text: codingEvents.text }).from(codingEvents)
    .where(and(eq(codingEvents.attemptId, row.id), inArray(codingEvents.kind, ["learner", "tutor"]))).orderBy(desc(codingEvents.createdAt)).limit(10);
  // Once the attempt is over the solution is on screen anyway, so the debrief may discuss it fully.
  const level = row.completedAt || moment === "solved" ? 4 : phaseLevel(tracker, row.phase);
  return {
    tracker: recordCoach(tracker, moment, trigger, now) as Tracked,
    job: { userId: row.userId, sessionId: row.studySessionId, attemptId: row.id, moment, context: tutorContext(row, problem, tracker, code), level, history: turns.reverse().map((turn) => ({ role: turn.kind as "learner" | "tutor", text: turn.text ?? "" })) },
  };
}

/** Writes the check-in and puts it in the attempt's feed; nothing is said when there is nothing safe to say. */
async function speak(job: CoachJob, options: Options): Promise<void> {
  const text = await writeCoach(job.userId, job.sessionId, job.context, job.level, job.moment, job.history, options.model).catch(() => null);
  await withUserTransaction(job.userId, async (tx) => {
    const [row] = await tx.select().from(codingAttempts).where(eq(codingAttempts.id, job.attemptId)).for("update").limit(1);
    if (!row) return;
    const asks = text !== null && /\?\s*$/.test(text);
    if (text) await tx.insert(codingEvents).values({ attemptId: row.id, userId: job.userId, kind: "tutor", text, data: { moment: job.moment, asks, level: job.level } });
    await tx.update(codingAttempts).set({ tracker: coachSpoke(readTracker(row.tracker), Date.now(), asks) }).where(eq(codingAttempts.id, row.id));
  });
}

const speakLater = (job: CoachJob | null, options: Options) => { if (job) keep(options, speak(job, options)); };

/** Checks in as the problem opens: the tutor greets the learner and gets them thinking before they type. */
async function coachOpen(userId: string, sessionId: string, options: Options): Promise<CodingStateView | null> {
  const planned = await withUserTransaction(userId, async (tx) => {
    const context = await studyContext(tx, userId, sessionId);
    const open = await latestAttempt(tx, userId, context.resourceId);
    if (!open || open.completedAt) return null;
    const { row, problem, tracker } = await lockAttempt(tx, userId, sessionId, open.id);
    const { tracker: next, job } = await planCoach(tx, row, problem, tracker, row.state as TutorState, { kind: "open" });
    if (!job) return null;
    await tx.update(codingAttempts).set({ tracker: next }).where(eq(codingAttempts.id, row.id));
    return { job, state: await stateOf(tx, userId, sessionId) };
  });
  if (!planned) return null;
  speakLater(planned.job, options);
  return planned.state;
}

/** The learner's answer to the tutor's question; the tutor replies to it on the next poll. */
export async function replyToCoach(userId: string, sessionId: string, input: { attemptId: string; language: CodingLanguage; code: string; message: string }, options: Options = {}): Promise<CodingStateView> {
  const { state, job } = await withUserTransaction(userId, async (tx) => {
    const { row, problem, tracker } = await lockAttempt(tx, userId, sessionId, input.attemptId, false);
    const view = await attemptView(tx, row, problem);
    if (!view.coach.canReply) throw new AuthError("CODING_NO_QUESTION", "The tutor isn't waiting on an answer right now.", 409);
    await tx.insert(codingEvents).values({ attemptId: row.id, userId, kind: "learner", text: input.message });
    const planned = await planCoach(tx, row, problem, tracker, row.state as TutorState, { kind: "reply" }, { language: input.language, code: input.code });
    await tx.update(codingAttempts).set({ tracker: planned.tracker, updatedAt: new Date() }).where(eq(codingAttempts.id, row.id));
    return { state: await stateOf(tx, userId, sessionId), job: planned.job };
  });
  speakLater(job, options);
  return state;
}

export async function saveDraft(userId: string, sessionId: string, input: { attemptId: string; language: CodingLanguage; code: string }): Promise<void> {
  await withUserTransaction(userId, async (tx) => {
    const { row } = await lockAttempt(tx, userId, sessionId, input.attemptId);
    await tx.update(codingAttempts).set({ language: input.language, drafts: { ...(row.drafts as Record<string, string>), [input.language]: input.code }, updatedAt: new Date() }).where(eq(codingAttempts.id, row.id));
  });
}

export async function recordCodingActivity(userId: string, sessionId: string, input: CodingActivityRequest, options: Options = {}): Promise<CodingStateView> {
  let job: CoachJob | null = null;
  const state = await withUserTransaction(userId, async (tx) => {
    const { row, problem, tracker: before } = await lockAttempt(tx, userId, sessionId, input.attemptId);
    let tracker = recordActivity(before, { activeMs: input.activeMs, edits: input.edits, pasted: input.pasted ?? 0 }, Date.now()) as Tracked;
    const settled = input.edits > 0 || row.state !== "PROBLEM_INTRO" ? await settleWork(tx, row, tracker) : { state: row.state as TutorState, tracker };
    tracker = settled.tracker;
    // Each report is the tutor looking over: a quiet stretch, or a lot written without a run, gets a check-in.
    ({ tracker, job } = await planCoach(tx, row, problem, tracker, settled.state, { kind: "activity", idleMs: input.idleMs ?? null, visible: input.visible === true }));
    const focus = row.focus as { interruptions?: number; awayMs?: number };
    const away = input.away ?? [];
    await tx.update(codingAttempts).set({
      tracker, state: settled.state, updatedAt: new Date(),
      focus: { interruptions: (focus.interruptions ?? 0) + away.length, awayMs: (focus.awayMs ?? 0) + away.reduce((sum, item) => sum + item.ms, 0) },
    }).where(eq(codingAttempts.id, row.id));
    if (away.length) await tx.insert(codingEvents).values({ attemptId: row.id, userId, kind: "focus", data: { away } });
    return stateOf(tx, userId, sessionId);
  });
  speakLater(job, options);
  return state;
}

const errorKind = (error: string | null) => (error ? error.split(/[:\s]/)[0] ?? "error" : "wrong");

function runResultView(result: RunResult, parseErrors: Array<{ index: number; reason: string }>): RunResultView {
  return {
    verdict: result.verdict, compileOutput: result.compileOutput,
    cases: result.cases.map((item) => ({ index: item.index, args: item.args, output: item.output, expected: item.expected, passed: item.passed, stdout: item.stdout, error: item.error, ms: item.ms })),
    invalid: [...parseErrors, ...result.invalid].sort((a, b) => a.index - b.index),
  };
}

/** Run: the examples and the learner's own inputs, graded against the reference. Counts as an attempt for the policy. */
export async function runCoding(userId: string, sessionId: string, input: { attemptId: string; language: CodingLanguage; code: string; custom: string[] }, options: Options = {}): Promise<{ run: RunResultView & { custom: boolean[] }; state: CodingStateView }> {
  const problem = await withUserTransaction(userId, async (tx) => (await lockAttempt(tx, userId, sessionId, input.attemptId)).problem);
  const signature = (problem.spec as ProblemSpec).signature;
  const parseErrors: Array<{ index: number; reason: string }> = [];
  const custom: unknown[][] = [];
  const customIndex: number[] = [];
  input.custom.forEach((text, index) => {
    const parsed = parseCaseText(signature, text);
    if ("error" in parsed) parseErrors.push({ index, reason: parsed.error });
    else { custom.push(parsed.args); customIndex.push(index); }
  });
  const result = await runProblem(problem.id, { language: input.language, code: input.code, custom });
  // The runner numbers the custom cases it was sent; they are renumbered to the learner's own.
  for (const item of result.cases) if (item.kind === "custom") item.index = customIndex[item.index] ?? item.index;
  for (const item of result.invalid) item.index = customIndex[item.index] ?? item.index;
  const view = runResultView(result, parseErrors);
  const examples = result.cases.filter((item) => item.kind === "example");
  const failed = examples.find((item) => item.passed !== true);
  let job: CoachJob | null = null;
  const state = await withUserTransaction(userId, async (tx) => {
    const { row, problem: current, tracker: before } = await lockAttempt(tx, userId, sessionId, input.attemptId);
    let tracker = recordExecution(before, {
      codeHash: hash(input.language, input.code), verdict: result.verdict, passed: examples.filter((item) => item.passed === true).length, total: examples.length,
      failure: result.verdict === "compile_error" ? null : failed ? `example${failed.index}:${errorKind(failed.error)}` : result.verdict === "ran" ? null : result.verdict,
    }) as Tracked;
    tracker.lastResults = result.verdict === "compile_error" ? `Run: compile error:\n${(result.compileOutput ?? "").slice(0, 800)}`
      : `Run on the examples: ${examples.filter((item) => item.passed).length}/${examples.length} passed.${failed ? ` Example ${failed.index + 1} ${failed.error ? `raised ${failed.error}` : `returned ${JSON.stringify(failed.output)}, expected ${JSON.stringify(failed.expected)}`}.` : ""}`;
    const settled = await settleWork(tx, row, tracker);
    tracker = settled.tracker;
    const passedAll = result.verdict === "ran" && examples.length > 0 && examples.every((item) => item.passed === true);
    ({ tracker, job } = await planCoach(tx, row, current, tracker, settled.state, {
      kind: "run", passedAll, firstAllPass: passedAll && before.bestPassed < examples.length,
      newFailure: tracker.failureSignature !== null && tracker.failureSignature !== before.failureSignature,
    }, { language: input.language, code: input.code }));
    await tx.update(codingAttempts).set({
      tracker, state: settled.state, runCount: row.runCount + 1, language: input.language, drafts: { ...(row.drafts as Record<string, string>), [input.language]: input.code }, updatedAt: new Date(),
    }).where(eq(codingAttempts.id, row.id));
    return stateOf(tx, userId, sessionId);
  });
  speakLater(job, options);
  return { run: { ...view, custom: view.cases.map((item, position) => position >= examples.length) }, state };
}

/** Submit: graded by the runner on hidden tests. The grade alone moves the attempt on; nothing the tutor says does. */
export async function submitCoding(userId: string, sessionId: string, input: { attemptId: string; language: CodingLanguage; code: string }, options: Options = {}): Promise<CodingStateView> {
  const { problem } = await withUserTransaction(userId, async (tx) => lockAttempt(tx, userId, sessionId, input.attemptId));
  const grade = await submitProblem(problem.id, { language: input.language, code: input.code });
  const efficiencyStage = (problem.verification as { efficiencyStage?: boolean } | null)?.efficiencyStage === true;
  let completed: { concept: string } | null = null;
  let job: CoachJob | null = null;
  const state = await withUserTransaction(userId, async (tx) => {
    const { row, problem: current, tracker: before } = await lockAttempt(tx, userId, sessionId, input.attemptId);
    await tx.insert(codingSubmissions).values({
      attemptId: row.id, userId, language: input.language, code: input.code, verdict: grade.verdict, passed: grade.passed, total: grade.total, runtimeMs: grade.runtimeMs, memoryKb: grade.memoryKb,
      result: { failure: grade.failure, compileOutput: grade.compileOutput },
    });
    let tracker = recordExecution(before, { codeHash: hash(input.language, input.code), verdict: grade.verdict, passed: grade.passed, total: grade.total, failure: grade.correct ? null : `${grade.failure?.exampleIndex ?? "hidden"}:${errorKind(grade.failure?.error ?? null)}` }) as Tracked;
    tracker.lastResults = `Submission: ${grade.verdict.replace(/_/g, " ")}, ${grade.passed}/${grade.total} tests passed.${grade.failure?.error ? ` Error: ${grade.failure.error}.` : ""}${grade.tutorNote ? ` The failing hidden test was written to catch: ${grade.tutorNote}.` : ""}${grade.compileOutput ? `\n${grade.compileOutput.slice(0, 800)}` : ""}`;
    const submitted = transition(row.state === "PROBLEM_INTRO" ? "INDEPENDENT_ATTEMPT" : row.state as TutorState, "submit", { guided: guided(tracker) });
    const solved = grade.correct && (grade.efficient || !efficiencyStage);
    const base = { submissionCount: row.submissionCount + 1, language: input.language, drafts: { ...(row.drafts as Record<string, string>), [input.language]: input.code }, updatedAt: new Date() };
    const code = { language: input.language, code: input.code };
    if (solved) {
      ({ tracker, job } = await planCoach(tx, row, current, tracker, submitted, { kind: "submit", outcome: "solved" }, code));
      await complete(tx, { ...row, ...base, correctSolved: true, efficientSolved: grade.efficient }, tracker, "CORRECTNESS_VERIFIED", input.code);
      completed = { concept: problem.concept };
    } else if (grade.correct) {
      // Correct but slow: on to the efficiency stage (or still in it).
      const state = row.phase === "efficient" ? transition(submitted, "failed", { guided: guided(tracker), optimizing: true }) : transition(submitted, "correct_slow", { guided: guided(tracker) });
      // Reaching the efficiency stage is worth a word; another slow submission inside it is a failure like any other.
      ({ tracker, job } = await planCoach(tx, row, current, tracker, state, row.phase === "efficient" ? { kind: "submit", outcome: "failed" } : { kind: "submit", outcome: "slow" }, code));
      await tx.update(codingAttempts).set({ ...base, tracker, state, phase: "efficient", correctSolved: true }).where(eq(codingAttempts.id, row.id));
      if (row.phase !== "efficient") await tx.insert(codingEvents).values({ attemptId: row.id, userId, kind: "transition", text: "Correct. Now make it fast enough for the largest inputs.", data: { to: "OPTIMIZATION_STAGE" } });
    } else {
      const failedRow = { ...row, failedSubmissions: row.failedSubmissions + 1 };
      const settled = await settleWork(tx, { ...failedRow, state: transition(submitted, "failed", { guided: guided(tracker), optimizing: optimizing(row) }) }, tracker);
      tracker = settled.tracker;
      ({ tracker, job } = await planCoach(tx, failedRow, current, tracker, settled.state, { kind: "submit", outcome: "failed" }, code));
      await tx.update(codingAttempts).set({ ...base, tracker, state: settled.state, failedSubmissions: failedRow.failedSubmissions }).where(eq(codingAttempts.id, row.id));
    }
    return stateOf(tx, userId, sessionId);
  });
  if (completed) keep(options, prefetchAfter(userId, sessionId, options));
  speakLater(job, options);
  return state;
}

/** Finishes an attempt: credit from the help taken, the outcome from the policy, the solution shown, mastery updated. */
async function complete(tx: Transaction, row: AttemptRow, tracker: Tracked, from: TutorState, code: string): Promise<void> {
  const share = pastedShare(tracker, code);
  const input = { hintLevel: row.hintLevel, revealed: row.revealed, failedSubmissions: row.failedSubmissions, skippedOptimization: tracker.skippedOptimization === true, pastedShare: share };
  const credit = creditCap(input);
  const outcome = attemptOutcome({ credit, role: row.role as AttemptRole, depth: row.depth });
  const state = transition(from, outcome === "advance" ? "confirm" : "transfer", { guided: guided(tracker) });
  const now = new Date();
  await tx.update(codingAttempts).set({
    tracker, state, credit: credit.toFixed(4), outcome, completedAt: now, updatedAt: now, revealed: row.revealed, correctSolved: row.correctSolved, efficientSolved: row.efficientSolved,
    submissionCount: row.submissionCount, language: row.language, drafts: row.drafts,
  }).where(eq(codingAttempts.id, row.id));
  const solution = await problemSolution(row.problemId).then((references) => ({ ...references.optimal, baseline: references.baseline }), () => null);
  if (solution) await tx.insert(codingEvents).values({ attemptId: row.id, userId: row.userId, kind: "reveal", data: { approach: solution.approach, time: solution.time, space: solution.space, code: solution.code } });
  const [problem] = await tx.select({ concept: codingProblems.concept }).from(codingProblems).where(eq(codingProblems.id, row.problemId)).limit(1);
  const previous = await masteryOf(tx, row.userId, problem!.concept);
  const updated = updateMastery(previous ? { ...previous } : null, { credit, independent: independentSolve({ ...input, correct: row.correctSolved }), outcome, solved: row.correctSolved }, now);
  await tx.insert(codingMastery).values({ userId: row.userId, concept: problem!.concept, ...updated, lastPracticedAt: now })
    .onConflictDoUpdate({ target: [codingMastery.userId, codingMastery.concept], set: { ...updated, lastPracticedAt: now } });
}

/** Once an attempt ends, the likely next problem is written ahead, so Next rarely waits. */
async function prefetchAfter(userId: string, sessionId: string, options: Options) {
  const slot = await withUserTransaction(userId, async (tx) => {
    const context = await studyContext(tx, userId, sessionId);
    if (context.resourceType === "paper") return null;
    const video = await videoContext(tx, userId, sessionId);
    const attempt = await latestAttempt(tx, userId, video.resourceId);
    if (!attempt?.completedAt) return null;
    const profile = video.versionId ? await loadProfile(tx, video.versionId) : null;
    requireEligibleVideo(profile);
    const plan = await planNext(tx, userId, attempt, (profile?.concepts ?? []) as StoredConcept[], (profile?.difficulty ?? "easy") as Difficulty);
    return (await findProblem(tx, userId, plan.slot)) || (await slotPending(tx, plan.slot)) ? null : plan.slot;
  });
  if (slot) await authorProblem(userId, sessionId, slot, { prefetch: true, ...(options.model ? { model: options.model } : {}) });
}

/** A hint at the next level, asked for or accepted from an offer; it lowers what the attempt can earn. */
export async function takeHint(userId: string, sessionId: string, input: { attemptId: string; language: CodingLanguage; code: string }, options: Options = {}): Promise<CodingStateView> {
  const prepared = await withUserTransaction(userId, async (tx) => {
    const { row, problem, tracker } = await lockAttempt(tx, userId, sessionId, input.attemptId);
    const level = phaseLevel(tracker, row.phase);
    const offered = row.state === "HINT_OFFERED";
    const availability = hintAvailability(tracker, level);
    if (!availability) throw new AuthError("CODING_NO_HINTS", "There are no more hints for this stage.", 409);
    if (!availability.available && !offered) throw new AuthError("CODING_HINT_LOCKED", availability.wait ?? "Keep working before the next hint.", 409);
    return { row, problem, tracker, level: availability.level, offered };
  });
  const phase = prepared.row.phase === "efficient" ? "efficient" : "correct";
  const text = await writeHint(userId, sessionId, {
    title: prepared.problem.title ?? "", spec: prepared.problem.spec as ProblemSpec, tutor: prepared.problem.tutor as ProblemTutor, phase, language: input.language, code: input.code, results: prepared.tracker.lastResults ?? null,
  }, prepared.level, options.model);
  return withUserTransaction(userId, async (tx) => {
    const { row, tracker } = await lockAttempt(tx, userId, sessionId, input.attemptId);
    // Another request took this level while the hint was written: theirs stands.
    if (phaseLevel(tracker, row.phase) !== prepared.level - 1) return stateOf(tx, userId, sessionId);
    const next = recordHint(tracker, phase) as Tracked;
    const state = transition(row.state === "PROBLEM_INTRO" ? "INDEPENDENT_ATTEMPT" : row.state as TutorState, "hint", { guided: true, optimizing: optimizing(row) });
    await tx.insert(codingEvents).values({ attemptId: row.id, userId, kind: "hint", level: prepared.level, text, data: { stage: phase, requested: !prepared.offered } });
    await tx.update(codingAttempts).set({ tracker: next, state, hintLevel: Math.max(row.hintLevel, next.levels.correct, next.levels.efficient), updatedAt: new Date() }).where(eq(codingAttempts.id, row.id));
    return stateOf(tx, userId, sessionId);
  });
}

export async function declineOffer(userId: string, sessionId: string, attemptId: string): Promise<CodingStateView> {
  return withUserTransaction(userId, async (tx) => {
    const { row, tracker } = await lockAttempt(tx, userId, sessionId, attemptId);
    if (row.state !== "HINT_OFFERED") return stateOf(tx, userId, sessionId);
    await tx.insert(codingEvents).values({ attemptId: row.id, userId, kind: "offer_declined" });
    await tx.update(codingAttempts).set({ tracker: recordDecline(tracker), state: step(row, tracker, "decline"), updatedAt: new Date() }).where(eq(codingAttempts.id, row.id));
    return stateOf(tx, userId, sessionId);
  });
}

/** Gives up and shows the solution: the attempt earns nothing and the concept is practised again on a changed problem. */
export async function revealSolution(userId: string, sessionId: string, attemptId: string, options: Options = {}): Promise<CodingStateView> {
  const state = await withUserTransaction(userId, async (tx) => {
    const { row, tracker } = await lockAttempt(tx, userId, sessionId, attemptId);
    if (tracker.attempts === 0 && tracker.activeMs < REVEAL_AFTER_MS) throw new AuthError("CODING_REVEAL_LOCKED", "Give it a real try first: run your code at least once.", 409);
    const from = transition(row.state as TutorState, "reveal", { guided: guided(tracker) });
    await complete(tx, { ...row, revealed: true }, tracker, from, "");
    return stateOf(tx, userId, sessionId);
  });
  keep(options, prefetchAfter(userId, sessionId, options));
  return state;
}

/** Leaves a correct but slow solution there, for less credit. */
export async function skipOptimization(userId: string, sessionId: string, attemptId: string, options: Options = {}): Promise<CodingStateView> {
  const state = await withUserTransaction(userId, async (tx) => {
    const { row, tracker } = await lockAttempt(tx, userId, sessionId, attemptId);
    if (row.state !== "OPTIMIZATION_STAGE") throw new AuthError("CODING_NOT_OPTIMIZING", "There's no optimization stage to skip.", 409);
    const [latest] = await tx.select({ code: codingSubmissions.code }).from(codingSubmissions).where(and(eq(codingSubmissions.attemptId, row.id), isNotNull(codingSubmissions.code))).orderBy(desc(codingSubmissions.createdAt)).limit(1);
    await complete(tx, row, { ...tracker, skippedOptimization: true }, step(row, tracker, "skip_optimization"), latest?.code ?? "");
    return stateOf(tx, userId, sessionId);
  });
  keep(options, prefetchAfter(userId, sessionId, options));
  return state;
}

/** Opens what Next offers after a finished attempt (or keeps preparing it). */
export async function nextCoding(userId: string, sessionId: string, options: Options = {}): Promise<CodingStateView> {
  return startCoding(userId, sessionId, {}, options);
}

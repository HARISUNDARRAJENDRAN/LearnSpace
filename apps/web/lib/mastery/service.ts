import { randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, masteryChecks, modelInvocations, resourceChunks, userResourceProgress } from "@learnspace/db/schema";
import {
  MASTERY_CONTRACT_VERSION, MASTERY_PASS_SCORE, type MasteryAnswerRequest, type MasteryCheckView, masteryGradeOutputSchema, masteryQuestionsOutputSchema,
  type MasteryVerdict, type MasteryView,
} from "@learnspace/shared/mastery";
import { strictJsonSchema } from "@learnspace/shared/tutor";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { estimateCostUsd, openAiTutorModel, TUTOR_MODEL, type TutorModel, TutorModelError, type TutorModelResult, type TutorUsage } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { restoreLatex } from "../math";
import { completeMasteredLesson } from "../study/service";
import { admitTutorGeneration, recordGlobalSpend } from "../tutor/limits";
import { formatClock } from "../tutor/scope";
import { videoContext } from "../tutor/service";
import { fence, GRADING_INSTRUCTIONS, QUESTION_INSTRUCTIONS } from "./prompt";

const PURPOSE = "mastery_check";
const WATCHED_PCT = 95;
const WRITE_GOAL = "Write a mastery check from the video transcript";
// A writing run older than the routes' 150 s limit was cut off, so it no longer counts as in progress.
const WRITING_WINDOW_MS = 150_000;
const CREDIT: Record<MasteryVerdict, number> = { correct: 1, partial: 0.5, incorrect: 0 };

type Base = { id: string; question: string; chunkIds: string[]; positionMs: number | null };
type StoredQuestion = (Base & { type: "choice"; options: string[]; answer: number; explanation: string }) | (Base & { type: "written"; keyPoints: string[]; modelAnswer: string });
type StoredAnswer = { response: { choice: number } | { text: string }; verdict: MasteryVerdict; credit: number; feedback: string };
type CheckRow = typeof masteryChecks.$inferSelect;
type Options = { model?: TutorModel; signal?: AbortSignal };

/** Five to ten questions: one for every two minutes of video. */
export const questionCount = (durationMs: number | null) => Math.min(10, Math.max(5, Math.round((durationMs ?? 0) / 120_000)));

/** What the learner may see of a set: a question's key only once they have answered it. */
function checkView(row: CheckRow): MasteryCheckView {
  const answers = row.answers as Record<string, StoredAnswer>;
  return {
    id: row.id, status: row.status as MasteryCheckView["status"], score: row.score === null ? null : Number(row.score),
    questions: (row.questions as StoredQuestion[]).map((question) => {
      const answer = answers[question.id];
      return {
        id: question.id, type: question.type, question: question.question, options: question.type === "choice" ? question.options : null, positionMs: question.positionMs,
        result: answer ? {
          verdict: answer.verdict, credit: answer.credit, feedback: answer.feedback, response: answer.response,
          answer: question.type === "choice" ? question.answer : null, modelAnswer: question.type === "written" ? question.modelAnswer : null,
        } : null,
      };
    }),
  };
}

async function masteryContext(tx: Transaction, userId: string, sessionId: string) {
  const video = await videoContext(tx, userId, sessionId);
  const [progress] = await tx.select({ pct: userResourceProgress.progressPct }).from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), eq(userResourceProgress.resourceId, video.resourceId))).limit(1);
  const [latest] = await tx.select().from(masteryChecks).where(and(eq(masteryChecks.userId, userId), eq(masteryChecks.resourceId, video.resourceId))).orderBy(desc(masteryChecks.createdAt)).limit(1);
  const state: MasteryView["state"] = !video.versionId ? "unavailable"
    : latest?.status === "passed" ? "passed"
    : latest?.status === "open" ? "open"
    : Number(progress?.pct ?? 0) < WATCHED_PCT ? "locked"
    : latest?.status === "failed" ? "failed"
    : "ready";
  if (state !== "ready" && state !== "failed") return { video, latest: latest ?? null, state };
  const [writing] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.userId, userId), eq(agentRuns.studySessionId, video.sessionId), eq(agentRuns.goal, WRITE_GOAL),
    eq(agentRuns.status, "executing"), gt(agentRuns.startedAt, new Date(Date.now() - WRITING_WINDOW_MS)))).limit(1);
  return { video, latest: latest ?? null, state: writing ? "writing" as const : state };
}

async function viewOf(tx: Transaction, userId: string, sessionId: string): Promise<MasteryView> {
  const { latest, state } = await masteryContext(tx, userId, sessionId);
  return { state, passScore: MASTERY_PASS_SCORE, check: latest ? checkView(latest) : null };
}

export async function getMastery(userId: string, sessionId: string): Promise<MasteryView> {
  return withUserTransaction(userId, (tx) => viewOf(tx, userId, sessionId));
}

async function openRun(tx: Transaction, userId: string, sessionId: string, goal: string): Promise<string> {
  const [run] = await tx.insert(agentRuns).values({
    userId, studySessionId: sessionId, purpose: PURPOSE, status: "executing", goal, policyVersion: MASTERY_CONTRACT_VERSION,
    maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.depths.deep.maxOutputTokens, correlationId: randomUUID(), startedAt: new Date(),
  }).returning({ id: agentRuns.id });
  return run!.id;
}

/** Records a model call against the learner's and everyone's budgets, and closes its run. */
async function closeRun(tx: Transaction, runId: string, usage: TutorUsage | null, latencyMs: number | null, failure: string | null): Promise<void> {
  const costUsd = usage ? estimateCostUsd(usage) : 0;
  if (usage) {
    await tx.insert(modelInvocations).values({
      agentRunId: runId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${PURPOSE}:${TUTOR_MODEL.depths.deep.effort}`, promptTemplateId: "mastery", promptTemplateVer: MASTERY_CONTRACT_VERSION,
      inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, latencyMs,
      estimatedCostUsd: costUsd.toFixed(8), cacheStatus: "miss", safetyStatus: failure ?? "ok", completedAt: new Date(),
    });
  }
  await recordGlobalSpend(tx, costUsd);
  await tx.update(agentRuns).set({ status: failure ? "failed" : "done", completedAt: new Date(), failureCode: failure?.slice(0, 120) ?? null }).where(eq(agentRuns.id, runId));
}

/** One reasoning call; a failure still closes its run with whatever it was billed, then surfaces as a plain error. */
async function call(userId: string, runId: string, model: TutorModel, request: Parameters<TutorModel>[0], signal: AbortSignal | undefined, message: string): Promise<TutorModelResult> {
  try {
    return await model(request, { signal: signal ?? new AbortController().signal });
  } catch (error) {
    const code = error instanceof TutorModelError ? error.code : "internal_error";
    await withUserTransaction(userId, (tx) => closeRun(tx, runId, error instanceof TutorModelError ? error.usage : null, null, code)).catch(() => undefined);
    throw new AuthError("MASTERY_UNAVAILABLE", code === "cancelled" ? "Stopped." : message, 503);
  }
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text, (_key, value: unknown) => typeof value === "string" ? restoreLatex(value) : value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Writes a fresh set of hard questions from the whole transcript, avoiding every question the learner has seen. */
export async function startMastery(userId: string, sessionId: string, options: Options = {}): Promise<MasteryView> {
  const model = options.model ?? openAiTutorModel;
  const prepared = await withUserTransaction(userId, async (tx) => {
    // The background write when the video ends and the learner's own request must not both start a set.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mastery.write:${userId}:${sessionId}`}, 0))`);
    const { video, latest, state } = await masteryContext(tx, userId, sessionId);
    if (state === "open" || state === "passed" || state === "writing") return { view: { state, passScore: MASTERY_PASS_SCORE, check: latest ? checkView(latest) : null } satisfies MasteryView };
    if (state === "unavailable" || !video.versionId) throw new AuthError("MASTERY_UNAVAILABLE", "This video has no transcript, so it has no mastery check.", 409);
    if (state === "locked") throw new AuthError("MASTERY_LOCKED", "Finish the video to unlock its mastery check.", 409);
    await admitTutorGeneration(tx, userId);
    const chunks = await tx.select({ id: resourceChunks.id, content: resourceChunks.content, startMs: resourceChunks.startMs }).from(resourceChunks)
      .where(eq(resourceChunks.resourceVersionId, video.versionId)).orderBy(asc(resourceChunks.ordinal));
    const earlier = await tx.select({ questions: masteryChecks.questions }).from(masteryChecks).where(and(eq(masteryChecks.userId, userId), eq(masteryChecks.resourceId, video.resourceId)));
    const runId = await openRun(tx, userId, video.sessionId, WRITE_GOAL);
    return { video: { ...video, versionId: video.versionId }, chunks, avoid: earlier.flatMap((row) => (row.questions as StoredQuestion[]).map((question) => question.question)), runId };
  });
  if ("view" in prepared) return prepared.view;
  const { video, runId } = prepared;
  // The whole transcript, every time, so no part of the lesson goes untested.
  const passages = prepared.chunks;
  const count = questionCount(video.durationMs);
  const written = Math.max(2, Math.round(count * 0.3));
  const user = [
    `<video_title>${fence(video.title)}</video_title>`,
    `<transcript>\n${passages.map((chunk, index) => `[${index + 1}]${chunk.startMs === null ? "" : ` ${formatClock(chunk.startMs)}`}\n${fence(chunk.content)}`).join("\n\n")}\n</transcript>`,
    `<avoid>\n${prepared.avoid.map((question) => `- ${fence(question)}`).join("\n")}\n</avoid>`,
  ].join("\n\n");
  const result = await call(userId, runId, model, {
    depth: "deep", instructions: QUESTION_INSTRUCTIONS, user, schema: strictJsonSchema(masteryQuestionsOutputSchema), cacheKey: `learnspace-${MASTERY_CONTRACT_VERSION}`,
    developer: `Write exactly ${count} questions: ${count - written} "choice" and ${written} "written", in the order their ideas appear in the lesson.`,
  }, options.signal, "The check couldn't be written right now. Try again in a moment.");
  // A question citing passages it wasn't shown is dropped, so every question links to a real moment.
  const questions: StoredQuestion[] = (parse(masteryQuestionsOutputSchema, result.text)?.questions ?? []).flatMap((question) => {
    const cited = question.cite.flatMap((number) => passages[number - 1] ?? []);
    if (cited.length === 0 || !question.question.trim()) return [];
    const base = { question: question.question.trim(), chunkIds: cited.map((chunk) => chunk.id), positionMs: cited[0]!.startMs };
    return [question.type === "choice"
      ? { ...base, type: "choice" as const, options: question.options, answer: question.answer, explanation: question.explanation }
      : { ...base, type: "written" as const, keyPoints: question.keyPoints, modelAnswer: question.modelAnswer }];
  }).map((question, index) => ({ ...question, id: `q${index}` }));
  // The call is billed either way, so its cost is recorded before a bad set is refused.
  const usable = questions.length >= 5;
  await withUserTransaction(userId, (tx) => closeRun(tx, runId, result.usage, result.latencyMs, usable ? null : "invalid_output"));
  if (!usable) throw new AuthError("MASTERY_UNAVAILABLE", "The check couldn't be written right now. Try again in a moment.", 503);
  return withUserTransaction(userId, async (tx) => {
    // Another tab may have started a set meanwhile; that one stands.
    const [row] = await tx.insert(masteryChecks).values({ userId, studySessionId: video.sessionId, resourceId: video.resourceId, resourceVersionId: video.versionId, questions })
      .onConflictDoNothing().returning();
    const check = row ?? (await tx.select().from(masteryChecks).where(and(eq(masteryChecks.userId, userId), eq(masteryChecks.resourceId, video.resourceId), eq(masteryChecks.status, "open"))).limit(1))[0];
    return { state: "open", passScore: MASTERY_PASS_SCORE, check: check ? checkView(check) : null };
  });
}

/** Locks the learner's open set for this video and the question being answered. */
async function lockQuestion(tx: Transaction, userId: string, sessionId: string, input: MasteryAnswerRequest) {
  const video = await videoContext(tx, userId, sessionId);
  const [row] = await tx.select().from(masteryChecks).where(and(eq(masteryChecks.id, input.checkId), eq(masteryChecks.userId, userId), eq(masteryChecks.resourceId, video.resourceId))).for("update").limit(1);
  if (!row) throw new AuthError("MASTERY_CHECK_NOT_FOUND", "That check isn't part of this lesson.", 404);
  const question = (row.questions as StoredQuestion[]).find((item) => item.id === input.questionId);
  if (!question) throw new AuthError("INVALID_MASTERY_ANSWER", "That question isn't part of this check.", 422);
  if (("choice" in input) !== (question.type === "choice")) throw new AuthError("INVALID_MASTERY_ANSWER", question.type === "choice" ? "Pick one of the options." : "Write your answer.", 422);
  const settled = row.status !== "open" || Boolean((row.answers as Record<string, StoredAnswer>)[question.id]);
  return { video, row, question, settled };
}

/** Stores an answer; the last one scores the set, and a pass completes the lesson so the next one unlocks. */
async function record(tx: Transaction, userId: string, sessionId: string, row: CheckRow, questionId: string, answer: StoredAnswer): Promise<MasteryView> {
  const answers = { ...(row.answers as Record<string, StoredAnswer>), [questionId]: answer };
  const questions = row.questions as StoredQuestion[];
  const done = questions.every((question) => answers[question.id]);
  const score = done ? questions.reduce((sum, question) => sum + answers[question.id]!.credit, 0) / questions.length : null;
  const passed = score !== null && score >= MASTERY_PASS_SCORE;
  const [updated] = await tx.update(masteryChecks).set({ answers, ...(done ? { status: passed ? "passed" : "failed", score: score!.toFixed(4), completedAt: new Date() } : {}) })
    .where(eq(masteryChecks.id, row.id)).returning();
  if (passed) await completeMasteredLesson(tx, userId, sessionId, row.resourceId, row.id);
  return { state: done ? passed ? "passed" : "failed" : "open", passScore: MASTERY_PASS_SCORE, check: checkView(updated!) };
}

export async function answerMastery(userId: string, sessionId: string, input: MasteryAnswerRequest, options: Options = {}): Promise<MasteryView> {
  const model = options.model ?? openAiTutorModel;
  const staged = await withUserTransaction(userId, async (tx) => {
    const { row, question, settled } = await lockQuestion(tx, userId, sessionId, input);
    if (settled) return { view: await viewOf(tx, userId, sessionId) };
    // Multiple choice is graded here, from the stored key.
    if (question.type === "choice" && "choice" in input) {
      const correct = input.choice === question.answer;
      return { view: await record(tx, userId, sessionId, row, question.id, { response: { choice: input.choice }, verdict: correct ? "correct" : "incorrect", credit: correct ? 1 : 0, feedback: question.explanation }) };
    }
    if (question.type !== "written" || !("text" in input)) throw new AuthError("INVALID_MASTERY_ANSWER", "Write your answer.", 422);
    await admitTutorGeneration(tx, userId);
    const passages = await tx.select({ content: resourceChunks.content }).from(resourceChunks).where(inArray(resourceChunks.id, question.chunkIds));
    return { question, text: input.text, passages: passages.map((passage) => passage.content), runId: await openRun(tx, userId, row.studySessionId, "Grade a written mastery answer") };
  });
  if ("view" in staged) return staged.view;
  const { question, text, passages, runId } = staged;
  const result = await call(userId, runId, model, {
    depth: "deep", instructions: GRADING_INSTRUCTIONS, developer: "Grade the learner's answer.", schema: strictJsonSchema(masteryGradeOutputSchema), cacheKey: `learnspace-${MASTERY_CONTRACT_VERSION}-grade`,
    user: [
      `<question>${fence(question.question)}</question>`,
      `<key_points>\n${question.keyPoints.map((point) => `- ${fence(point)}`).join("\n")}\n</key_points>`,
      `<model_answer>${fence(question.modelAnswer)}</model_answer>`,
      `<passages>\n${passages.map(fence).join("\n\n")}\n</passages>`,
      `<answer>${fence(text)}</answer>`,
    ].join("\n\n"),
  }, options.signal, "Your answer couldn't be graded right now. Try again in a moment.");
  const grade = parse(masteryGradeOutputSchema, result.text);
  await withUserTransaction(userId, (tx) => closeRun(tx, runId, result.usage, result.latencyMs, grade ? null : "invalid_output"));
  if (!grade) throw new AuthError("MASTERY_UNAVAILABLE", "Your answer couldn't be graded right now. Try again in a moment.", 503);
  return withUserTransaction(userId, async (tx) => {
    const { row, settled } = await lockQuestion(tx, userId, sessionId, input);
    if (settled) return viewOf(tx, userId, sessionId);
    return record(tx, userId, sessionId, row, question.id, { response: { text }, verdict: grade.verdict, credit: CREDIT[grade.verdict], feedback: grade.feedback.trim() });
  });
}

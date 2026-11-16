import { randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, masteryChecks, modelInvocations, resourceChunks, resources, userResourceProgress, videoNotes } from "@learnspace/db/schema";
import {
  MASTERY_CONTRACT_VERSION, MASTERY_PASS_SCORE, type MasteryAnalysisView, masteryAnalysisOutputSchema, type MasteryAnswerRequest, type MasteryCheckView, masteryGradeOutputSchema,
  masteryQuestionsOutputSchema, type MasteryVerdict, type MasteryView,
} from "@learnspace/shared/mastery";
import type { NoteBlock } from "@learnspace/shared/notes";
import { strictJsonSchema } from "@learnspace/shared/tutor";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Allow, parse as parsePartial } from "partial-json";
import { estimateCostUsd, openAiTutorModel, TUTOR_MODEL, type TutorDepth, type TutorModel, TutorModelError, type TutorModelResult, type TutorUsage } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { restoreLatex } from "../math";
import { completeMasteredLesson } from "../study/service";
import { admitTutorGeneration, recordGlobalSpend } from "../tutor/limits";
import { formatClock } from "../tutor/scope";
import { videoContext } from "../tutor/service";
import { ANALYSIS_INSTRUCTIONS, buildAnalysisPrompt, fence, GRADING_INSTRUCTIONS, QUESTION_INSTRUCTIONS } from "./prompt";

const PURPOSE = "mastery_check";
const WATCHED_PCT = 95;
const WRITE_GOAL = "Write a mastery check from the video transcript";
const ANALYSIS_GOAL = "Analyse a scored mastery check";
// An analysis still "writing" after its route's limit was cut off with it, so it can be asked for again.
const ANALYSIS_WINDOW_MS = 300_000;
const ANALYSIS_SCHEMA = strictJsonSchema(masteryAnalysisOutputSchema);
const TIMESTAMP = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/;
// A writing run older than the routes' 150 s limit was cut off, so it no longer counts as in progress.
const WRITING_WINDOW_MS = 150_000;
const CREDIT: Record<MasteryVerdict, number> = { correct: 1, partial: 0.5, incorrect: 0 };

// Sets written before questions named their concept have none.
type Base = { id: string; concept?: string; question: string; chunkIds: string[]; positionMs: number | null };
type StoredQuestion = (Base & { type: "choice"; options: string[]; answer: number; explanation: string }) | (Base & { type: "written"; keyPoints: string[]; modelAnswer: string });
type StoredAnswer = { response: { choice: number } | { text: string }; verdict: MasteryVerdict; credit: number; feedback: string };
type CheckRow = typeof masteryChecks.$inferSelect;
type Options = { model?: TutorModel; signal?: AbortSignal };
const questionSchema = masteryQuestionsOutputSchema.shape.questions.element;

/** A set still taking questions; one whose writer died (past the routes' limit) counts as whole with what it has. */
const stillWriting = (row: CheckRow) => row.writtenAt === null && row.createdAt.getTime() > Date.now() - WRITING_WINDOW_MS;

/** Five to ten questions: one for every two minutes of video. */
export const questionCount = (durationMs: number | null) => Math.min(10, Math.max(5, Math.round((durationMs ?? 0) / 120_000)));

type Report = Pick<MasteryCheckView, "earlierScores" | "notesSections">;
const NO_REPORT: Report = { earlierScores: [], notesSections: {} };

function analysisView(value: Record<string, unknown> | null): MasteryAnalysisView | null {
  if (!value) return null;
  if (value.status === "ready") return value as MasteryAnalysisView;
  return value.status === "writing" && Number(value.startedAt) > Date.now() - ANALYSIS_WINDOW_MS ? { status: "writing" } : { status: "failed" };
}

/** What the learner may see of a set: a question's key only once they have answered it. */
function checkView(row: CheckRow, report: Report = NO_REPORT): MasteryCheckView {
  const answers = row.answers as Record<string, StoredAnswer>;
  return {
    id: row.id, status: row.status as MasteryCheckView["status"], score: row.score === null ? null : Number(row.score), writing: stillWriting(row),
    analysis: row.status === "open" ? null : analysisView(row.analysis), ...report,
    questions: (row.questions as StoredQuestion[]).map((question) => {
      const answer = answers[question.id];
      return {
        id: question.id, type: question.type, concept: question.concept ?? null, question: question.question, options: question.type === "choice" ? question.options : null, positionMs: question.positionMs,
        result: answer ? {
          verdict: answer.verdict, credit: answer.credit, feedback: answer.feedback, response: answer.response,
          answer: question.type === "choice" ? question.answer : null, modelAnswer: question.type === "written" ? question.modelAnswer : null,
        } : null,
      };
    }),
  };
}

/**
 * What a scored set is read against: the learner's earlier scored sets on the video, and for each question the section of
 * their notes covering its moment (the last heading timestamped at or before it).
 */
async function reportOf(tx: Transaction, row: CheckRow): Promise<Report> {
  if (row.status === "open") return NO_REPORT;
  const earlier = await tx.select({ score: masteryChecks.score }).from(masteryChecks)
    .where(and(eq(masteryChecks.userId, row.userId), eq(masteryChecks.resourceId, row.resourceId), inArray(masteryChecks.status, ["passed", "failed"]), lt(masteryChecks.createdAt, row.createdAt)))
    .orderBy(asc(masteryChecks.createdAt));
  const [notes] = await tx.select({ blocks: videoNotes.blocks }).from(videoNotes).where(and(eq(videoNotes.userId, row.userId), eq(videoNotes.resourceId, row.resourceId))).limit(1);
  const sections = ((notes?.blocks ?? []) as NoteBlock[]).flatMap((block) => {
    const match = block.type === "heading" ? TIMESTAMP.exec(block.text) : null;
    return match ? [{ title: block.text.replace(TIMESTAMP, "").trim(), ms: ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1_000 }] : [];
  }).sort((a, b) => a.ms - b.ms);
  const notesSections: Record<string, string> = {};
  for (const question of row.questions as StoredQuestion[]) {
    const section = question.positionMs === null ? undefined : sections.findLast((item) => item.ms <= (question.positionMs ?? 0));
    if (section?.title) notesSections[question.id] = section.title;
  }
  return { earlierScores: earlier.map((item) => Number(item.score)), notesSections };
}

async function watched(tx: Transaction, userId: string, resourceId: string): Promise<boolean> {
  const [progress] = await tx.select({ pct: userResourceProgress.progressPct }).from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), eq(userResourceProgress.resourceId, resourceId))).limit(1);
  return Number(progress?.pct ?? 0) >= WATCHED_PCT;
}

/**
 * Where the active video's check stands. The first set is written while the video plays, but stays locked (unread and
 * unanswerable) until the video is watched to the end; `writing` says a set is being written and has no question yet.
 */
async function masteryContext(tx: Transaction, userId: string, sessionId: string) {
  const video = await videoContext(tx, userId, sessionId);
  const [latest] = await tx.select().from(masteryChecks).where(and(eq(masteryChecks.userId, userId), eq(masteryChecks.resourceId, video.resourceId))).orderBy(desc(masteryChecks.createdAt)).limit(1);
  const state: MasteryView["state"] = !video.versionId ? "unavailable"
    : latest?.status === "passed" ? "passed"
    : !(await watched(tx, userId, video.resourceId)) ? "locked"
    : latest?.status === "open" ? "open"
    : latest?.status === "failed" ? "failed"
    : "ready";
  if (state !== "ready" && state !== "failed" && !(state === "locked" && !latest)) return { video, latest: latest ?? null, state, writing: false };
  const [writing] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.userId, userId), eq(agentRuns.studySessionId, video.sessionId), eq(agentRuns.goal, WRITE_GOAL),
    eq(agentRuns.status, "executing"), gt(agentRuns.startedAt, new Date(Date.now() - WRITING_WINDOW_MS)))).limit(1);
  return { video, latest: latest ?? null, state, writing: Boolean(writing) };
}

async function viewOf(tx: Transaction, userId: string, sessionId: string): Promise<MasteryView> {
  const context = await masteryContext(tx, userId, sessionId);
  const { latest } = context;
  // A locked lesson shows nothing of a set written ahead of time.
  if (context.state === "locked") return { state: "locked", passScore: MASTERY_PASS_SCORE, check: null };
  const state = context.writing ? "writing" : context.state;
  if (latest && latest.status !== "open") return { state, passScore: MASTERY_PASS_SCORE, check: checkView(latest, await reportOf(tx, latest)) };
  // A set whose writer died stands with the questions it has; once they are all answered, it is scored.
  if (latest?.status === "open" && latest.writtenAt === null && !stillWriting(latest)) return settle(tx, userId, sessionId, latest, latest.answers as Record<string, StoredAnswer>);
  return { state, passScore: MASTERY_PASS_SCORE, check: latest ? checkView(latest) : null };
}

/**
 * How the learner's mastery checks in a session went, for Luny: per lesson, the latest scored set and the concepts they
 * missed in it, newest first. Empty when nothing is scored yet.
 */
export async function masteryRecord(tx: Transaction, userId: string, sessionId: string, currentResourceId: string | Promise<string>): Promise<string> {
  const rows = await tx.select({ resourceId: masteryChecks.resourceId, title: resources.title, status: masteryChecks.status, score: masteryChecks.score, questions: masteryChecks.questions, answers: masteryChecks.answers })
    .from(masteryChecks).innerJoin(resources, eq(resources.id, masteryChecks.resourceId))
    .where(and(eq(masteryChecks.userId, userId), eq(masteryChecks.studySessionId, sessionId), inArray(masteryChecks.status, ["passed", "failed"])))
    .orderBy(desc(masteryChecks.createdAt)).limit(30);
  // Only the labels need the current lesson, so a caller still finding it can pass it as it comes.
  const current = await currentResourceId;
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.resourceId) || seen.size >= 8) return [];
    seen.add(row.resourceId);
    const answers = row.answers as Record<string, StoredAnswer>;
    const missed = [...new Set((row.questions as StoredQuestion[]).flatMap((question) => (answers[question.id]?.credit ?? 0) < 1 && question.concept ? [question.concept] : []))];
    const lesson = row.resourceId === current ? "This video" : `"${fence(row.title)}"`;
    return [`- ${lesson}: ${row.status} its mastery check at ${Math.round(Number(row.score) * 100)}%${missed.length ? `; missed ${missed.map(fence).join(", ")}` : ""}.`];
  }).join("\n");
}

/**
 * The active video's check, or with `checkId` one particular set of this session: passing a set moves the session on to the
 * next lesson, and its results stay readable while the learner looks them over.
 */
export async function getMastery(userId: string, sessionId: string, checkId?: string): Promise<MasteryView> {
  return withUserTransaction(userId, async (tx) => {
    if (!checkId) return viewOf(tx, userId, sessionId);
    const row = await sessionCheck(tx, userId, sessionId, checkId, false);
    return { state: row.status as MasteryView["state"], passScore: MASTERY_PASS_SCORE, check: checkView(row, await reportOf(tx, row)) };
  });
}

async function sessionCheck(tx: Transaction, userId: string, sessionId: string, checkId: string, lock: boolean): Promise<CheckRow> {
  const query = tx.select().from(masteryChecks).where(and(eq(masteryChecks.id, checkId), eq(masteryChecks.userId, userId), eq(masteryChecks.studySessionId, sessionId))).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new AuthError("MASTERY_CHECK_NOT_FOUND", "That check isn't part of this session.", 404);
  return row;
}

async function openRun(tx: Transaction, userId: string, sessionId: string, goal: string): Promise<string> {
  const [run] = await tx.insert(agentRuns).values({
    userId, studySessionId: sessionId, purpose: PURPOSE, status: "executing", goal, policyVersion: MASTERY_CONTRACT_VERSION,
    maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.depths.deep.maxOutputTokens, correlationId: randomUUID(), startedAt: new Date(),
  }).returning({ id: agentRuns.id });
  return run!.id;
}

/** Records a model call against the learner's and everyone's budgets, and closes its run. */
async function closeRun(tx: Transaction, runId: string, usage: TutorUsage | null, latencyMs: number | null, failure: string | null, depth: TutorDepth = "deep"): Promise<void> {
  const costUsd = usage ? estimateCostUsd(usage) : 0;
  if (usage) {
    await tx.insert(modelInvocations).values({
      agentRunId: runId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${PURPOSE}:${TUTOR_MODEL.depths[depth].effort}`, promptTemplateId: depth === "long" ? "mastery-analysis" : "mastery", promptTemplateVer: MASTERY_CONTRACT_VERSION,
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

/**
 * Writes a fresh set of hard questions from the whole transcript, avoiding every question the learner has seen. The set is
 * saved as each question streams in, and this resolves once the first is saved, so the learner starts on it while the rest
 * are written; `keepAlive` receives the rest of the work (Next's `after`, in a route).
 */
export async function startMastery(userId: string, sessionId: string, options: Omit<Options, "signal"> & { keepAlive?: (work: Promise<void>) => void; ahead?: boolean } = {}): Promise<MasteryView> {
  const model = options.model ?? openAiTutorModel;
  const prepared = await withUserTransaction(userId, async (tx) => {
    // The background write when the video ends and the learner's own request must not both start a set.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mastery.write:${userId}:${sessionId}`}, 0))`);
    const { video, latest, state, writing } = await masteryContext(tx, userId, sessionId);
    if (state === "unavailable" || !video.versionId) throw new AuthError("MASTERY_UNAVAILABLE", "This video has no transcript, so it has no mastery check.", 409);
    // `ahead` writes the first set while the video plays; any other set waits until the video is watched.
    if (state === "locked" && (!options.ahead || latest)) throw new AuthError("MASTERY_LOCKED", "Finish the video to unlock its mastery check.", 409);
    if (state === "open" || state === "passed" || writing || (options.ahead && state !== "locked")) return { view: { state: state === "locked" ? "locked" : writing ? "writing" : state, passScore: MASTERY_PASS_SCORE, check: latest && state !== "locked" ? checkView(latest) : null } satisfies MasteryView };
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

  const stored: StoredQuestion[] = [];
  let seen = 0;
  let checkId: string | null = null;
  let saving = Promise.resolve();
  const first = Promise.withResolvers<MasteryView>();
  let shown = false;
  const show = (view: MasteryView) => { if (!shown) { shown = true; first.resolve(view); } };
  // Another tab's set landed first: that one stands, and this one stops writing.
  const stop = new AbortController();

  /** Stores the questions finished so far; while the output streams, the last one is still being written. */
  const take = (raw: unknown[], final: boolean) => {
    const done = final ? raw : raw.slice(0, -1);
    for (const item of done.slice(seen)) {
      const parsed = questionSchema.safeParse(JSON.parse(JSON.stringify(item), (_key, value: unknown) => typeof value === "string" ? restoreLatex(value) : value));
      // A question citing passages it wasn't shown is dropped, so every question links to a real moment.
      const cited = parsed.success ? parsed.data.cite.flatMap((number) => passages[number - 1] ?? []) : [];
      if (!parsed.success || cited.length === 0 || !parsed.data.question.trim()) continue;
      const question = parsed.data;
      const base = { id: `q${stored.length}`, ...(question.concept.trim() ? { concept: question.concept.trim() } : {}), question: question.question.trim(), chunkIds: cited.map((chunk) => chunk.id), positionMs: cited[0]!.startMs };
      stored.push(question.type === "choice"
        ? { ...base, type: "choice", options: question.options, answer: question.answer, explanation: question.explanation }
        : { ...base, type: "written", keyPoints: question.keyPoints, modelAnswer: question.modelAnswer });
    }
    const grew = done.length > seen;
    seen = Math.max(seen, done.length);
    if ((grew && stored.length) || final) save(final);
  };
  /** Saves the set as it stands, in order; the first save creates it and shows the learner its first question. */
  const save = (final: boolean) => {
    const questions = [...stored];
    saving = saving.then(() => withUserTransaction(userId, async (tx) => {
      if (stop.signal.aborted || (!questions.length && !checkId)) return;
      const writtenAt = final ? new Date() : null;
      if (!checkId) {
        const [row] = await tx.insert(masteryChecks).values({ userId, studySessionId: video.sessionId, resourceId: video.resourceId, resourceVersionId: video.versionId, questions, writtenAt })
          .onConflictDoNothing().returning();
        if (!row) { stop.abort(); show(await viewOf(tx, userId, sessionId)); return; }
        checkId = row.id;
        show(await viewOf(tx, userId, sessionId));
        return;
      }
      const [row] = await tx.select().from(masteryChecks).where(eq(masteryChecks.id, checkId)).for("update").limit(1);
      if (!row || row.writtenAt) return;
      const [updated] = await tx.update(masteryChecks).set({ questions, writtenAt }).where(eq(masteryChecks.id, checkId)).returning();
      // The learner may have answered every question already there; a finished set is scored now.
      if (final && updated) await settle(tx, userId, sessionId, updated, updated.answers as Record<string, StoredAnswer>);
    }));
    return saving;
  };

  const work = (async () => {
    let result: TutorModelResult | null = null;
    let failure: TutorModelError | null = null;
    try {
      result = await model({
        depth: "deep", instructions: QUESTION_INSTRUCTIONS, user, schema: strictJsonSchema(masteryQuestionsOutputSchema), cacheKey: `learnspace-${MASTERY_CONTRACT_VERSION}`,
        developer: `Write exactly ${count} questions: ${count - written} "choice" and ${written} "written", in the order their ideas appear in the lesson.`,
      }, {
        signal: stop.signal,
        onText: (text) => {
          const partial = (() => { try { return parsePartial(text, Allow.ALL) as { questions?: unknown[] }; } catch { return null; } })();
          if (Array.isArray(partial?.questions)) take(partial.questions, false);
        },
      });
      const whole = (() => { try { return JSON.parse(result.text) as { questions?: unknown[] }; } catch { return null; } })();
      take(Array.isArray(whole?.questions) ? whole.questions : [], true);
    } catch (error) {
      failure = error instanceof TutorModelError ? error : new TutorModelError("internal_error");
      // Questions already saved stand as the set: the learner may be answering them.
      take([], true);
    }
    await saving;
    const code = failure?.code ?? (stored.length >= 5 ? null : "invalid_output");
    await withUserTransaction(userId, (tx) => closeRun(tx, runId, result?.usage ?? failure?.usage ?? null, result?.latencyMs ?? null, code)).catch(() => undefined);
    if (!stored.length && !stop.signal.aborted) first.reject(new AuthError("MASTERY_UNAVAILABLE", "The check couldn't be written right now. Try again in a moment.", 503));
  })();
  const rest = work.catch((error: unknown) => { if (!shown) first.reject(error); });
  options.keepAlive?.(rest);
  return first.promise;
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
  // A set written while the video plays can't be answered before the video is watched.
  if (!settled && !(await watched(tx, userId, video.resourceId))) throw new AuthError("MASTERY_LOCKED", "Finish the video to unlock its mastery check.", 409);
  return { video, row, question, settled };
}

/** Stores an answer; the last one scores the set, and a pass completes the lesson so the next one unlocks. */
async function record(tx: Transaction, userId: string, sessionId: string, row: CheckRow, questionId: string, answer: StoredAnswer): Promise<MasteryView> {
  return settle(tx, userId, sessionId, row, { ...(row.answers as Record<string, StoredAnswer>), [questionId]: answer });
}

/** Saves the answers, and scores the set once it is whole and every question in it is answered. */
async function settle(tx: Transaction, userId: string, sessionId: string, row: CheckRow, answers: Record<string, StoredAnswer>): Promise<MasteryView> {
  const questions = row.questions as StoredQuestion[];
  const done = !stillWriting(row) && questions.every((question) => answers[question.id]);
  const score = done ? questions.reduce((sum, question) => sum + answers[question.id]!.credit, 0) / questions.length : null;
  const passed = score !== null && score >= MASTERY_PASS_SCORE;
  const [updated] = await tx.update(masteryChecks).set({ answers, ...(done ? { status: passed ? "passed" : "failed", score: score!.toFixed(4), completedAt: new Date() } : {}) })
    .where(eq(masteryChecks.id, row.id)).returning();
  if (passed) await completeMasteredLesson(tx, userId, sessionId, row.resourceId, row.id);
  return { state: done ? passed ? "passed" : "failed" : "open", passScore: MASTERY_PASS_SCORE, check: checkView(updated!, await reportOf(tx, updated!)) };
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

/**
 * Starts the learning analysis of a scored set unless it is written or being written. `write` writes it, after the caller
 * has answered; the results are readable meanwhile, and the analysis fills in when it lands.
 */
export async function startAnalysis(userId: string, sessionId: string, checkId: string, options: { model?: TutorModel } = {}): Promise<{ view: MasteryView; write: (() => Promise<void>) | null }> {
  const model = options.model ?? openAiTutorModel;
  const started = await withUserTransaction(userId, async (tx) => {
    const row = await sessionCheck(tx, userId, sessionId, checkId, true);
    if (row.status === "open") throw new AuthError("MASTERY_NOT_SCORED", "Finish the check to see its analysis.", 409);
    const status = analysisView(row.analysis)?.status;
    const view = async (current: CheckRow): Promise<MasteryView> => ({ state: current.status as MasteryView["state"], passScore: MASTERY_PASS_SCORE, check: checkView(current, await reportOf(tx, current)) });
    if (status === "ready" || status === "writing") return { view: await view(row) };
    await admitTutorGeneration(tx, userId);
    const startedAt = Date.now();
    const [updated] = await tx.update(masteryChecks).set({ analysis: { status: "writing", startedAt } }).where(eq(masteryChecks.id, row.id)).returning();
    const questions = row.questions as StoredQuestion[];
    const answers = row.answers as Record<string, StoredAnswer>;
    const missed = questions.filter((question) => (answers[question.id]?.credit ?? 0) < 1);
    const passages = missed.length ? await tx.select({ id: resourceChunks.id, content: resourceChunks.content }).from(resourceChunks).where(inArray(resourceChunks.id, missed.flatMap((question) => question.chunkIds))) : [];
    const runId = await openRun(tx, userId, sessionId, ANALYSIS_GOAL);
    const user = buildAnalysisPrompt({
      score: Number(row.score ?? 0), passScore: MASTERY_PASS_SCORE,
      questions: questions.map((question) => {
        const answer = answers[question.id];
        const response = answer?.response;
        return {
          id: question.id, concept: question.concept ?? null, type: question.type, question: question.question, moment: question.positionMs === null ? null : formatClock(question.positionMs),
          verdict: answer?.verdict ?? "incorrect",
          ...(question.type === "choice"
            ? { options: question.options, correct: question.answer, chosen: response && "choice" in response ? response.choice : null, explanation: question.explanation }
            : { keyPoints: question.keyPoints, modelAnswer: question.modelAnswer, written: response && "text" in response ? response.text : "", feedback: answer?.feedback ?? "" }),
          passages: question.chunkIds.flatMap((id) => passages.find((passage) => passage.id === id)?.content ?? []),
        };
      }),
    });
    return { view: await view(updated ?? row), job: { runId, startedAt, user, missed: new Set(missed.map((question) => question.id)) } };
  });
  const { job } = started;
  if (!job) return { view: started.view, write: null };
  return {
    view: started.view,
    write: async () => {
      const finish = (analysis: Record<string, unknown>) => withUserTransaction(userId, async (tx) => {
        // Only the run that started the analysis finishes it; one cut off and asked for again leaves it to the newer run.
        const [row] = await tx.select({ analysis: masteryChecks.analysis }).from(masteryChecks).where(eq(masteryChecks.id, checkId)).for("update").limit(1);
        if (row?.analysis?.status === "writing" && row.analysis.startedAt === job.startedAt) await tx.update(masteryChecks).set({ analysis }).where(eq(masteryChecks.id, checkId));
      });
      let result: TutorModelResult;
      try {
        result = await model({ depth: "long", instructions: ANALYSIS_INSTRUCTIONS, developer: "", user: job.user, schema: ANALYSIS_SCHEMA, cacheKey: `learnspace-${MASTERY_CONTRACT_VERSION}-analysis` }, { signal: new AbortController().signal });
      } catch (error) {
        await withUserTransaction(userId, (tx) => closeRun(tx, job.runId, error instanceof TutorModelError ? error.usage : null, null, error instanceof TutorModelError ? error.code : "internal_error", "long"));
        await finish({ status: "failed" });
        return;
      }
      const analysis = parse(masteryAnalysisOutputSchema, result.text);
      await withUserTransaction(userId, (tx) => closeRun(tx, job.runId, result.usage, result.latencyMs, analysis ? null : result.refusal ? "refused" : "invalid_output", "long"));
      // A mistake is only ever about a question the learner actually missed.
      await finish(analysis ? { status: "ready", ...analysis, mistakes: analysis.mistakes.filter((mistake) => job.missed.has(mistake.questionId)) } : { status: "failed" });
    },
  };
}

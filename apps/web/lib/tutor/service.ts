import { createHash, randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, citations, modelInvocations, resources, resourceVersions, studySessions, transcriptRequests, tutorMessages, tutorThreads, videoDetails } from "@learnspace/db/schema";
import {
  TUTOR_CONTRACT_VERSION, tutorModelOutputSchema, tutorOutputJsonSchema,
  type TutorInteractionRequest, type TutorMessageView, type TutorModelOutput, type TutorOutcome, type TutorStreamEvent, type TutorThreadView, type TutorTranscriptStatus, type TutorTurnRequest,
} from "@learnspace/shared/tutor";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { embedText } from "../ai/openai";
import { estimateCostUsd, openAiTutorModel, TUTOR_MODEL, type TutorModel, TutorModelError, type TutorUsage } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { recordStudyQuestion } from "../study/service";
import { cacheEligible, findCachedAnswer, storeCachedAnswer } from "./cache";
import { answerText, blockView, type GroundedAnswer, groundOutput, type Interaction, type LearnerState, mergeLearner, OUTCOME_NOTICE, readLearner, recordCheck, type StoredBlock, suggestMove } from "./grounding";
import { admitTutorGeneration, recordGlobalSpend } from "./limits";
import { buildTutorPrompt, type HistoryTurn, TUTOR_INSTRUCTIONS } from "./prompt";
import { retrieveEvidence } from "./retrieval";
import { formatClock, lexicalQuery, questionTerms, resolveScope, type TutorScope } from "./scope";

const PURPOSE = "video_tutor";
const HISTORY_TURNS = 8;

/** What a stored assistant message holds; the browser only ever sees `messageView` of it. */
type AssistantContent = {
  contract?: string;
  outcome?: TutorOutcome;
  blocks?: StoredBlock[];
  sources?: GroundedAnswer["sources"];
  versionId?: string;
  retrievalRunId?: string;
  interactions?: Record<string, Interaction>;
  failure?: string;
  cache?: "exact" | "semantic";
};
type UserContent = { positionMs?: number; replyTo?: { messageId: string; blockId: string } };
type MessageRow = typeof tutorMessages.$inferSelect;

type VideoContext = {
  sessionId: string;
  resourceId: string;
  title: string;
  durationMs: number | null;
  publicSource: boolean;
  versionId: string | null;
  versionSource: string | null;
  transcript: TutorTranscriptStatus;
};

/** The learner's session and its active video, with where that video's transcript stands. Only the active video is ever in scope. */
async function videoContext(tx: Transaction, userId: string, sessionId: string): Promise<VideoContext> {
  const [row] = await tx
    .select({ session: studySessions, resource: resources, durationMs: videoDetails.durationMs, versionStatus: resourceVersions.processingStatus, versionSource: resourceVersions.parserName, requestStatus: transcriptRequests.status })
    .from(studySessions)
    .innerJoin(resources, eq(resources.id, studySessions.activeResourceId))
    .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
    .leftJoin(transcriptRequests, eq(transcriptRequests.resourceId, resources.id))
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId), ne(studySessions.status, "abandoned"), isNull(resources.deletedAt)))
    .limit(1);
  if (!row) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That study session has no video to study.", 404);
  const ready = row.versionStatus === "ready";
  const transcript: TutorTranscriptStatus = ready ? "ready" : row.requestStatus === "unavailable" ? "unavailable" : row.requestStatus === "failed" ? "failed" : "preparing";
  return {
    sessionId, resourceId: row.resource.id, title: row.resource.title, durationMs: row.durationMs,
    publicSource: row.resource.ownerUserId === null && (row.resource.visibility === "public" || row.resource.visibility === "unlisted"),
    versionId: ready ? row.resource.currentVersionId : null, versionSource: ready ? row.versionSource : null, transcript,
  };
}

async function activeThread(tx: Transaction, userId: string, video: VideoContext, create: boolean): Promise<typeof tutorThreads.$inferSelect | null> {
  const where = and(eq(tutorThreads.userId, userId), eq(tutorThreads.studySessionId, video.sessionId), eq(tutorThreads.resourceId, video.resourceId), eq(tutorThreads.status, "active"));
  const [existing] = await tx.select().from(tutorThreads).where(where).limit(1);
  if (existing || !create) return existing ?? null;
  await tx.insert(tutorThreads).values({ userId, studySessionId: video.sessionId, resourceId: video.resourceId, mode: PURPOSE }).onConflictDoNothing();
  const [created] = await tx.select().from(tutorThreads).where(where).limit(1);
  return created ?? null;
}

export function messageView(row: MessageRow, currentVersionId: string | null): TutorMessageView {
  if (row.actorType === "user") {
    const content = row.content as UserContent;
    return { id: row.id, role: "user", status: "completed", createdAt: row.createdAt.toISOString(), text: row.contentText ?? "", positionMs: content.positionMs ?? null, outcome: null, blocks: [], sources: [], stale: false };
  }
  const content = row.content as AssistantContent;
  const outcome = content.outcome ?? null;
  const notice = outcome === "not_covered" || outcome === "off_topic" ? OUTCOME_NOTICE[outcome] : "";
  const blocks = (content.blocks ?? []).map((block) => blockView(block, content.interactions?.[block.id]));
  return {
    id: row.id, role: "assistant", status: row.status as TutorMessageView["status"], createdAt: row.createdAt.toISOString(),
    text: notice || (content.blocks ? answerText(content.blocks, content.interactions) : ""), positionMs: null, outcome, blocks, sources: content.sources ?? [],
    stale: Boolean(content.versionId && currentVersionId && content.versionId !== currentVersionId),
  };
}

export async function getTutorThread(userId: string, sessionId: string): Promise<TutorThreadView> {
  return withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    const thread = await activeThread(tx, userId, video, false);
    const rows = thread ? await tx.select().from(tutorMessages).where(eq(tutorMessages.threadId, thread.id)).orderBy(asc(tutorMessages.createdAt), asc(tutorMessages.id)) : [];
    const learner = readLearner(thread?.metadata);
    return {
      resourceId: video.resourceId,
      transcript: { status: video.transcript, source: video.versionSource },
      messages: rows.map((row) => messageView(row, video.versionId)),
      learner: { goal: learner.goal, concepts: learner.concepts.map(({ name, status }) => ({ name, status })), nextStep: learner.nextStep },
    };
  });
}

/** Ends the video's current conversation; the next question starts a fresh thread with a fresh learner record. */
export async function endTutorThread(userId: string, sessionId: string): Promise<void> {
  await withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    await tx.update(tutorThreads).set({ status: "ended", endedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tutorThreads.userId, userId), eq(tutorThreads.studySessionId, video.sessionId), eq(tutorThreads.resourceId, video.resourceId), eq(tutorThreads.status, "active")));
  });
}

export type AdmittedTurn =
  | { kind: "replay"; user: TutorMessageView; assistant: TutorMessageView }
  | {
    kind: "new";
    userId: string;
    video: VideoContext & { versionId: string };
    threadId: string;
    agentRunId: string;
    user: TutorMessageView;
    assistantId: string;
    question: string;
    positionMs: number;
    replyTo: string | null;
    history: HistoryTurn[];
    recentChunkIds: string[];
    learner: LearnerState;
    firstTurn: boolean;
  };

/**
 * Checks everything that must hold before money is spent: the session and video are the learner's, the transcript is
 * ready, the request is new, nothing else is generating and the budgets allow it. Then records the turn as pending.
 */
export async function admitTutorTurn(userId: string, sessionId: string, input: TutorTurnRequest): Promise<AdmittedTurn> {
  return withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    if (!video.versionId) throw new AuthError("TRANSCRIPT_NOT_READY", video.transcript === "preparing" ? "The transcript for this video is still being prepared." : "This video has no transcript, so the tutor can't answer questions about it.", 409, undefined, { transcript: video.transcript });
    const thread = await activeThread(tx, userId, video, true);
    if (!thread) throw new Error("Tutor thread was not created");
    const [repeat] = await tx.select().from(tutorMessages).where(and(eq(tutorMessages.threadId, thread.id), eq(tutorMessages.idempotencyKey, input.idempotencyKey))).limit(1);
    if (repeat) {
      const [answer] = await tx.select().from(tutorMessages).where(and(eq(tutorMessages.threadId, thread.id), eq(tutorMessages.sourceMessageId, repeat.id))).limit(1);
      if (answer) return { kind: "replay", user: messageView(repeat, video.versionId), assistant: messageView(answer, video.versionId) };
    }
    await admitTutorGeneration(tx, userId);
    const rows = await tx.select().from(tutorMessages).where(eq(tutorMessages.threadId, thread.id)).orderBy(desc(tutorMessages.createdAt)).limit(HISTORY_TURNS * 2);
    const completed = rows.filter((row) => row.status === "completed").reverse();
    let replyTo: string | null = null;
    if (input.replyTo) {
      const target = completed.find((row) => row.id === input.replyTo!.messageId && row.actorType === "assistant");
      const block = (target?.content as AssistantContent | undefined)?.blocks?.find((item) => item.id === input.replyTo!.blockId);
      if (!block || (block.type !== "question" && block.type !== "check")) throw new AuthError("INVALID_REPLY", "That question is no longer part of this conversation.", 422);
      replyTo = block.type === "question" ? block.prompt : block.question;
    }
    const history: HistoryTurn[] = completed.slice(-HISTORY_TURNS).map((row) => ({
      role: row.actorType === "user" ? "learner" : "tutor",
      text: row.actorType === "user" ? row.contentText ?? "" : messageView(row, video.versionId).text,
    }));
    // What the last answer cited, so a follow-up such as "quiz me on that" retrieves the same part of the video.
    const lastAnswer = completed.findLast((row) => row.actorType === "assistant")?.content as AssistantContent | undefined;
    const recentChunkIds = lastAnswer?.versionId === video.versionId ? (lastAnswer.sources ?? []).map((source) => source.chunkId) : [];
    const [run] = await tx.insert(agentRuns).values({
      userId, studySessionId: video.sessionId, tutorThreadId: thread.id, purpose: PURPOSE, status: "executing", goal: "Answer a learner's question from the video transcript",
      policyVersion: TUTOR_CONTRACT_VERSION, maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.maxOutputTokens, correlationId: randomUUID(), startedAt: new Date(),
    }).returning({ id: agentRuns.id });
    const userContent: UserContent = { positionMs: input.positionMs, ...(input.replyTo ? { replyTo: input.replyTo } : {}) };
    const [userRow] = await tx.insert(tutorMessages).values({ threadId: thread.id, actorType: "user", idempotencyKey: input.idempotencyKey, contentText: input.question, content: userContent, createdAt: sql`clock_timestamp()` }).returning();
    const [assistantRow] = await tx.insert(tutorMessages).values({ threadId: thread.id, actorType: "assistant", status: "pending", agentRunId: run!.id, sourceMessageId: userRow!.id, content: { contract: TUTOR_CONTRACT_VERSION, versionId: video.versionId }, createdAt: sql`clock_timestamp()` }).returning();
    await tx.update(tutorThreads).set({ updatedAt: new Date() }).where(eq(tutorThreads.id, thread.id));
    await recordStudyQuestion(tx, { userId, sessionId: video.sessionId, resourceId: video.resourceId, resourceVersionId: video.versionId, question: input.question, positionMs: input.positionMs, idempotencyKey: input.idempotencyKey });
    return {
      kind: "new", userId, video: { ...video, versionId: video.versionId }, threadId: thread.id, agentRunId: run!.id, user: messageView(userRow!, video.versionId), assistantId: assistantRow!.id,
      question: input.question, positionMs: input.positionMs, replyTo, history, recentChunkIds, learner: readLearner(thread.metadata), firstTurn: completed.length === 0,
    };
  });
}

type Finish = {
  answer: GroundedAnswer;
  learner?: TutorModelOutput["learner"] | undefined;
  retrievalRunId?: string;
  usage?: TutorUsage;
  firstOutputMs?: number | null;
  latencyMs?: number;
  cache: "miss" | "exact" | "semantic" | "bypass";
};

async function finishTurn(turn: Extract<AdmittedTurn, { kind: "new" }>, finish: Finish, inputSha: string | null, outputSha: string | null): Promise<TutorMessageView> {
  return withUserTransaction(turn.userId, async (tx) => {
    const { answer } = finish;
    const content: AssistantContent = { contract: TUTOR_CONTRACT_VERSION, outcome: answer.outcome, blocks: answer.blocks, sources: answer.sources, versionId: turn.video.versionId, interactions: {}, ...(finish.retrievalRunId ? { retrievalRunId: finish.retrievalRunId } : {}), ...(finish.cache === "exact" || finish.cache === "semantic" ? { cache: finish.cache } : {}) };
    const [row] = await tx.update(tutorMessages).set({ status: "completed", content, contentText: answerText(answer.blocks) || null })
      .where(and(eq(tutorMessages.id, turn.assistantId), eq(tutorMessages.status, "pending"))).returning();
    if (!row) throw new AuthError("TUTOR_TURN_CLOSED", "That answer was already closed.", 409);
    if (finish.retrievalRunId && answer.sources.length) {
      await tx.insert(citations).values(answer.sources.map((source, ordinal) => ({
        retrievalRunId: finish.retrievalRunId!, chunkId: source.chunkId, resourceVersionId: turn.video.versionId, agentRunId: turn.agentRunId, messageId: row.id, ordinal,
        anchorSnapshot: { kind: "video", startMs: source.startMs, endMs: source.endMs }, quoteSha256: createHash("sha256").update(source.excerpt).digest("hex"),
      })));
    }
    const costUsd = finish.usage ? estimateCostUsd(finish.usage) : 0;
    if (finish.usage || finish.cache !== "bypass") await recordInvocation(tx, turn, finish.usage ?? null, costUsd, finish.cache, answer.outcome, finish.firstOutputMs ?? null, finish.latencyMs ?? null, inputSha, outputSha);
    await recordGlobalSpend(tx, costUsd);
    await tx.update(agentRuns).set({ status: "done", completedAt: new Date(), failureCode: answer.outcome === "answer" ? null : answer.outcome, finalAnswer: answer.outcome })
      .where(eq(agentRuns.id, turn.agentRunId));
    if (finish.learner) {
      await tx.execute(sql`SELECT id FROM study.tutor_threads WHERE id = ${turn.threadId} FOR UPDATE`);
      const [thread] = await tx.select({ metadata: tutorThreads.metadata }).from(tutorThreads).where(eq(tutorThreads.id, turn.threadId)).limit(1);
      const learner = mergeLearner(readLearner(thread?.metadata), finish.learner, answer.blocks, row.id);
      await tx.update(tutorThreads).set({ metadata: { ...(thread?.metadata ?? {}), learner }, updatedAt: new Date() }).where(eq(tutorThreads.id, turn.threadId));
    }
    return messageView(row, turn.video.versionId);
  });
}

async function recordInvocation(tx: Transaction, turn: Extract<AdmittedTurn, { kind: "new" }>, usage: TutorUsage | null, costUsd: number, cache: string, safety: string, firstOutputMs: number | null, latencyMs: number | null, inputSha: string | null, outputSha: string | null) {
  await tx.insert(modelInvocations).values({
    agentRunId: turn.agentRunId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${PURPOSE}:${TUTOR_MODEL.effort}`, promptTemplateId: "tutor", promptTemplateVer: TUTOR_CONTRACT_VERSION,
    inputSha256: inputSha, outputSha256: outputSha, inputTokens: usage?.inputTokens ?? null, cachedTokens: usage?.cachedTokens ?? null, outputTokens: usage?.outputTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null, firstOutputMs, latencyMs, estimatedCostUsd: costUsd.toFixed(8), cacheStatus: cache, safetyStatus: safety, completedAt: new Date(),
  });
}

async function failTurn(turn: Extract<AdmittedTurn, { kind: "new" }>, code: string, usage: TutorUsage | null): Promise<void> {
  const cancelled = code === "cancelled";
  await withUserTransaction(turn.userId, async (tx) => {
    await tx.update(tutorMessages).set({ status: cancelled ? "cancelled" : "failed", content: { contract: TUTOR_CONTRACT_VERSION, versionId: turn.video.versionId, failure: code } })
      .where(and(eq(tutorMessages.id, turn.assistantId), eq(tutorMessages.status, "pending")));
    // A failed call that still produced tokens was billed, so it counts against the budgets like any other.
    const costUsd = usage ? estimateCostUsd(usage) : 0;
    if (usage) await recordInvocation(tx, turn, usage, costUsd, "miss", code, null, null, null, null);
    await recordGlobalSpend(tx, costUsd);
    await tx.update(agentRuns).set({ status: cancelled ? "cancelled" : "failed", completedAt: new Date(), failureCode: code.slice(0, 120) }).where(eq(agentRuns.id, turn.agentRunId));
  });
}

const FAILURE_MESSAGES: Record<string, string> = {
  cancelled: "Stopped.",
  provider_timeout: "The tutor took too long to answer. Try again, or ask a narrower question.",
  provider_http_429: "The tutor is busy right now. Try again in a minute.",
  provider_not_configured: "The tutor isn't configured on this server.",
};

/** Runs an admitted turn: retrieve, reuse a cached answer or ask the model, validate the grounding, and store the answer. */
export async function runTutorTurn(turn: Extract<AdmittedTurn, { kind: "new" }>, options: { signal: AbortSignal; emit: (event: TutorStreamEvent) => void; model?: TutorModel; embed?: (text: string, signal?: AbortSignal) => Promise<number[] | null> }): Promise<TutorMessageView | null> {
  const model = options.model ?? openAiTutorModel;
  const embed = options.embed ?? embedText;
  let usage: TutorUsage | null = null;
  try {
    const scope: TutorScope = resolveScope(turn.question, turn.positionMs, turn.video.durationMs);
    if (scope.kind === "out_of_range") {
      const text = `This video is ${turn.video.durationMs ? formatClock(turn.video.durationMs) : "shorter than that"} long, so there's nothing at ${formatClock(scope.requestedMs)}. Which moment did you mean?`;
      return await finishTurn(turn, { answer: { outcome: "clarify", blocks: [{ type: "text", id: "b0", text, src: [] }], sources: [] }, cache: "bypass" }, null, null);
    }
    options.emit({ type: "phase", phase: "retrieving" });
    const terms = questionTerms(turn.replyTo ? `${turn.replyTo} ${turn.question}` : turn.question);
    const vector = await embed(turn.replyTo ? `${turn.replyTo}\n${turn.question}` : turn.question, options.signal);
    const eligible = cacheEligible({ firstTurn: turn.firstTurn, replying: Boolean(turn.replyTo), publicSource: turn.video.publicSource, question: turn.question, scopeKind: scope.kind });
    const { retrieval, cached } = await withUserTransaction(turn.userId, async (tx) => ({
      retrieval: await retrieveEvidence(tx, { userId: turn.userId, sessionId: turn.video.sessionId, agentRunId: turn.agentRunId, versionId: turn.video.versionId, question: turn.question, tsquery: lexicalQuery(terms), scope, vector, recentChunkIds: turn.recentChunkIds }),
      cached: eligible ? await findCachedAnswer(tx, turn.video.versionId, scope.key, turn.question, vector) : null,
    }));
    if (cached) {
      // A hit is only used when every chunk it cites was retrieved for this request, so citations stay auditable.
      const retrieved = new Set(retrieval.evidence.map((item) => item.chunkId));
      if (cached.sources.every((source) => retrieved.has(source.chunkId))) {
        return await finishTurn(turn, { answer: cached, learner: cached.learner, retrievalRunId: retrieval.runId, cache: cached.match }, null, null);
      }
    }
    if (retrieval.evidence.length === 0) {
      return await finishTurn(turn, { answer: { outcome: "not_covered", blocks: [], sources: [] }, retrievalRunId: retrieval.runId, cache: "bypass" }, null, null);
    }
    const prompt = buildTutorPrompt({
      title: turn.video.title, durationMs: turn.video.durationMs, positionMs: turn.positionMs, scope, timed: retrieval.timed, coverage: retrieval.coverage, evidence: retrieval.evidence,
      learner: turn.learner, history: turn.history, question: turn.question, move: suggestMove(turn.learner, turn.firstTurn, Boolean(turn.replyTo)), replyTo: turn.replyTo,
    });
    options.emit({ type: "phase", phase: "thinking" });
    const result = await model({ instructions: TUTOR_INSTRUCTIONS, developer: prompt.developer, user: prompt.user, schema: tutorOutputJsonSchema(), cacheKey: `learnspace-${TUTOR_CONTRACT_VERSION}` }, {
      signal: options.signal,
      onFirstOutput: () => options.emit({ type: "phase", phase: "writing" }),
    });
    usage = result.usage;
    const inputSha = createHash("sha256").update(prompt.developer + prompt.user).digest("hex");
    const outputSha = createHash("sha256").update(result.text).digest("hex");
    const output = result.refusal ? null : parseOutput(result.text);
    const answer = output ? groundOutput(output, retrieval.evidence, terms) : { outcome: "off_topic" as const, blocks: [], sources: [] };
    if (!output && !result.refusal) throw new TutorModelError("invalid_output", usage);
    const message = await finishTurn(turn, { answer, learner: output?.learner, retrievalRunId: retrieval.runId, usage, firstOutputMs: result.firstOutputMs, latencyMs: result.latencyMs, cache: eligible ? "miss" : "bypass" }, inputSha, outputSha);
    if (eligible && output && answer.outcome === "answer") {
      await withUserTransaction(turn.userId, (tx) => storeCachedAnswer(tx, turn.video.versionId, scope.key, turn.question, vector, answer, output.learner)).catch(() => undefined);
    }
    return message;
  } catch (error) {
    const code = error instanceof TutorModelError ? error.code : options.signal.aborted ? "cancelled" : "internal_error";
    usage = error instanceof TutorModelError && error.usage ? error.usage : usage;
    if (!(error instanceof TutorModelError)) console.error(JSON.stringify({ metric: "tutor_turn_failure", agentRunId: turn.agentRunId, error: error instanceof Error ? error.message : "unknown" }));
    await failTurn(turn, code, usage).catch(() => undefined);
    options.emit({ type: "error", code, message: FAILURE_MESSAGES[code] ?? (code.startsWith("provider_") ? "The tutor couldn't answer right now. Try again in a moment." : "Something went wrong while answering. Try again.") });
    return null;
  }
}

function parseOutput(text: string): TutorModelOutput | null {
  try {
    const parsed = tutorModelOutputSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Grades a check or reveals a hint. Answers are graded here, from the stored key, never by the browser or the model. */
export async function tutorInteraction(userId: string, sessionId: string, input: TutorInteractionRequest): Promise<TutorMessageView> {
  return withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    await tx.execute(sql`SELECT m.id FROM study.tutor_messages m JOIN study.tutor_threads t ON t.id = m.thread_id WHERE m.id = ${input.messageId} AND t.user_id = ${userId} FOR UPDATE OF m, t`);
    const [row] = await tx.select({ message: tutorMessages, thread: tutorThreads }).from(tutorMessages).innerJoin(tutorThreads, eq(tutorThreads.id, tutorMessages.threadId))
      .where(and(eq(tutorMessages.id, input.messageId), eq(tutorThreads.userId, userId), eq(tutorThreads.studySessionId, video.sessionId), eq(tutorThreads.resourceId, video.resourceId), eq(tutorMessages.actorType, "assistant"), eq(tutorMessages.status, "completed")))
      .limit(1);
    if (!row) throw new AuthError("TUTOR_MESSAGE_NOT_FOUND", "That answer is not part of this lesson's conversation.", 404);
    const content = row.message.content as AssistantContent;
    const block = content.blocks?.find((item) => item.id === input.blockId);
    if (!block || (block.type !== "check" && block.type !== "question") || (input.action === "answer" && block.type !== "check")) throw new AuthError("INVALID_TUTOR_ACTION", "That action isn't available on this answer.", 422);
    const interactions = { ...(content.interactions ?? {}) };
    const previous = interactions[block.id] ?? {};
    let learner = readLearner(row.thread.metadata);
    if (input.action === "answer" && block.type === "check") {
      if (previous.choice !== undefined) return messageView(row.message, video.versionId);
      if (input.choice >= block.options.length) throw new AuthError("INVALID_TUTOR_ACTION", "That option isn't part of this check.", 422);
      const correct = input.choice === block.answer;
      interactions[block.id] = { ...previous, choice: input.choice, correct };
      learner = recordCheck(learner, block.concept || block.question.slice(0, 60), correct, row.message.id);
    } else if (input.action === "hint") {
      if (previous.hint) return messageView(row.message, video.versionId);
      interactions[block.id] = { ...previous, hint: true };
      learner = { ...learner, hintsGiven: learner.hintsGiven + 1 };
    }
    const [updated] = await tx.update(tutorMessages).set({ content: { ...content, interactions } }).where(eq(tutorMessages.id, row.message.id)).returning();
    await tx.update(tutorThreads).set({ metadata: { ...row.thread.metadata, learner }, updatedAt: new Date() }).where(eq(tutorThreads.id, row.thread.id));
    return messageView(updated!, video.versionId);
  });
}


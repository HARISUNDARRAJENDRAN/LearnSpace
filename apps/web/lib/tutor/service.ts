import { createHash, randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, citations, modelInvocations, resources, resourceVersions, studySessions, transcriptRequests, tutorMessages, tutorThreads, videoDetails } from "@learnspace/db/schema";
import {
  TUTOR_CONTRACT_VERSION, tutorModelOutputSchema, tutorOutputJsonSchema,
  type TutorDoubt, type TutorInteractionRequest, type TutorMessageView, type TutorModelBlock, type TutorModelOutput, type TutorOutcome, type TutorStreamEvent, type TutorThreadView, type TutorTranscriptStatus, type TutorTurnRequest,
} from "@learnspace/shared/tutor";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { Allow, parse } from "partial-json";
import { embedText } from "../ai/openai";
import { estimateCostUsd, openAiTutorModel, TUTOR_MODEL, type TutorDepth, type TutorModel, type TutorModelResult, TutorModelError, type TutorUsage } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { recordStudyQuestion } from "../study/service";
import { cacheEligible, findCachedAnswer, storeCachedAnswer } from "./cache";
import { answerText, blockView, type Evidence, type GroundedAnswer, groundOutput, type Interaction, type LearnerState, mergeLearner, OUTCOME_NOTICE, type ReplyContext, readLearner, recordCheck, type StoredBlock, suggestMove } from "./grounding";
import { admitTutorGeneration, recordGlobalSpend } from "./limits";
import { buildTutorPrompt, type HistoryTurn, TUTOR_INSTRUCTIONS } from "./prompt";
import { retrieveEvidence } from "./retrieval";
import { formatClock, lexicalQuery, questionTerms, resolveScope, type TutorScope } from "./scope";

const PURPOSE = "video_tutor";
const HISTORY_TURNS = 8;
const PAST_THREADS = 30;
const DRAFT_EVERY_MS = 50;
// The quick answer's first field: whether the model wants to reason before answering.
const NEEDS_REASONING = /^\s*\{\s*"needsReasoning"\s*:\s*(true|false)/;
const DOUBT_MOVE = "Resolve the learner's doubt about the highlighted words: answer just that, briefly (one or two blocks), from the evidence. No check or question blocks. Record the concept behind it as struggling.";
const THINKING_NOTE = "You now have time to reason. Set needsReasoning to false and give your full answer.";
const modelBlockSchema = tutorModelOutputSchema.shape.blocks.element;

/** What a stored assistant message holds; the browser only ever sees `messageView` of it. */
type AssistantContent = {
  contract?: string;
  outcome?: TutorOutcome;
  blocks?: StoredBlock[];
  sources?: GroundedAnswer["sources"];
  followUps?: string[];
  versionId?: string;
  retrievalRunId?: string;
  interactions?: Record<string, Interaction>;
  failure?: string;
  cache?: "exact" | "semantic";
  doubt?: TutorDoubt;
};
type UserContent = { positionMs?: number; replyTo?: { messageId: string; blockId: string }; doubt?: TutorDoubt };
const doubtOf = (row: MessageRow) => (row.content as { doubt?: TutorDoubt }).doubt;
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
export async function videoContext(tx: Transaction, userId: string, sessionId: string): Promise<VideoContext> {
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
    return { id: row.id, role: "user", status: "completed", createdAt: row.createdAt.toISOString(), text: row.contentText ?? "", positionMs: content.positionMs ?? null, outcome: null, blocks: [], sources: [], followUps: [], stale: false, doubt: content.doubt ?? null };
  }
  const content = row.content as AssistantContent;
  const outcome = content.outcome ?? null;
  const notice = outcome === "not_covered" || outcome === "off_topic" ? OUTCOME_NOTICE[outcome] : "";
  const blocks = (content.blocks ?? []).map((block) => blockView(block, content.interactions?.[block.id]));
  return {
    id: row.id, role: "assistant", status: row.status as TutorMessageView["status"], createdAt: row.createdAt.toISOString(),
    text: notice || (content.blocks ? answerText(content.blocks, content.interactions) : ""), positionMs: null, outcome, blocks, sources: content.sources ?? [], followUps: content.followUps ?? [],
    stale: Boolean(content.versionId && currentVersionId && content.versionId !== currentVersionId),
    doubt: content.doubt ?? null,
  };
}

export async function getTutorThread(userId: string, sessionId: string): Promise<TutorThreadView> {
  return withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    const thread = await activeThread(tx, userId, video, false);
    const rows = thread ? await tx.select().from(tutorMessages).where(eq(tutorMessages.threadId, thread.id)).orderBy(asc(tutorMessages.createdAt), asc(tutorMessages.id)) : [];
    const learner = readLearner(thread?.metadata);
    const firstQuestion = sql<string | null>`(SELECT m.content_text FROM study.tutor_messages m WHERE m.thread_id = study.tutor_threads.id AND m.actor_type = 'user' ORDER BY m.created_at, m.id LIMIT 1)`;
    const firstAnswer = sql<string | null>`(SELECT left(m.content_text, 200) FROM study.tutor_messages m WHERE m.thread_id = study.tutor_threads.id AND m.actor_type = 'assistant' AND m.status = 'completed' ORDER BY m.created_at, m.id LIMIT 1)`;
    const past = await tx.select({ id: tutorThreads.id, title: firstQuestion, preview: firstAnswer, updatedAt: tutorThreads.updatedAt }).from(tutorThreads)
      .where(and(eq(tutorThreads.userId, userId), eq(tutorThreads.studySessionId, video.sessionId), eq(tutorThreads.resourceId, video.resourceId), eq(tutorThreads.status, "ended"), sql`${firstQuestion} IS NOT NULL`))
      .orderBy(desc(tutorThreads.updatedAt)).limit(PAST_THREADS);
    return {
      resourceId: video.resourceId,
      transcript: { status: video.transcript, source: video.versionSource },
      messages: rows.map((row) => messageView(row, video.versionId)),
      learner: { goal: learner.goal, concepts: learner.concepts.map(({ name, status }) => ({ name, status })), nextStep: learner.nextStep },
      history: past.map((row) => ({ id: row.id, title: row.title ?? "", preview: row.preview, updatedAt: row.updatedAt.toISOString() })),
      resolvedDoubts: resolvedDoubts(thread?.metadata),
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

/** Makes an earlier conversation about this video the current one again; the current one moves to history. */
export async function restoreTutorThread(userId: string, sessionId: string, threadId: string): Promise<void> {
  await withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    const scope = and(eq(tutorThreads.userId, userId), eq(tutorThreads.studySessionId, video.sessionId), eq(tutorThreads.resourceId, video.resourceId));
    const [target] = await tx.select({ status: tutorThreads.status }).from(tutorThreads).where(and(scope, eq(tutorThreads.id, threadId))).limit(1);
    if (!target) throw new AuthError("TUTOR_THREAD_NOT_FOUND", "That conversation isn't available.", 404);
    if (target.status === "active") return;
    // Only one thread per video may be active, so the current one ends first.
    await tx.update(tutorThreads).set({ status: "ended", endedAt: new Date(), updatedAt: new Date() }).where(and(scope, eq(tutorThreads.status, "active")));
    await tx.update(tutorThreads).set({ status: "active", endedAt: null, updatedAt: new Date() }).where(and(scope, eq(tutorThreads.id, threadId)));
  });
}

const resolvedDoubts = (metadata: Record<string, unknown> | undefined) => Array.isArray(metadata?.resolvedDoubts) ? metadata.resolvedDoubts.filter((id): id is string => typeof id === "string") : [];

/** "Got it" on a doubt in the current conversation, or opening it again. */
export async function resolveTutorDoubt(userId: string, sessionId: string, doubtId: string, resolved: boolean): Promise<void> {
  await withUserTransaction(userId, async (tx) => {
    const video = await videoContext(tx, userId, sessionId);
    const thread = await activeThread(tx, userId, video, false);
    const [asked] = thread ? await tx.select({ id: tutorMessages.id }).from(tutorMessages).where(and(eq(tutorMessages.threadId, thread.id), sql`${tutorMessages.content}->'doubt'->>'id' = ${doubtId}`)).limit(1) : [];
    if (!thread || !asked) throw new AuthError("TUTOR_DOUBT_NOT_FOUND", "That doubt isn't part of this conversation.", 404);
    await tx.execute(sql`SELECT id FROM study.tutor_threads WHERE id = ${thread.id} FOR UPDATE`);
    const [current] = await tx.select({ metadata: tutorThreads.metadata }).from(tutorThreads).where(eq(tutorThreads.id, thread.id)).limit(1);
    const others = resolvedDoubts(current?.metadata).filter((id) => id !== doubtId);
    await tx.update(tutorThreads).set({ metadata: { ...(current?.metadata ?? {}), resolvedDoubts: resolved ? [...others, doubtId] : others } }).where(eq(tutorThreads.id, thread.id));
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
    replyTo: ReplyContext | null;
    /** The highlighted words and the text of the block they are in. */
    doubt: { anchor: TutorDoubt; passage: string } | null;
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
    const completed = (await tx.select().from(tutorMessages).where(eq(tutorMessages.threadId, thread.id)).orderBy(asc(tutorMessages.createdAt), asc(tutorMessages.id)))
      .filter((row) => row.status === "completed");
    // Doubt threads stay out of the main conversation, so a side question never steers the lesson.
    const main = completed.filter((row) => !doubtOf(row));
    const turnOf = (row: MessageRow): HistoryTurn => ({ role: row.actorType === "user" ? "learner" : "tutor", text: row.actorType === "user" ? row.contentText ?? "" : messageView(row, video.versionId).text });
    let replyTo: ReplyContext | null = null;
    if (input.replyTo) {
      const target = main.find((row) => row.id === input.replyTo!.messageId && row.actorType === "assistant")?.content as AssistantContent | undefined;
      const block = target?.blocks?.find((item) => item.id === input.replyTo!.blockId);
      if (!block || (block.type !== "question" && block.type !== "check")) throw new AuthError("INVALID_REPLY", "That question is no longer part of this conversation.", 422);
      const choice = target?.interactions?.[block.id]?.choice;
      replyTo = block.type === "question" ? { prompt: block.prompt, graded: null }
        : { prompt: block.question, graded: choice === undefined ? null : { chose: block.options[choice] ?? "", correct: choice === block.answer } };
    }
    let doubt: { anchor: TutorDoubt; passage: string } | null = null;
    let history = main.slice(-HISTORY_TURNS).map(turnOf);
    let cited = main.findLast((row) => row.actorType === "assistant");
    if (input.doubt) {
      const { id, messageId, blockId } = input.doubt;
      const anchor = completed.find((row) => row.id === messageId && row.actorType === "assistant");
      const block = (anchor?.content as AssistantContent | undefined)?.blocks?.find((item) => item.id === blockId);
      const earlier = completed.filter((row) => doubtOf(row)?.id === id);
      if (!anchor || !block || earlier.some((row) => doubtOf(row)?.messageId !== messageId || doubtOf(row)?.blockId !== blockId)) throw new AuthError("INVALID_DOUBT", "That passage is no longer part of this conversation.", 422);
      // A doubt sees the answer it was raised on (and the question behind it), then its own thread so far.
      const asked = completed.find((row) => row.id === anchor.sourceMessageId);
      history = [...(asked ? [asked] : []), anchor, ...earlier].slice(-HISTORY_TURNS).map(turnOf);
      doubt = { anchor: input.doubt, passage: answerText([block]) };
      cited = anchor;
    }
    // What the last answer (or the doubted one) cited, so "quiz me on that" or a doubt retrieves the same part of the video.
    const lastAnswer = cited?.content as AssistantContent | undefined;
    const recentChunkIds = lastAnswer?.versionId === video.versionId ? (lastAnswer.sources ?? []).map((source) => source.chunkId) : [];
    const [run] = await tx.insert(agentRuns).values({
      userId, studySessionId: video.sessionId, tutorThreadId: thread.id, purpose: PURPOSE, status: "executing", goal: "Answer a learner's question from the video transcript",
      policyVersion: TUTOR_CONTRACT_VERSION, maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.depths.deep.maxOutputTokens, correlationId: randomUUID(), startedAt: new Date(),
    }).returning({ id: agentRuns.id });
    const userContent: UserContent = { positionMs: input.positionMs, ...(input.replyTo ? { replyTo: input.replyTo } : {}), ...(input.doubt ? { doubt: input.doubt } : {}) };
    const [userRow] = await tx.insert(tutorMessages).values({ threadId: thread.id, actorType: "user", idempotencyKey: input.idempotencyKey, contentText: input.question, content: userContent, createdAt: sql`clock_timestamp()` }).returning();
    const [assistantRow] = await tx.insert(tutorMessages).values({ threadId: thread.id, actorType: "assistant", status: "pending", agentRunId: run!.id, sourceMessageId: userRow!.id, content: { contract: TUTOR_CONTRACT_VERSION, versionId: video.versionId, ...(input.doubt ? { doubt: input.doubt } : {}) }, createdAt: sql`clock_timestamp()` }).returning();
    await tx.update(tutorThreads).set({ updatedAt: new Date() }).where(eq(tutorThreads.id, thread.id));
    await recordStudyQuestion(tx, { userId, sessionId: video.sessionId, resourceId: video.resourceId, resourceVersionId: video.versionId, question: input.question, positionMs: input.positionMs, idempotencyKey: input.idempotencyKey });
    return {
      kind: "new", userId, video: { ...video, versionId: video.versionId }, threadId: thread.id, agentRunId: run!.id, user: messageView(userRow!, video.versionId), assistantId: assistantRow!.id,
      question: input.question, positionMs: input.positionMs, replyTo, doubt, history, recentChunkIds, learner: readLearner(thread.metadata), firstTurn: main.length === 0,
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
  depth?: TutorDepth;
  cache: "miss" | "exact" | "semantic" | "bypass";
};

async function finishTurn(turn: Extract<AdmittedTurn, { kind: "new" }>, finish: Finish, inputSha: string | null, outputSha: string | null): Promise<TutorMessageView> {
  return withUserTransaction(turn.userId, async (tx) => {
    const { answer } = finish;
    const content: AssistantContent = { ...(turn.doubt ? { doubt: turn.doubt.anchor } : {}), contract: TUTOR_CONTRACT_VERSION, outcome: answer.outcome, blocks: answer.blocks, sources: answer.sources, followUps: answer.followUps ?? [], versionId: turn.video.versionId, interactions: {}, ...(finish.retrievalRunId ? { retrievalRunId: finish.retrievalRunId } : {}), ...(finish.cache === "exact" || finish.cache === "semantic" ? { cache: finish.cache } : {}) };
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
    if (finish.usage || finish.cache !== "bypass") await recordInvocation(tx, turn, finish.depth ?? "quick", finish.usage ?? null, costUsd, finish.cache, answer.outcome, finish.firstOutputMs ?? null, finish.latencyMs ?? null, inputSha, outputSha);
    await recordGlobalSpend(tx, costUsd);
    await tx.update(agentRuns).set({ status: "done", completedAt: new Date(), failureCode: answer.outcome === "answer" || answer.outcome === "general" ? null : answer.outcome, finalAnswer: answer.outcome })
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

async function recordInvocation(tx: Transaction, turn: Extract<AdmittedTurn, { kind: "new" }>, depth: TutorDepth, usage: TutorUsage | null, costUsd: number, cache: string, safety: string, firstOutputMs: number | null, latencyMs: number | null, inputSha: string | null, outputSha: string | null) {
  await tx.insert(modelInvocations).values({
    agentRunId: turn.agentRunId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${PURPOSE}:${TUTOR_MODEL.depths[depth].effort}`, promptTemplateId: "tutor", promptTemplateVer: TUTOR_CONTRACT_VERSION,
    inputSha256: inputSha, outputSha256: outputSha, inputTokens: usage?.inputTokens ?? null, cachedTokens: usage?.cachedTokens ?? null, outputTokens: usage?.outputTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null, firstOutputMs, latencyMs, estimatedCostUsd: costUsd.toFixed(8), cacheStatus: cache, safetyStatus: safety, completedAt: new Date(),
  });
}

async function failTurn(turn: Extract<AdmittedTurn, { kind: "new" }>, code: string, usage: TutorUsage | null, depth: TutorDepth): Promise<void> {
  const cancelled = code === "cancelled";
  await withUserTransaction(turn.userId, async (tx) => {
    await tx.update(tutorMessages).set({ status: cancelled ? "cancelled" : "failed", content: { contract: TUTOR_CONTRACT_VERSION, versionId: turn.video.versionId, failure: code, ...(turn.doubt ? { doubt: turn.doubt.anchor } : {}) } })
      .where(and(eq(tutorMessages.id, turn.assistantId), eq(tutorMessages.status, "pending")));
    // A failed call that still produced tokens was billed, so it counts against the budgets like any other.
    const costUsd = usage ? estimateCostUsd(usage) : 0;
    if (usage) await recordInvocation(tx, turn, depth, usage, costUsd, "miss", code, null, null, null, null);
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
  let depth: TutorDepth = "quick";
  try {
    const scope: TutorScope = resolveScope(turn.question, turn.positionMs, turn.video.durationMs);
    if (scope.kind === "out_of_range") {
      const text = `This video is ${turn.video.durationMs ? formatClock(turn.video.durationMs) : "shorter than that"} long, so there's nothing at ${formatClock(scope.requestedMs)}. Which moment did you mean?`;
      return await finishTurn(turn, { answer: { outcome: "clarify", blocks: [{ type: "text", id: "b0", text, src: [] }], sources: [] }, cache: "bypass" }, null, null);
    }
    options.emit({ type: "phase", phase: "retrieving" });
    // A reply is read with the question it answers, and a doubt with the words it is about.
    const context = turn.replyTo?.prompt ?? turn.doubt?.anchor.quote ?? null;
    const terms = questionTerms(context ? `${context} ${turn.question}` : turn.question);
    const vector = await embed(context ? `${context}\n${turn.question}` : turn.question, options.signal);
    const eligible = cacheEligible({ firstTurn: turn.firstTurn, replying: Boolean(context), publicSource: turn.video.publicSource, question: turn.question, scopeKind: scope.kind });
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
    const prompt = buildTutorPrompt({
      title: turn.video.title, durationMs: turn.video.durationMs, positionMs: turn.positionMs, scope, timed: retrieval.timed, coverage: retrieval.coverage, evidence: retrieval.evidence,
      learner: turn.learner, history: turn.history, question: turn.question, move: turn.doubt ? DOUBT_MOVE : suggestMove(turn.learner, turn.firstTurn, turn.replyTo), replyTo: turn.replyTo, doubt: turn.doubt ? { quote: turn.doubt.anchor.quote, passage: turn.doubt.passage } : null,
    });
    options.emit({ type: "phase", phase: "thinking" });
    const request = { instructions: TUTOR_INSTRUCTIONS, user: prompt.user, cacheKey: `learnspace-${TUTOR_CONTRACT_VERSION}` };
    // The model answers without reasoning unless its first field asks for it; then that answer is dropped and asked again.
    const quick = new AbortController();
    let decided: boolean | null = null;
    const quickDraft = drafter(turn.assistantId, turn.doubt?.anchor ?? null, retrieval.evidence, terms, options.emit);
    // shortcut: the dropped quick call's few tokens aren't counted in spend (it ends without usage), count them if the provider reports usage on abort.
    let result: TutorModelResult | null = await model({ ...request, depth, schema: tutorOutputJsonSchema(), developer: prompt.developer }, {
      signal: AbortSignal.any([options.signal, quick.signal]),
      onText: (text) => {
        if (decided === null) {
          const match = NEEDS_REASONING.exec(text);
          if (!match) return;
          decided = match[1] === "true";
          if (decided) quick.abort();
          else options.emit({ type: "phase", phase: "writing" });
        }
        if (!decided) quickDraft(text);
      },
    }).catch((error: unknown) => {
      if (decided && !options.signal.aborted) return null;
      throw error;
    });
    if (!result || NEEDS_REASONING.exec(result.text)?.[1] === "true") {
      depth = "deep";
      options.emit({ type: "phase", phase: "reasoning" });
      result = await model({ ...request, depth, schema: tutorOutputJsonSchema(true), developer: `${prompt.developer}\n\n${THINKING_NOTE}` }, {
        signal: options.signal,
        onFirstOutput: () => options.emit({ type: "phase", phase: "writing" }),
        onText: drafter(turn.assistantId, turn.doubt?.anchor ?? null, retrieval.evidence, terms, options.emit),
      });
    }
    usage = result.usage;
    const inputSha = createHash("sha256").update(prompt.developer + prompt.user).digest("hex");
    const outputSha = createHash("sha256").update(result.text).digest("hex");
    const output = result.refusal ? null : parseOutput(result.text);
    const answer = output ? groundOutput(output, retrieval.evidence, terms) : { outcome: "off_topic" as const, blocks: [], sources: [] };
    if (!output && !result.refusal) throw new TutorModelError("invalid_output", usage);
    const message = await finishTurn(turn, { answer, learner: output?.learner, retrievalRunId: retrieval.runId, usage, firstOutputMs: result.firstOutputMs, latencyMs: result.latencyMs, depth, cache: eligible ? "miss" : "bypass" }, inputSha, outputSha);
    if (eligible && output && answer.outcome === "answer") {
      await withUserTransaction(turn.userId, (tx) => storeCachedAnswer(tx, turn.video.versionId, scope.key, turn.question, vector, answer, output.learner)).catch(() => undefined);
    }
    return message;
  } catch (error) {
    const code = error instanceof TutorModelError ? error.code : options.signal.aborted ? "cancelled" : "internal_error";
    usage = error instanceof TutorModelError && error.usage ? error.usage : usage;
    if (!(error instanceof TutorModelError)) console.error(JSON.stringify({ metric: "tutor_turn_failure", agentRunId: turn.agentRunId, error: error instanceof Error ? error.message : "unknown" }));
    await failTurn(turn, code, usage, depth).catch(() => undefined);
    options.emit({ type: "error", code, message: FAILURE_MESSAGES[code] ?? (code.startsWith("provider_") ? "The tutor couldn't answer right now. Try again in a moment." : "Something went wrong while answering. Try again.") });
    return null;
  }
}

/**
 * Turns the model's text so far into drafts of the answer. A block shows once it is valid, which with citations written
 * first means its grounding is settled before its words appear; a block that is mid-way through keeps its last valid form.
 */
function drafter(assistantId: string, doubt: TutorDoubt | null, evidence: Evidence[], terms: string[], emit: (event: TutorStreamEvent) => void) {
  const blocks: TutorModelBlock[] = [];
  let last = 0;
  let sent = "";
  return (text: string) => {
    const now = performance.now();
    if (now - last < DRAFT_EVERY_MS) return;
    last = now;
    let partial: { outcome?: unknown; blocks?: unknown };
    try {
      // A number cut off mid-way ("[1" of "[12]") is left out rather than read as a different citation.
      partial = parse(text, Allow.ALL & ~Allow.NUM) as typeof partial;
    } catch {
      return;
    }
    if ((partial.outcome !== "answer" && partial.outcome !== "general") || !Array.isArray(partial.blocks)) return;
    partial.blocks.forEach((block, index) => {
      const valid = modelBlockSchema.safeParse(block);
      if (valid.success) blocks[index] = valid.data;
    });
    const grounded = groundOutput({ outcome: partial.outcome, blocks: blocks.filter(Boolean), followUps: [] }, evidence, terms);
    if (grounded.blocks.length === 0) return;
    const view = grounded.blocks.map((block) => blockView(block, undefined));
    const key = JSON.stringify(view);
    if (key === sent) return;
    sent = key;
    emit({ type: "draft", message: { id: assistantId, role: "assistant", status: "pending", createdAt: new Date().toISOString(), text: "", positionMs: null, outcome: grounded.outcome, blocks: view, sources: grounded.sources, followUps: [], stale: false, doubt } });
  };
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


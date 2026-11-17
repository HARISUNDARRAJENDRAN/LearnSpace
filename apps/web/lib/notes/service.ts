import { randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, modelInvocations, resourceChunks, sessionTranscript, videoNotes } from "@learnspace/db/schema";
import {
  applyNoteOps, diagramSchema, NOTES_CONTRACT_VERSION, NOTES_MAX_BLOCKS, type NoteBlock, type NoteOp, scribeNoteOpSchema, type NotesEditRequest, notesGuideOutputSchema, type NotesGuideStatus, type NoteLine,
  notesScribeOutputSchema, type NotesScribeOutput, type NotesView, type VoiceTurnEvent, type VoiceTurnRequest,
} from "@learnspace/shared/notes";
import { strictJsonSchema } from "@learnspace/shared/tutor";
import { and, asc, desc, eq } from "drizzle-orm";
import { Allow, parse as parsePartial } from "partial-json";
import { estimateCostUsd, openAiTutorModel, TUTOR_MODEL, type TutorModel, TutorModelError, type TutorUsage } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { restoreLatex } from "../math";
import { masteryRecord } from "../mastery/service";
import { admitNotesRequest, admitTutorGeneration, admitTutorRun, recordGlobalSpend } from "../tutor/limits";
import { studyContext } from "../tutor/service";
import { loadPaperContext, loadPaperPassages, paperCitationAnchors, retrievePaperEvidence, type PaperContext, type PaperEvidence } from "../research/paper-context";
import { formatClock } from "../tutor/scope";
import { isLecture, parseCommand, splitReply } from "./commands";
import { buildGuidePrompt, buildPaperGuidePrompt, buildPaperTalkerPrompt, buildScribePrompt, buildTalkerPrompt, CHIME_IN, GREETING, GUIDE_INSTRUCTIONS, guideParts, IDLE, lessonText, PAPER_GUIDE_INSTRUCTIONS, PAPER_SCRIBE_INSTRUCTIONS, PAPER_TALKER_INSTRUCTIONS, paperTalkerText, singleGuideReach, SCRIBE_INSTRUCTIONS, TALKER_INSTRUCTIONS, WAITING } from "./prompt";
import { notesSources } from "./sources";

export const NOTES_PURPOSE = "voice_notes";
// Enough of the talk that Luny builds on what was said instead of saying it again.
const RECENT_LINES = 40;
const SCRIBE_LINES = 40;
const MAX_UNDO = 10;
// Undo keeps whole pages, so a long lecture's guide (thousands of blocks) keeps fewer of them.
const MAX_UNDO_BLOCKS = 4_000;
// A long lecture's guide is written a few parts at a time, all at once, each wave inside its route's time limit.
const GUIDE_PARALLEL = 6;
const SCRIBE_SCHEMA = strictJsonSchema(notesScribeOutputSchema);
const GUIDE_SCHEMA = strictJsonSchema(notesGuideOutputSchema);
// A guide still "writing" after its route's time limit was cut off with it, so it can be started again.
const GUIDE_WINDOW_MS = 300_000;
// A long lesson is cut to the stretch around the learner, moved in steps this size so the cached prompt stays the same between turns.
const LESSON_WINDOW_STEP_MS = 15 * 60_000;
// Luny's first words normally arrive in about a second (p90 2.5 s); a call still silent after this has stalled, so it is
// asked once more instead of leaving the learner waiting on a "thinking" Luny for the provider's full timeout.
const FIRST_WORDS_MS = 6_000;
// Failures worth one more try before Luny says she couldn't answer: the provider stalled, dropped or was briefly unreachable.
const RETRYABLE = /^(stalled|provider_unreachable|provider_stream_broken|provider_stream_ended|provider_http_5\d\d)$/;

type History = { revision: number; blocks: NoteBlock[] };
type Row = { revision: number; blocks: NoteBlock[]; history: History[]; guideStatus: string | null; guideStartedAt: Date | null };
type Video = Awaited<ReturnType<typeof studyContext>>;
const EMPTY: Row = { revision: 0, blocks: [], history: [], guideStatus: null, guideStartedAt: null };

/** The newest undo steps that fit: at most MAX_UNDO pages, and no more blocks in all than MAX_UNDO_BLOCKS. */
function keepHistory(history: History[]): History[] {
  const kept: History[] = [];
  let blocks = 0;
  for (const entry of history.slice(-MAX_UNDO).reverse()) {
    if (kept.length && blocks + entry.blocks.length > MAX_UNDO_BLOCKS) break;
    kept.unshift(entry);
    blocks += entry.blocks.length;
  }
  return kept;
}

/** A guide block's id names its part, so a guide cut off between parts is finished from where it stopped. */
const partPrefix = (part: number) => `gp${String(part).padStart(2, "0")}-`;
/** A guide written in one piece before long lectures were split, kept as the first part: it read only the lecture's start. */
const EARLIER_GUIDE = "gp00-l";
const partOf = (id: string): number | null => { const match = /^gp(\d{2,3})-/.exec(id); return match ? Number(match[1]) : null; };

function guideStatus(row: Row, video: Video): NotesGuideStatus {
  if (row.guideStatus === "ready") return "ready";
  if (row.guideStatus === "writing" && (row.guideStartedAt?.getTime() ?? 0) > Date.now() - GUIDE_WINDOW_MS) return "writing";
  if (row.guideStatus) return "failed";
  return video.transcript === "ready" ? "pending" : video.transcript === "preparing" ? "waiting" : "unavailable";
}

const view = (row: Row, video: Video): NotesView => ({ revision: row.revision, blocks: row.blocks, canUndo: row.history.at(-1)?.revision === row.revision, guide: guideStatus(row, video) });

const notesOf = (userId: string, resourceId: string) => and(eq(videoNotes.userId, userId), eq(videoNotes.resourceId, resourceId));

/** The learner's notes for one video, locked for the rest of the transaction when `lock` is set. */
async function readRow(tx: Transaction, userId: string, resourceId: string, lock: boolean): Promise<Row> {
  if (lock) await tx.insert(videoNotes).values({ userId, resourceId }).onConflictDoNothing();
  const query = tx.select().from(videoNotes).where(notesOf(userId, resourceId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ? { revision: row.revision, blocks: row.blocks as NoteBlock[], history: row.history as History[], guideStatus: row.guideStatus, guideStartedAt: row.guideStartedAt } : EMPTY;
}

/** The notes for the video a session the learner owns is on now. */
async function readNotes(tx: Transaction, userId: string, sessionId: string, lock: boolean): Promise<{ video: Video; row: Row }> {
  const video = await studyContext(tx, userId, sessionId);
  return { video, row: await readRow(tx, userId, video.resourceId, lock) };
}

async function writeNotes(tx: Transaction, userId: string, resourceId: string, row: Partial<Row>): Promise<void> {
  await tx.update(videoNotes).set({ ...row, updatedAt: new Date() }).where(notesOf(userId, resourceId));
}

export async function getNotes(userId: string, sessionId: string): Promise<NotesView> {
  return withUserTransaction(userId, async (tx) => { const { video, row } = await readNotes(tx, userId, sessionId, false); return view(row, video); });
}

/** The learner's own edits always apply; undo restores the page from before the companion's last edit, if nothing changed since. */
export async function editNotes(userId: string, sessionId: string, request: NotesEditRequest): Promise<NotesView> {
  return withUserTransaction(userId, async (tx) => {
    const { video, row } = await readNotes(tx, userId, sessionId, true);
    if ("action" in request) {
      const last = row.history.at(-1);
      if (last?.revision !== row.revision) throw new AuthError("NOTES_UNDO_UNAVAILABLE", "There is no edit of Luny's to undo.", 409);
      const next = { ...row, revision: row.revision + 1, blocks: last.blocks, history: row.history.slice(0, -1) };
      await writeNotes(tx, userId, video.resourceId, next);
      return view(next, video);
    }
    const { blocks, applied } = applyNoteOps(row.blocks, request.ops, "you", row.revision + 1, row.revision);
    if (applied === 0) return view(row, video);
    const next = { ...row, revision: row.revision + 1, blocks };
    await writeNotes(tx, userId, video.resourceId, next);
    return view(next, video);
  });
}

/** Records one model call against the run: cost, latency and how it ended. */
async function closeRun(tx: Transaction, runId: string, kind: "talk" | "scribe" | "guide", usage: TutorUsage | null, latencyMs: number | null, failure: string | null, firstOutputMs: number | null = null): Promise<void> {
  const costUsd = usage ? estimateCostUsd(usage) : 0;
  const effort = TUTOR_MODEL.depths[kind === "talk" ? "quick" : kind === "guide" ? "long" : "edit"].effort;
  // Three independent writes, sent together on the transaction's connection: one round trip instead of three.
  await Promise.all([
    usage ? tx.insert(modelInvocations).values({
      agentRunId: runId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${NOTES_PURPOSE}:${kind}:${effort}`, promptTemplateId: `notes-${kind === "talk" ? "talker" : kind}`, promptTemplateVer: NOTES_CONTRACT_VERSION,
    inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, firstOutputMs, latencyMs,
      estimatedCostUsd: costUsd.toFixed(8), cacheStatus: "miss", safetyStatus: failure ?? "ok", completedAt: new Date(),
    }) : null,
    recordGlobalSpend(tx, costUsd),
    tx.update(agentRuns).set({ status: failure ? "failed" : "done", completedAt: new Date(), failureCode: failure?.slice(0, 120) ?? null }).where(eq(agentRuns.id, runId)),
  ]);
}

type Chunk = { startMs: number | null; content: string };
/**
 * A ready transcript version never changes (its chunks are written with it, in one transaction, and a new transcript is a
 * new version), so a lesson read once is kept for the next turns instead of being read again on every one: a long lesson
 * is hundreds of rows. Kept per learner as well as per version, so a cached lesson is only ever served to a learner whose
 * own read returned it. Least recently used first out.
 */
const LESSON_CACHE_SIZE = 64;
const lessonCache = new Map<string, Chunk[]>();
const cachedLesson = (userId: string, versionId: string | null): Chunk[] | null => {
  if (!versionId) return [];
  const key = `${userId}:${versionId}`;
  const hit = lessonCache.get(key);
  if (!hit) return null;
  lessonCache.delete(key);
  lessonCache.set(key, hit);
  return hit;
};

/** The lesson's whole transcript, oldest first; a video without a ready transcript has none, and still talks. */
async function lessonChunks(tx: Transaction, userId: string, versionId: string | null): Promise<Chunk[]> {
  const cached = cachedLesson(userId, versionId);
  if (cached || !versionId) return cached ?? [];
  const chunks = await tx.select({ startMs: resourceChunks.startMs, content: resourceChunks.content }).from(resourceChunks)
    .where(eq(resourceChunks.resourceVersionId, versionId)).orderBy(asc(resourceChunks.ordinal));
  // An empty read is not kept: it may be a version the learner cannot see yet.
  if (chunks.length) {
    lessonCache.set(`${userId}:${versionId}`, chunks);
    if (lessonCache.size > LESSON_CACHE_SIZE) lessonCache.delete(lessonCache.keys().next().value as string);
  }
  return chunks;
}

/** The conversation's last lines, oldest first, and where in the video it last was. */
async function recentLines(tx: Transaction, sessionId: string, resourceId: string, limit: number): Promise<{ lines: NoteLine[]; positionMs: number | null }> {
  const rows = await tx.select({ speaker: sessionTranscript.speaker, text: sessionTranscript.text, positionMs: sessionTranscript.positionMs }).from(sessionTranscript)
    .where(and(eq(sessionTranscript.studySessionId, sessionId), eq(sessionTranscript.resourceId, resourceId))).orderBy(desc(sessionTranscript.seq)).limit(limit);
  return { lines: rows.reverse().map(({ speaker, text }) => ({ speaker, text })) as NoteLine[], positionMs: rows.find((row) => row.positionMs !== null)?.positionMs ?? null };
}

type Prepared = { video: Video; row: Row; chunks: Chunk[]; lines: NoteLine[]; positionMs: number | null; record: string; runId: string; paper: PaperContext | null };

/** Thrown inside the run's transaction to roll back a run whose turn turned out not to go ahead. */
class Skipped extends Error {}

/**
 * A read-only transaction whose result is handed over as soon as it is read: its commit, which changes nothing, follows on
 * its own instead of holding the turn up for another round trip.
 */
function readOnly<T>(userId: string, reads: (tx: Transaction) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    withUserTransaction(userId, async (tx) => { resolve(await reads(tx)); }).catch(reject);
  });
}

/**
 * Everything a voice turn or scribe pass reads before the model is asked, and its run recorded. On the transaction pooler
 * every bound query costs two round trips to the database, one after another on a connection, so the work goes out as
 * three transactions at once on three pooled connections, each waiting on the others only for what it needs:
 *  - the notes and the lesson, once the session's video is found;
 *  - the conversation and the mastery record: the record needs nothing, the conversation only the video;
 *  - the admission (the learner's lock, the budget), then the run, recorded while the reads finish and kept only once they
 *    all succeeded (and the rate limits allowed the turn); its transaction rolls back otherwise.
 * A turn with a `skip` (given the lesson) waits for the lesson before recording its run; a skipped turn returns null.
 */
async function prepareTurn(userId: string, sessionId: string, turn: { goal: string; maxTokens: number; lines: number; record: boolean; skip: ((chunks: Chunk[]) => boolean) | null; resourceType?: Video["resourceType"] }): Promise<Prepared | null> {
  const admitted = admitNotesRequest(userId);
  let located: (video: Video) => void = () => undefined;
  let lost: (error: unknown) => void = () => undefined;
  const found = new Promise<Video>((resolve, reject) => { located = resolve; lost = reject; });
  // Its failure is the notes lane's, reported there.
  found.catch(() => undefined);
  const notes = readOnly(userId, async (tx) => {
    const video = await studyContext(tx, userId, sessionId);
    if (turn.resourceType && video.resourceType !== turn.resourceType) throw new AuthError("STUDY_RESOURCE_TYPE_MISMATCH", `This ${video.resourceType} needs its matching voice request.`, 422);
    if (video.resourceType === "paper" && !video.versionId) throw new AuthError("PAPER_CONTENT_NOT_READY", "The paper text is still being prepared.", 409, undefined, { transcript: video.transcript });
    located(video);
    const [row, chunks, paper] = await Promise.all([
      readRow(tx, userId, video.resourceId, false), lessonChunks(tx, userId, video.versionId),
      video.resourceType === "paper" && video.versionId ? loadPaperContext(tx, userId, video.resourceId, video.versionId) : Promise.resolve(null),
    ]);
    return { video, row, chunks, paper };
  });
  notes.catch(lost);
  const resourceId = found.then((video) => video.resourceId);
  // masteryRecord awaits it only after its own query; a failure meanwhile is the notes lane's, reported there.
  resourceId.catch(() => undefined);
  const talk = readOnly(userId, async (tx) => {
    const record = turn.record ? await masteryRecord(tx, userId, sessionId, resourceId) : "";
    const { lines, positionMs } = await recentLines(tx, sessionId, (await found).resourceId, turn.lines);
    return { lines, positionMs, record };
  });
  const record = { studySessionId: sessionId, purpose: NOTES_PURPOSE, goal: turn.goal, policyVersion: NOTES_CONTRACT_VERSION, maxIterations: 1, maxToolCalls: 0, maxTokens: turn.maxTokens };
  const run = withUserTransaction(userId, async (tx) => {
    let id: string;
    if (turn.skip) {
      await admitTutorGeneration(tx, userId);
      const [lesson] = await Promise.all([notes, admitted]);
      if (turn.skip(lesson.chunks)) throw new Skipped();
      const [created] = await tx.insert(agentRuns).values({ userId, ...record, status: "executing", correlationId: randomUUID(), startedAt: new Date() }).returning({ id: agentRuns.id });
      if (!created) throw new Error("The run was not recorded.");
      id = created.id;
    } else {
      // Recorded by the admission itself; kept only if the rate limits allow the turn.
      id = await admitTutorRun(tx, userId, record);
      await admitted;
    }
    // A run is only kept for a turn whose reads all succeeded.
    await Promise.all([notes, talk]);
    return id;
  });
  // Every lane is awaited, so none is left running, or failing unheard, after the first failure.
  const [admission, read, conversation, runId] = await Promise.allSettled([admitted, notes, talk, run]);
  for (const lane of [admission, read, conversation, runId]) if (lane.status === "rejected" && !(lane.reason instanceof Skipped)) throw lane.reason;
  if (read.status !== "fulfilled" || conversation.status !== "fulfilled" || runId.status !== "fulfilled") return null;
    return { ...read.value, ...conversation.value, runId: runId.value };
}

/**
 * One spoken turn: Luny hears what the learner said, sees the lesson as it is on their screen, and answers out loud. Her
 * words stream back as she writes them, with her seek, play and pause commands taken out and sent as controls. The exchange is saved
 * once Luny has answered, even in part; a turn cut off before she said anything is not, and the browser sends those words
 * again with what the learner says next.
 */
export async function runVoiceTurn(userId: string, sessionId: string, input: VoiceTurnRequest, options: { signal: AbortSignal; emit: (event: VoiceTurnEvent) => void; model?: TutorModel; firstWordsMs?: number }): Promise<void> {
  const model = options.model ?? openAiTutorModel;
  const paperTurn = "anchor" in input;
  const prepared = await prepareTurn(userId, sessionId, {
    goal: "Talk with the learner", maxTokens: TUTOR_MODEL.depths.quick.maxOutputTokens, lines: RECENT_LINES, record: true,
    resourceType: paperTurn ? "paper" : "video",
    // The video playing aloud reaches the microphone too; its own words never start a turn.
    skip: !paperTurn && input.utterance && input.playing ? (chunks) => isLecture(input.utterance ?? "", chunks, input.positionMs, input.playing) : null,
  });
  if (!prepared) return options.emit({ type: "done" });
  const { row, video, chunks, lines, record, runId, paper } = prepared;
  if (paperTurn && (!paper || !video.versionId)) throw new AuthError("PAPER_CONTENT_NOT_READY", "The paper text is still being prepared.", 409);
  const windowAt = !paperTurn && input.positionMs !== null ? input.positionMs - (input.positionMs % LESSON_WINDOW_STEP_MS) : null;
  const place = !paperTurn && input.positionMs !== null ? `(At ${formatClock(input.positionMs)} in the video, ${input.playing ? "playing" : "paused"}.)` : "(No video position.)";
  const paperEvidence = paperTurn ? await withUserTransaction(userId, (tx) => retrievePaperEvidence(tx, {
    userId, sessionId, agentRunId: runId, paper: paper!, question: `${input.utterance ?? ""} ${input.selection ?? ""}`.trim(), anchor: {
      ...(input.anchor.page !== undefined ? { page: input.anchor.page } : {}),
      ...(input.anchor.sectionId !== undefined ? { sectionId: input.anchor.sectionId } : {}),
    },
  })) : null;
  let said = "";
  let read = 0;
  const flush = (text: string, final: boolean) => {
    const { say, commands, next } = splitReply(text, read, final);
    read = next;
    if (say) { said += say; options.emit({ type: "say", text: say }); }
    for (const command of commands) {
      const control = parseCommand(command, paperEvidence?.evidence);
      if (control) options.emit({ type: "control", control });
    }
  };
  let result: Awaited<ReturnType<TutorModel>> | null = null;
  let failure: TutorModelError | null = null;
  let paperFirstTokenMs: number | null = null;
  const request = {
    depth: "quick" as const, fast: true, cacheKey: `notes-talker:${sessionId}`, image: paperTurn ? null : input.frame,
    // The lesson stays the same all session, so it sits in the cached prefix with Luny's instructions.
    instructions: paperTurn && paper && paperEvidence
      ? `${PAPER_TALKER_INSTRUCTIONS}\n\n${paperTalkerText({ title: paper.title, abstract: paper.abstract, outline: paper.outline, passages: paperEvidence.evidence.map((item) => ({ content: item.content, page: item.anchor.page, sectionId: item.anchor.sectionId })) })}`
      : `${TALKER_INSTRUCTIONS}\n\n${lessonText(video.title, chunks, windowAt)}`,
    user: paperTurn ? buildPaperTalkerPrompt({ record, blocks: row.blocks, lines, anchor: {
      ...(input.anchor.page !== undefined ? { page: input.anchor.page } : {}),
      ...(input.anchor.sectionId !== undefined ? { sectionId: input.anchor.sectionId } : {}),
    }, selection: input.selection ?? null, utterance: input.utterance })
      : buildTalkerPrompt({ record, blocks: row.blocks, lines, place, utterance: input.utterance, positionMs: input.positionMs }),
    // A turn the learner didn't start: Luny answering words she let go by, picking the talk back up, chiming in after they
    // paused the video, or opening the talk.
    developer: input.utterance ? "" : input.cue === "waiting" ? WAITING : input.cue === "idle" ? IDLE
      : !paperTurn && input.watchedFromMs !== null && input.positionMs !== null ? CHIME_IN(formatClock(input.watchedFromMs), formatClock(input.positionMs)) : GREETING(lines.length > 0),
  };
  for (let attempt = 0; ; attempt++) {
    const watchdog = new AbortController();
    let stalled = false;
    const timer = setTimeout(() => { stalled = true; watchdog.abort(); }, options.firstWordsMs ?? FIRST_WORDS_MS);
    try {
      const startedAt = performance.now();
      result = await model(request, { signal: AbortSignal.any([options.signal, watchdog.signal]), onFirstOutput: () => { clearTimeout(timer); if (paperTurn && paperFirstTokenMs === null) paperFirstTokenMs = Math.round(performance.now() - startedAt); }, onText: (text) => flush(text, false) });
      flush(result.text, true);
      failure = null;
    } catch (error) {
      failure = stalled && !options.signal.aborted ? new TutorModelError("stalled") : error instanceof TutorModelError ? error : new TutorModelError("internal_error");
    } finally {
      clearTimeout(timer);
    }
    // Only a turn that has not started speaking is asked again, so the learner never hears a sentence twice.
    if (!failure || attempt > 0 || said || options.signal.aborted || !RETRYABLE.test(failure.code)) break;
    read = 0;
  }
  const spoken = said.replace(/\s+/g, " ").trim();
  // Her reply is complete: its last sentence can be spoken now, while the exchange is being saved.
  if (!failure && said) options.emit({ type: "say", text: "", final: true });
  await withUserTransaction(userId, async (tx) => {
    const entries = result || spoken ? [
      ...(input.utterance ? [{ speaker: "you" as const, text: input.utterance }] : []),
      ...(spoken ? [{ speaker: "luna" as const, text: spoken }] : []),
    ] : [];
    await Promise.all([
      entries.length ? tx.insert(sessionTranscript).values(entries.map((line) => ({ studySessionId: sessionId, userId, resourceId: video.resourceId, speaker: line.speaker, text: line.text.slice(0, 4_000), positionMs: paperTurn ? null : input.positionMs }))) : null,
      closeRun(tx, runId, "talk", result?.usage ?? failure?.usage ?? null, result?.latencyMs ?? null, failure?.code ?? null, paperFirstTokenMs ?? result?.firstOutputMs ?? null),
    ]);
  });
  if (paperTurn) console.info(JSON.stringify({ metric: "paper_voice_first_token", resourceId: video.resourceId, latencyMs: paperFirstTokenMs ?? result?.firstOutputMs ?? null }));
  if (failure) {
    if (failure.code === "cancelled") return;
    throw new AuthError("NOTES_VOICE_FAILED", failure.code === "provider_http_429" ? "Luny is busy right now. Try again in a minute." : "Luny couldn't answer just now.", 502);
  }
  options.emit({ type: "done" });
}

/**
 * One scribe pass: reads the recent conversation and brings the notebook up to date. Its edits never overwrite a block the
 * learner changed while it was thinking, and the whole pass can be undone.
 */
export async function runScribe(userId: string, sessionId: string, options: { signal: AbortSignal; model?: TutorModel; onOp?: (op: NoteOp, base: number) => void }): Promise<NotesView> {
  const model = options.model ?? openAiTutorModel;
  const prepared = await prepareTurn(userId, sessionId, { goal: "Keep the learner's notebook", maxTokens: TUTOR_MODEL.depths.edit.maxOutputTokens, lines: SCRIBE_LINES, record: false, skip: null });
  if (!prepared) throw new Error("The scribe run was not recorded.");
  const { video, row, lines, chunks, runId, positionMs, paper } = prepared;
  const paperEvidence = paper && video.versionId ? await withUserTransaction(userId, (tx) => retrievePaperEvidence(tx, {
    userId, sessionId, agentRunId: runId, paper, question: lines.filter((line) => line.speaker === "you").slice(-6).map((line) => line.text).join(" "), anchor: {},
  })) : null;
  const citablePassages = paperEvidence?.evidence ?? [];
  // A long lecture is read around where the conversation was, as Luny reads it, in the same steps so the prefix stays cached.
  const windowAt = positionMs === null ? null : positionMs - (positionMs % LESSON_WINDOW_STEP_MS);
  if (!lines.length) {
    await withUserTransaction(userId, (tx) => closeRun(tx, runId, "scribe", null, null, null));
    return view(row, video);
  }
  const sources = await notesSources(lines.filter((line) => line.speaker === "you").slice(-3).map((line) => line.text).join(" "), options.signal);
  const user = buildScribePrompt({ blocks: row.blocks, lines, sources, positionMs });
  let result: Awaited<ReturnType<TutorModel>>;
  // Each edit is shown as soon as the model has written it whole (the next one has begun), long before the pass ends;
  // the pass is still saved, checked and undoable as one, below.
  let shown = 0;
  const onOp = options.onOp;
  const onText = onOp ? (text: string) => {
    const ops = partialOps(text);
    for (; shown < ops.length - 1; shown++) {
      const op = scribeNoteOpSchema.safeParse(ops[shown]);
      if (op.success) {
        const [mapped] = citedScribeOps([op.data], citablePassages, video.resourceType === "paper");
        if (mapped) onOp(mapped, row.revision);
      }
    }
  } : undefined;
  try {
    // The lesson sits in the cached prefix with the instructions, as it does for Luny: it is the same on every pass of a session.
    result = await model({ depth: "edit", instructions: video.resourceType === "paper" && paper
      ? `${PAPER_SCRIBE_INSTRUCTIONS}\n\n${paperTalkerText({ title: paper.title, abstract: paper.abstract, outline: paper.outline, passages: citablePassages.map((passage) => ({ content: passage.content, page: passage.anchor.page, sectionId: passage.anchor.sectionId })) })}`
      : `${SCRIBE_INSTRUCTIONS}\n\n${lessonText(video.title, chunks, windowAt)}`, developer: "", user, schema: SCRIBE_SCHEMA, cacheKey: `notes-scribe:${sessionId}` }, { signal: options.signal, ...(onText ? { onText } : {}) });
  } catch (error) {
    const code = error instanceof TutorModelError ? error.code : "internal_error";
    await withUserTransaction(userId, (tx) => closeRun(tx, runId, "scribe", error instanceof TutorModelError ? error.usage : null, null, code)).catch(() => undefined);
    throw new AuthError("NOTES_SCRIBE_FAILED", "Luny couldn't update the notes just now.", 502);
  }
  const output = parse(notesScribeOutputSchema, result.text);
  return withUserTransaction(userId, async (tx) => {
    // The video the conversation was about, even if the session has moved on since.
    const [, current] = await Promise.all([
      closeRun(tx, runId, "scribe", result.usage, result.latencyMs, output ? null : result.refusal ? "refused" : "invalid_output"),
      readRow(tx, userId, video.resourceId, true),
    ]);
    if (!output?.ops.length) return view(current, video);
    const ops = citedScribeOps(output.ops, citablePassages, video.resourceType === "paper");
    const { blocks, applied } = applyNoteOps(current.blocks, ops, "luna", current.revision + 1, row.revision);
    if (applied === 0) return view(current, video);
    const next: Row = { ...current, revision: current.revision + 1, blocks, history: keepHistory([...current.history, { revision: current.revision + 1, blocks: current.blocks }]) };
    await writeNotes(tx, userId, video.resourceId, next);
    return view(next, video);
  });
}

function citedScribeOps(ops: NotesScribeOutput["ops"], evidence: PaperEvidence[], isPaper: boolean): NoteOp[] {
  return ops.flatMap((op) => {
    const { cite, ...edit } = op;
    if (!isPaper || edit.action === "delete" || edit.action === "move") return [edit];
    const anchors = paperCitationAnchors(cite ?? [], evidence);
    if (anchors.length || edit.type === "heading" || edit.type === "subheading" || edit.type === "task" || (edit.action === "update" && edit.text === null)) return [{ ...edit, ...(anchors.length ? { anchors } : {}) }];
    return [];
  });
}

/** The ops written so far in a streamed scribe reply, the last possibly cut off, with the LaTeX their escapes broke put back. */
function partialOps(text: string): unknown[] {
  try {
    const value = parsePartial(text, Allow.ALL) as { ops?: unknown };
    if (!Array.isArray(value?.ops)) return [];
    return value.ops.map((op) => op && typeof op === "object" ? Object.fromEntries(Object.entries(op).map(([key, field]) => [key, typeof field === "string" ? restoreLatex(field) : field])) : op);
  } catch {
    return [];
  }
}

/** Model JSON with the LaTeX its escapes broke put back. */
function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text, (_key, value: unknown) => typeof value === "string" ? restoreLatex(value) : value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const validDiagram = (text: string) => { try { return diagramSchema.safeParse(JSON.parse(text)).success; } catch { return false; } };

/**
 * Starts the video's study guide unless it is written, being written, or cannot be yet. The guide is written by `write`, which
 * the caller runs after answering; the returned notes already say it is being written.
 */
export async function startGuide(userId: string, sessionId: string, options: { model?: TutorModel } = {}): Promise<{ notes: NotesView; write: (() => Promise<void>) | null }> {
  await admitNotesRequest(userId);
  const started = await withUserTransaction(userId, async (tx) => {
    // The locked row is the guide's mutex: the lesson page and the Notes panel may both ask at once.
    const { video, row: read } = await readNotes(tx, userId, sessionId, true);
    let row = read;
    let status = guideStatus(row, video);
    // A guide written in one piece before long lectures were split covers only their first stretch. It is kept as it is,
    // as the first part, and the rest of the lecture is written after it.
    if (video.resourceType === "video" && status === "ready" && video.versionId && row.blocks[0]?.by === "luna" && !row.blocks.some((block) => partOf(block.id) !== null)) {
      const chunks = await lessonChunks(tx, userId, video.versionId);
      if (singleGuideReach(chunks) < chunks.length) {
        let end = 0;
        while (end < row.blocks.length && row.blocks[end]!.by === "luna") end += 1;
        row = { ...row, blocks: row.blocks.map((block, index) => (index < end ? { ...block, id: `${EARLIER_GUIDE}${block.id}`.slice(0, 24) } : block)) };
        await writeNotes(tx, userId, video.resourceId, { blocks: row.blocks });
        status = "pending";
      }
    }
    if (status !== "pending" && status !== "failed") return { notes: view(row, video) };
    if (!video.versionId) return { notes: view(row, video) };
    await admitTutorGeneration(tx, userId);
    const startedAt = new Date();
    const next = { ...row, guideStatus: "writing", guideStartedAt: startedAt };
    await writeNotes(tx, userId, video.resourceId, { guideStatus: next.guideStatus, guideStartedAt: startedAt });
    const [run] = await tx.insert(agentRuns).values({
      userId, studySessionId: sessionId, purpose: NOTES_PURPOSE, status: "executing", goal: "Write the video's study guide", policyVersion: NOTES_CONTRACT_VERSION,
      maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.depths.long.maxOutputTokens, correlationId: randomUUID(), startedAt,
    }).returning({ id: agentRuns.id });
    if (!run) throw new Error("The guide run was not recorded.");
    return { notes: view(next, video), job: { video: { ...video, versionId: video.versionId }, runId: run.id, startedAt } };
  });
  const { job } = started;
  return { notes: started.notes, write: job ? () => writeGuide(userId, job, options.model ?? openAiTutorModel) : null };
}

/** The parts the page already has; a part with nothing left to write (all read by an earlier guide) counts as written. */
const writtenParts = (blocks: NoteBlock[], parts: Chunk[][]) => new Set([...blocks.flatMap((block) => partOf(block.id) ?? []), ...parts.flatMap((part, index) => (part.length ? [] : [index]))]);

/**
 * Writes the guide from the whole transcript and puts it at the top of the page, above anything already there. A long
 * lecture is written in parts (a 24-hour course is about fifteen), up to GUIDE_PARALLEL at once, each put in its place on
 * the page as soon as it is written. A wave that leaves parts unwritten hands the guide back as not started, and the open
 * notes page starts the next wave, which writes only the parts the page doesn't have yet.
 */
async function writeGuide(userId: string, job: { video: Video & { versionId: string }; runId: string; startedAt: Date }, model: TutorModel): Promise<void> {
  const { video, runId, startedAt } = job;
  if (video.resourceType === "paper") return writePaperGuide(userId, job, model);
  // Only the run that started the guide finishes it; one cut off and started again leaves it to the newer run.
  const finish = (current: Row) => current.guideStatus === "writing" && current.guideStartedAt?.getTime() === startedAt.getTime();
  let parts: Chunk[][];
  let todo: number[];
  try {
    const { chunks, row } = await withUserTransaction(userId, async (tx) => ({ chunks: await lessonChunks(tx, userId, video.versionId), row: await readRow(tx, userId, video.resourceId, false) }));
    parts = guideParts(chunks);
    // On a page whose first part is an earlier one-piece guide, each part is only what that guide didn't reach.
    if (row.blocks.some((block) => block.id.startsWith(EARLIER_GUIDE))) {
      const reached = new Set(chunks.slice(0, singleGuideReach(chunks)));
      parts = parts.map((part, index) => (index === 0 ? part : part.filter((chunk) => !reached.has(chunk))));
    }
    const written = writtenParts(row.blocks, parts);
    todo = parts.map((_, index) => index).filter((index) => !written.has(index)).slice(0, GUIDE_PARALLEL);
  } catch {
    await withUserTransaction(userId, async (tx) => {
      await closeRun(tx, runId, "guide", null, null, "internal_error");
      if (finish(await readRow(tx, userId, video.resourceId, true))) await writeNotes(tx, userId, video.resourceId, { guideStatus: "failed" });
    });
    return;
  }
  const failures: string[] = [];
  await Promise.all(todo.map(async (index) => {
    const part = parts[index]!;
    const next = parts[index + 1]?.[0]?.startMs ?? video.durationMs;
    let result: Awaited<ReturnType<TutorModel>>;
    try {
      result = await model({
        depth: "long", instructions: GUIDE_INSTRUCTIONS, developer: "", schema: GUIDE_SCHEMA, cacheKey: `notes-guide:${NOTES_CONTRACT_VERSION}`,
        user: buildGuidePrompt({ lesson: lessonText(video.title, part, null), durationMs: video.durationMs, part: { index, count: parts.length, fromMs: part[0]?.startMs ?? null, toMs: next ?? null } }),
      }, { signal: new AbortController().signal });
    } catch (error) {
      failures.push(error instanceof TutorModelError ? error.code : "internal_error");
      if (error instanceof TutorModelError && error.usage) await withUserTransaction(userId, (tx) => closeRun(tx, runId, "guide", error.usage, null, error.code)).catch(() => undefined);
      return;
    }
    const output = parse(notesGuideOutputSchema, result.text);
    const prefix = partPrefix(index);
    const guide = (output?.blocks ?? [])
      // The page numbers steps itself, so a number the model wrote in would show twice.
      .map((block) => ({ ...block, text: (block.type === "step" ? block.text.replace(/^\s*\d+[.)]\s+/, "") : block.text).trim() }))
      .filter((block) => block.text && (block.type !== "diagram" || validDiagram(block.text)))
      .map((block) => ({ id: `${prefix}${randomUUID().slice(0, 8)}`, type: block.type, text: block.text, done: false, by: "luna" as const }));
    if (!guide.length) failures.push(result.refusal ? "refused" : "invalid_output");
    await withUserTransaction(userId, async (tx) => {
      await closeRun(tx, runId, "guide", result.usage, result.latencyMs, guide.length ? null : result.refusal ? "refused" : "invalid_output");
      const current = await readRow(tx, userId, video.resourceId, true);
      if (!finish(current) || !guide.length || current.blocks.some((block) => partOf(block.id) === index)) return;
      const revision = current.revision + 1;
      // After the last block of an earlier part, so parts landing out of order still read in order; part one goes on top.
      let at = 0;
      current.blocks.forEach((block, position) => { const of = partOf(block.id); if (of !== null && of < index) at = position + 1; });
      // Whatever the learner already has is kept whole; the guide gives way if the page would run over.
      const room = Math.max(0, NOTES_MAX_BLOCKS - current.blocks.length);
      // A full page can't take the part, and another wave would only write it again.
      if (!room) { failures.push("notes_full"); return; }
      const blocks = [...current.blocks.slice(0, at), ...guide.slice(0, room).map((block) => ({ ...block, rev: revision })), ...current.blocks.slice(at)];
      const history = current.blocks.length ? keepHistory([...current.history, { revision, blocks: current.blocks }]) : current.history;
      await writeNotes(tx, userId, video.resourceId, { revision, blocks, history });
    });
  }));
  await withUserTransaction(userId, async (tx) => {
    const current = await readRow(tx, userId, video.resourceId, true);
    const written = writtenParts(current.blocks, parts);
    const complete = parts.every((_, index) => written.has(index));
    await closeRun(tx, runId, "guide", null, null, complete || !failures.length ? null : failures[0]!);
    if (!finish(current)) return;
    // Parts still to write and none failed: not started, so the notes page asks for the next wave.
    await writeNotes(tx, userId, video.resourceId, complete ? { guideStatus: "ready" } : failures.length ? { guideStatus: "failed" } : { guideStatus: null, guideStartedAt: null });
  });
}

async function writePaperGuide(userId: string, job: { video: Video & { versionId: string }; runId: string; startedAt: Date }, model: TutorModel): Promise<void> {
  const { video, runId, startedAt } = job;
  const finish = (current: Row) => current.guideStatus === "writing" && current.guideStartedAt?.getTime() === startedAt.getTime();
  try {
    const context = await withUserTransaction(userId, async (tx) => {
      const paper = await loadPaperContext(tx, userId, video.resourceId, video.versionId);
      const passages = (await loadPaperPassages(tx, video.versionId)).filter((passage) => passage.page !== null);
      return { paper, passages };
    });
    const result = await model({
      depth: "long", instructions: PAPER_GUIDE_INSTRUCTIONS, developer: "", schema: GUIDE_SCHEMA, cacheKey: `notes-paper-guide:${NOTES_CONTRACT_VERSION}`,
      user: buildPaperGuidePrompt({ ...context.paper, passages: context.passages }),
    }, { signal: new AbortController().signal });
    const output = parse(notesGuideOutputSchema, result.text);
    const evidence = context.passages.flatMap((passage) => passage.page === null ? [] : [{ anchor: { kind: "paper" as const, page: passage.page, sectionId: passage.sectionId ?? passage.headingPath.at(-1) ?? "unsectioned", chunkId: passage.chunkId } }]);
    const guide = (output?.blocks ?? []).flatMap((block, index) => {
      const anchors = paperCitationAnchors(block.cite ?? [], evidence);
      if (!block.text.trim() || (!anchors.length && block.type !== "heading" && block.type !== "subheading") || (block.type === "diagram" && !validDiagram(block.text))) return [];
      return [{ id: `${partPrefix(0)}${index}-${randomUUID().slice(0, 6)}`.slice(0, 24), type: block.type, text: block.text.trim(), done: false, by: "luna" as const, anchors }];
    });
    await withUserTransaction(userId, async (tx) => {
      await closeRun(tx, runId, "guide", result.usage, result.latencyMs, guide.length ? null : result.refusal ? "refused" : "invalid_output");
      const current = await readRow(tx, userId, video.resourceId, true);
      if (!finish(current)) return;
      if (!guide.length) return writeNotes(tx, userId, video.resourceId, { guideStatus: "failed" });
      const room = Math.max(0, NOTES_MAX_BLOCKS - current.blocks.length);
      if (guide.length > room) return writeNotes(tx, userId, video.resourceId, { guideStatus: "failed" });
      const revision = current.revision + 1;
      const history = current.blocks.length ? keepHistory([...current.history, { revision, blocks: current.blocks }]) : current.history;
      await writeNotes(tx, userId, video.resourceId, {
        revision, blocks: [...guide.map((block) => ({ ...block, rev: revision })), ...current.blocks], history, guideStatus: "ready",
      });
    });
  } catch (error) {
    await withUserTransaction(userId, async (tx) => {
      await closeRun(tx, runId, "guide", error instanceof TutorModelError ? error.usage ?? null : null, null, error instanceof TutorModelError ? error.code : "internal_error");
      const current = await readRow(tx, userId, video.resourceId, true);
      if (finish(current)) await writeNotes(tx, userId, video.resourceId, { guideStatus: "failed" });
    }).catch(() => undefined);
  }
}

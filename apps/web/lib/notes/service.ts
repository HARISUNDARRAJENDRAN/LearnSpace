import { randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, modelInvocations, resourceChunks, sessionNotes, studySessions } from "@learnspace/db/schema";
import {
  applyNoteOps, NOTES_CONTRACT_VERSION, spokenReply, type NoteBlock, type NotesEditRequest, notesModelOutputSchema, type NotesStreamEvent, type NotesTurnRequest, type NotesView, type NoteTurn,
} from "@learnspace/shared/notes";
import { strictJsonSchema } from "@learnspace/shared/tutor";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { Allow, parse } from "partial-json";
import { estimateCostUsd, openAiTutorModel, TUTOR_MODEL, type TutorModel, TutorModelError, type TutorUsage } from "../ai/tutor-model";
import { AuthError } from "../auth/errors";
import { admitTutorGeneration, recordGlobalSpend } from "../tutor/limits";
import { videoContext } from "../tutor/service";
import { buildNotesPrompt, NOTES_INSTRUCTIONS } from "./prompt";
import { notesSources } from "./sources";

export const NOTES_PURPOSE = "voice_notes";
const MAX_TURNS = 16;
const MAX_UNDO = 10;
const OUTPUT_SCHEMA = strictJsonSchema(notesModelOutputSchema);

type History = { revision: number; blocks: NoteBlock[] };
type Row = { revision: number; blocks: NoteBlock[]; turns: NoteTurn[]; history: History[] };
const EMPTY: Row = { revision: 0, blocks: [], turns: [], history: [] };

const view = (row: Row): NotesView => ({ revision: row.revision, blocks: row.blocks, turns: row.turns, canUndo: row.history.at(-1)?.revision === row.revision });

/** The learner's notes for a session they own, locked for the rest of the transaction when `lock` is set. */
async function readNotes(tx: Transaction, userId: string, sessionId: string, lock: boolean): Promise<Row> {
  const [session] = await tx.select({ id: studySessions.id }).from(studySessions).where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId), ne(studySessions.status, "abandoned"))).limit(1);
  if (!session) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That study session was not found.", 404);
  if (lock) await tx.insert(sessionNotes).values({ studySessionId: sessionId, userId }).onConflictDoNothing();
  const query = tx.select().from(sessionNotes).where(eq(sessionNotes.studySessionId, sessionId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ? { revision: row.revision, blocks: row.blocks as NoteBlock[], turns: row.turns as NoteTurn[], history: row.history as History[] } : EMPTY;
}

async function writeNotes(tx: Transaction, sessionId: string, row: Row): Promise<void> {
  await tx.update(sessionNotes).set({ revision: row.revision, blocks: row.blocks, turns: row.turns, history: row.history, updatedAt: new Date() }).where(eq(sessionNotes.studySessionId, sessionId));
}

export async function getNotes(userId: string, sessionId: string): Promise<NotesView> {
  return withUserTransaction(userId, async (tx) => view(await readNotes(tx, userId, sessionId, false)));
}

/** The learner's own edits always apply; undo restores the page from before the companion's last edit, if nothing changed since. */
export async function editNotes(userId: string, sessionId: string, request: NotesEditRequest): Promise<NotesView> {
  return withUserTransaction(userId, async (tx) => {
    const row = await readNotes(tx, userId, sessionId, true);
    if ("action" in request) {
      const last = row.history.at(-1);
      if (last?.revision !== row.revision) throw new AuthError("NOTES_UNDO_UNAVAILABLE", "There is no edit of Luna's to undo.", 409);
      const next = { ...row, revision: row.revision + 1, blocks: last.blocks, history: row.history.slice(0, -1) };
      await writeNotes(tx, sessionId, next);
      return view(next);
    }
    const { blocks, applied } = applyNoteOps(row.blocks, request.ops, "you", row.revision + 1, row.revision);
    if (applied === 0) return view(row);
    const next = { ...row, revision: row.revision + 1, blocks };
    await writeNotes(tx, sessionId, next);
    return view(next);
  });
}

/** The lesson title and up to ~90 s of transcript before the learner's place; neither is required to talk. */
async function lessonContext(tx: Transaction, userId: string, sessionId: string, positionMs: number | null): Promise<{ title: string | null; transcript: string[] }> {
  const video = await videoContext(tx, userId, sessionId).catch((error: unknown) => {
    if (error instanceof AuthError) return null;
    throw error;
  });
  if (!video?.versionId || positionMs === null) return { title: video?.title ?? null, transcript: [] };
  const rows = await tx.select({ content: resourceChunks.content }).from(resourceChunks)
    .where(and(eq(resourceChunks.resourceVersionId, video.versionId), gte(resourceChunks.endMs, positionMs - 90_000), lte(resourceChunks.startMs, positionMs + 10_000)))
    .orderBy(asc(resourceChunks.ordinal)).limit(6);
  return { title: video.title, transcript: rows.map((row) => row.content) };
}

async function closeRun(tx: Transaction, runId: string, usage: TutorUsage | null, latencyMs: number | null, failure: string | null): Promise<void> {
  const costUsd = usage ? estimateCostUsd(usage) : 0;
  if (usage) {
    await tx.insert(modelInvocations).values({
      agentRunId: runId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${NOTES_PURPOSE}:${TUTOR_MODEL.depths.quick.effort}`, promptTemplateId: "notes", promptTemplateVer: NOTES_CONTRACT_VERSION,
      inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, latencyMs,
      estimatedCostUsd: costUsd.toFixed(8), cacheStatus: "miss", safetyStatus: failure ?? "ok", completedAt: new Date(),
    });
  }
  await recordGlobalSpend(tx, costUsd);
  await tx.update(agentRuns).set({ status: failure ? "failed" : "done", completedAt: new Date(), failureCode: failure?.slice(0, 120) ?? null }).where(eq(agentRuns.id, runId));
}

/**
 * One spoken turn: the reply streams as `say` events while the model writes it, and its note edits are applied only once
 * the whole output is valid. A turn the learner cuts off (the request aborts) changes nothing and is not remembered, so
 * the client sends its words again with what they say next.
 */
export async function runNotesTurn(userId: string, sessionId: string, input: NotesTurnRequest, options: { signal: AbortSignal; emit: (event: NotesStreamEvent) => void; model?: TutorModel }): Promise<void> {
  const model = options.model ?? openAiTutorModel;
  const { row, lesson, runId } = await withUserTransaction(userId, async (tx) => {
    const row = await readNotes(tx, userId, sessionId, false);
    await admitTutorGeneration(tx, userId);
    const lesson = await lessonContext(tx, userId, sessionId, input.positionMs);
    const [run] = await tx.insert(agentRuns).values({
      userId, studySessionId: sessionId, purpose: NOTES_PURPOSE, status: "executing", goal: "Talk with the learner and keep their notes", policyVersion: NOTES_CONTRACT_VERSION,
      maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.depths.quick.maxOutputTokens, correlationId: randomUUID(), startedAt: new Date(),
    }).returning({ id: agentRuns.id });
    return { row, lesson, runId: run!.id };
  });
  const sources = await notesSources(input.utterance, options.signal);
  const prompt = buildNotesPrompt({ ...lesson, ...(input.spatial ? { spatial: input.spatial } : {}), sources, positionMs: input.positionMs, blocks: row.blocks, turns: row.turns, utterance: input.utterance });
  let spoken = "";
  const onText = (text: string) => {
    let partial: { opener?: unknown; say?: unknown };
    try {
      partial = parse(text, Allow.OBJ | Allow.STR) as typeof partial;
    } catch {
      return;
    }
    // The opener is complete once "say" has begun.
    if (typeof partial.opener !== "string" || typeof partial.say !== "string") return;
    const reply = spokenReply(partial.opener, partial.say);
    if (reply && reply !== spoken) {
      spoken = reply;
      options.emit({ type: "say", text: reply });
    }
  };
  let result: Awaited<ReturnType<TutorModel>>;
  try {
    result = await model({ depth: "quick", instructions: NOTES_INSTRUCTIONS, developer: prompt.developer, user: prompt.user, schema: OUTPUT_SCHEMA, cacheKey: `notes:${NOTES_CONTRACT_VERSION}`, image: input.spatial?.frame ?? null, fast: true }, { signal: options.signal, onText });
  } catch (error) {
    const code = error instanceof TutorModelError ? error.code : "internal_error";
    await withUserTransaction(userId, (tx) => closeRun(tx, runId, error instanceof TutorModelError ? error.usage : null, null, code)).catch(() => undefined);
    if (code !== "cancelled") options.emit({ type: "error", message: "Luna couldn't answer just now. Try saying that again." });
    return;
  }
  const output = (() => {
    try {
      const parsed = notesModelOutputSchema.safeParse(JSON.parse(result.text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })();
  const notes = await withUserTransaction(userId, async (tx) => {
    await closeRun(tx, runId, result.usage, result.latencyMs, output ? null : result.refusal ? "refused" : "invalid_output");
    if (!output || options.signal.aborted) return null;
    const current = await readNotes(tx, userId, sessionId, true);
    const { blocks, applied } = applyNoteOps(current.blocks, output.ops, "luna", current.revision + 1, row.revision);
    const turns = [...current.turns, { you: input.utterance, luna: spokenReply(output.opener, output.say) }].slice(-MAX_TURNS);
    const next: Row = applied > 0
      ? { revision: current.revision + 1, blocks, turns, history: [...current.history, { revision: current.revision + 1, blocks: current.blocks }].slice(-MAX_UNDO) }
      : { ...current, turns };
    await writeNotes(tx, sessionId, next);
    return view(next);
  });
  if (!output) options.emit({ type: "error", message: "Luna lost her train of thought. Try saying that again." });
  else if (notes) options.emit({ type: "done", say: spokenReply(output.opener, output.say), notes, visual: output.visual });
}

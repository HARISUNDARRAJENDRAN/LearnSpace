import { z } from "zod";

/** Bumped whenever the companion's prompt or output contract changes. */
export const NOTES_CONTRACT_VERSION = "notes-v3";
export const NOTES_MAX_BLOCKS = 200;
export const NOTES_MAX_TEXT = 2_000;

/** idea: a tentative thought; decision: something the learner settled on; question: still open. */
export const noteBlockTypeSchema = z.enum(["heading", "paragraph", "bullet", "task", "idea", "decision", "question", "diagram", "image", "link"]);
export type NoteBlockType = z.infer<typeof noteBlockTypeSchema>;
export type NoteActor = "you" | "luna";
/** `rev` is the notes revision that last changed the block and `by` who changed it, so a stale edit never overwrites a newer one. */
export type NoteBlock = { id: string; type: NoteBlockType; text: string; done: boolean; by: NoteActor; rev: number };

/**
 * One edit, from the learner or the companion. Every field is present (null when unused) so the same shape is the model's
 * strict output. insert: `id` is the new block's, placed after `after` (null: at the end); update/delete: `id` is the target.
 */
export const noteOpSchema = z.object({
  action: z.enum(["insert", "update", "delete", "move"]),
  id: z.string().regex(/^[a-z0-9-]{1,24}$/),
  after: z.string().nullable(),
  type: noteBlockTypeSchema.nullable(),
  text: z.string().max(NOTES_MAX_TEXT).nullable(),
  done: z.boolean().nullable(),
}).strict();
export type NoteOp = z.infer<typeof noteOpSchema>;

/** Luna's first words, a reaction voiced ahead of time so she is heard the moment she starts answering; "" for none. */
export const NOTES_OPENERS = [
  "", "Hmm.", "Mm-hm.", "Oh, nice.", "Ooh.", "Oh!", "Wait, really?", "Right.", "Okay.", "Exactly.", "Interesting.", "Huh.",
  "Hmm, not quite.", "Good question.", "Fair point.", "Yes!", "I see.",
] as const;

/** Coordinates use the unit square of the lesson, independent of zoom, screen size or device pixels. */
export const tutorMarkSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,24}$/),
  kind: z.enum(["arrow", "circle", "box", "label", "stroke"]),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(100),
  text: z.string().max(120),
  color: z.enum(["cyan", "pink", "yellow", "white"]),
}).strict();
export type TutorMark = z.infer<typeof tutorMarkSchema>;
export const tutorVisualSchema = z.object({
  marks: z.array(tutorMarkSchema).max(16),
  clear: z.boolean(),
  seekMs: z.number().int().min(0).max(86_400_000).nullable(),
  playback: z.enum(["play", "pause"]).nullable(),
}).strict();
export type TutorVisual = z.infer<typeof tutorVisualSchema>;
export const diagramSchema = z.object({
  nodes: z.array(z.object({ id: z.string().max(24), label: z.string().max(100), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(12),
  edges: z.array(z.object({ from: z.string().max(24), to: z.string().max(24), label: z.string().max(60) }).strict()).max(20),
}).strict();
export type NoteDiagram = z.infer<typeof diagramSchema>;
export const notesSpatialSchema = z.object({
  pointer: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().nullable(),
  marks: z.array(tutorMarkSchema).max(32),
  selectedText: z.string().max(2_000),
  // A single explicitly shared frame; never stored in notes or conversation history.
  frame: z.string().max(700_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).nullable(),
}).strict();
export type NotesSpatial = z.infer<typeof notesSpatialSchema>;

/** What the companion returns each turn: the spoken reply first, so speech can start while the edits are still being written. */
export const notesModelOutputSchema = z.object({ opener: z.enum(NOTES_OPENERS), say: z.string().max(1_200), ops: z.array(noteOpSchema).max(24), visual: tutorVisualSchema }).strict();
export type NotesModelOutput = z.infer<typeof notesModelOutputSchema>;

/** The reply as spoken: the opener, a sentence of its own so it is voiced on its own, then the rest. */
export const spokenReply = (opener: string, say: string): string => [opener, say.trim()].filter(Boolean).join(" ");

export type NoteTurn = { you: string; luna: string };
export type NotesView = { revision: number; blocks: NoteBlock[]; turns: NoteTurn[]; canUndo: boolean };

export const notesTurnRequestSchema = z.object({ utterance: z.string().trim().min(1).max(4_000), positionMs: z.number().int().min(0).nullable(), spatial: notesSpatialSchema.optional() }).strict();
export type NotesTurnRequest = z.infer<typeof notesTurnRequestSchema>;
export const notesEditRequestSchema = z.union([
  z.object({ ops: z.array(noteOpSchema).min(1).max(20) }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
]);
export type NotesEditRequest = z.infer<typeof notesEditRequestSchema>;

/** `say` grows as the reply streams; `done` carries the notes after the turn's edits. */
export type NotesStreamEvent = { type: "say"; text: string } | { type: "done"; say: string; notes: NotesView; visual: TutorVisual } | { type: "error"; message: string };

/**
 * Applies edits made against `baseRevision`, as revision `revision`. An edit is skipped, never forced, when its target is
 * gone, its id is taken, or the companion would change a block the learner edited after the companion read the notes.
 */
export function applyNoteOps(blocks: NoteBlock[], ops: NoteOp[], actor: NoteActor, revision: number, baseRevision: number): { blocks: NoteBlock[]; applied: number } {
  const next = blocks.map((block) => ({ ...block }));
  let applied = 0;
  for (const op of ops) {
    const index = next.findIndex((block) => block.id === op.id);
    if (op.action === "insert") {
      const text = op.text?.trim();
      if (index >= 0 || !text || next.length >= NOTES_MAX_BLOCKS) continue;
      const after = op.after === null ? -1 : next.findIndex((block) => block.id === op.after);
      const block: NoteBlock = { id: op.id, type: op.type ?? "paragraph", text, done: op.done ?? false, by: actor, rev: revision };
      next.splice(after >= 0 ? after + 1 : next.length, 0, block);
      applied += 1;
      continue;
    }
    const target = next[index];
    if (!target) continue;
    if (actor === "luna" && target.by === "you" && target.rev > baseRevision) continue;
    if (op.action === "move") {
      if (op.after === target.id) continue;
      next.splice(index, 1);
      const after = op.after === null ? -1 : next.findIndex((block) => block.id === op.after);
      next.splice(after >= 0 ? after + 1 : next.length, 0, { ...target, by: actor, rev: revision });
    } else if (op.action === "delete") next.splice(index, 1);
    else next[index] = { ...target, type: op.type ?? target.type, text: op.text?.trim() || target.text, done: op.done ?? target.done, by: actor, rev: revision };
    applied += 1;
  }
  return { blocks: next, applied };
}

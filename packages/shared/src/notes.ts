import { z } from "zod";

/** Bumped whenever the companion's prompt or output contract changes. */
export const NOTES_CONTRACT_VERSION = "notes-v11";
export const NOTES_MAX_BLOCKS = 3_000;
// Room for a styled diagram's JSON; prose blocks are far shorter.
export const NOTES_MAX_TEXT = 6_000;

/**
 * idea: a claim still under debate; decision: a conclusion the learner reached and can defend; question: a challenge still open.
 * step: one numbered step of a process; eli5: the idea in plain words, by analogy; example: a worked example or real use;
 * takeaway: a definition or point worth remembering; aside: context from beyond the video. code: a language name, a newline,
 * then the code; table: a Markdown table.
 */
export const noteBlockTypeSchema = z.enum([
  "heading", "subheading", "paragraph", "bullet", "step", "task", "idea", "decision", "question", "eli5", "example", "takeaway", "aside",
  "diagram", "image", "link", "code", "table",
]);
export type NoteBlockType = z.infer<typeof noteBlockTypeSchema>;
export type NoteActor = "you" | "luna";
/** `rev` is the notes revision that last changed the block and `by` who changed it, so a stale edit never overwrites a newer one. */
export type NoteBlock = { id: string; type: NoteBlockType; text: string; done: boolean; by: NoteActor; rev: number; anchors?: import("./contracts.js").PaperCitationAnchor[] };

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
export type NoteOp = z.infer<typeof noteOpSchema> & { anchors?: import("./contracts.js").PaperCitationAnchor[] };

/** Luny moving the lesson: a seek, play or pause, written inline in her speech. */
export const lessonControlSchema = z.object({
  seekMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  playback: z.enum(["play", "pause"]).nullable().optional(),
  page: z.number().int().positive().optional(),
  sectionId: z.string().min(1).max(200).optional(),
  chunkId: z.string().uuid().optional(),
  highlight: z.boolean().optional(),
  /** A bibliography entry to open, by its number in the paper's reference list. */
  reference: z.number().int().min(1).max(2_000).optional(),
}).strict()
  .refine((control) => control.seekMs !== undefined || control.playback !== undefined || control.page !== undefined || control.sectionId !== undefined || control.chunkId !== undefined || control.highlight !== undefined || control.reference !== undefined, "A lesson control needs an action.")
  .refine((control) => !((control.seekMs !== undefined || control.playback !== undefined) && (control.page !== undefined || control.sectionId !== undefined || control.chunkId !== undefined || control.highlight !== undefined || control.reference !== undefined)), "A lesson control cannot mix video and paper actions.");
export type LessonControl = z.infer<typeof lessonControlSchema>;
export const DIAGRAM_COLORS = ["mint", "blue", "violet", "rose", "amber", "slate"] as const;
export const DIAGRAM_SHAPES = ["box", "pill", "circle"] as const;
/**
 * A diagram block's text. Node centres are fractions of the diagram, so the scribe can place them; the learner can then move,
 * resize, recolour and reshape them (w and h in pixels), and set the diagram's height. Unset styling is the default.
 */
export const diagramSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().max(24),
    label: z.string().max(100),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().int().min(48).max(480).optional(),
    h: z.number().int().min(28).max(320).optional(),
    color: z.enum(DIAGRAM_COLORS).optional(),
    shape: z.enum(DIAGRAM_SHAPES).optional(),
  }).strict()).min(1).max(30),
  edges: z.array(z.object({ from: z.string().max(24), to: z.string().max(24), label: z.string().max(60) }).strict()).max(40),
  height: z.number().int().min(160).max(800).optional(),
}).strict();
export type NoteDiagram = z.infer<typeof diagramSchema>;
/** The study guide written from the video before the learner arrives: the page's first blocks, in order. */
export const NOTES_GUIDE_MAX_BLOCKS = 150;
export const notesGuideOutputSchema = z.object({
  blocks: z.array(z.object({ type: noteBlockTypeSchema, text: z.string().max(NOTES_MAX_TEXT), cite: z.array(z.number().int().positive()).max(4).nullable() }).strict()).min(1).max(NOTES_GUIDE_MAX_BLOCKS),
}).strict();
export type NotesGuideOutput = z.infer<typeof notesGuideOutputSchema>;
/**
 * Where the video's study guide stands. pending: not written yet, and it can be; writing: being written now; waiting: the
 * transcript is still coming; unavailable: the video has no transcript to write from; failed: the last try did not finish.
 */
export type NotesGuideStatus = "pending" | "writing" | "ready" | "waiting" | "unavailable" | "failed";

/** What the scribe returns: the edits that bring the notebook up to date with the conversation; often none. */
export const scribeNoteOpSchema = noteOpSchema.extend({ cite: z.array(z.number().int().positive()).max(4).nullable() }).strict();
export const notesScribeOutputSchema = z.object({ ops: z.array(scribeNoteOpSchema).max(24) }).strict();
export type NotesScribeOutput = z.infer<typeof notesScribeOutputSchema>;

/** One spoken line of the session's conversation, kept for good. */
export type NoteLine = { speaker: NoteActor; text: string };
export type NotesView = { revision: number; blocks: NoteBlock[]; canUndo: boolean; guide: NotesGuideStatus };

/**
 * One spoken turn with Luny. `utterance` is what the learner said since Luny last answered, or null when Luny opens the
 * conversation; `frame` is a JPEG of the lesson as it is on their screen.
 */
const voiceCueSchema = z.enum(["waiting", "idle"]).nullable().optional();
const paperVoiceAnchorSchema = z.object({
  kind: z.literal("paper"),
  page: z.number().int().positive().optional(),
  sectionId: z.string().min(1).max(200).optional(),
  chunkId: z.string().uuid().optional(),
}).strict().refine((anchor) => anchor.page !== undefined || anchor.sectionId !== undefined, "A paper anchor needs a page or section.");
export const voiceTurnRequestSchema = z.union([z.object({
  utterance: z.string().trim().min(1).max(4_000).nullable(),
  positionMs: z.number().int().min(0).max(86_400_000).nullable(),
  playing: z.boolean(),
  frame: z.string().max(2_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).nullable(),
  /** Set on a turn the learner did not start: they paused the video, silent, after watching from here, and Luny may chime in. */
  watchedFromMs: z.number().int().min(0).max(86_400_000).nullable(),
  /**
   * Also set on a turn the learner did not start. `waiting`: Luny let their last words go by as unfinished, and they have
   * since gone quiet, so she now answers them. `idle`: nobody has spoken for a while with the video paused, and she may
   * pick the talk back up once.
   */
  cue: voiceCueSchema,
}).strict(), z.object({
  utterance: z.string().trim().min(1).max(4_000).nullable(),
  anchor: paperVoiceAnchorSchema,
  selection: z.string().trim().max(4_000).nullable().optional(),
  cue: voiceCueSchema,
}).strict()]);
export type VoiceTurnRequest = z.infer<typeof voiceTurnRequestSchema>;
/**
 * The turn as it streams back: what Luny says, a sentence fragment at a time, and any seek, play or pause, then the end.
 * A `say` marked `final` (with no text) comes as soon as her reply is complete, so its last sentence is spoken while the
 * exchange is saved; `done` once it is. It is a `say` so that a page loaded before it existed reads it as nothing new.
 */
export type VoiceTurnEvent = { type: "say"; text: string; final?: true } | { type: "control"; control: LessonControl } | { type: "done" } | { type: "error"; message: string };
/**
 * A scribe pass as it streams back: each edit as soon as the model has written it whole, made against the notes at
 * revision `base`, for showing while the pass runs; then the saved notes, which are what the page keeps.
 */
export type ScribeEvent = { type: "op"; op: NoteOp; base: number } | { type: "notes"; notes: NotesView } | { type: "error"; message: string; status: number };
export const notesEditRequestSchema = z.union([
  z.object({ ops: z.array(noteOpSchema).min(1).max(20) }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
]);
export type NotesEditRequest = z.infer<typeof notesEditRequestSchema>;

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
      const block: NoteBlock = { id: op.id, type: op.type ?? "paragraph", text, done: op.done ?? false, by: actor, rev: revision, ...(op.anchors ? { anchors: op.anchors } : {}) };
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
    else next[index] = { ...target, ...(op.anchors ? { anchors: op.anchors } : {}), type: op.type ?? target.type, text: op.text?.trim() || target.text, done: op.done ?? target.done, by: actor, rev: revision };
    applied += 1;
  }
  return { blocks: next, applied };
}

/** The notebook as the models read it, one block per line with its id and type; read fresh for every turn. */
export const notebookText = (blocks: NoteBlock[]): string => blocks.length
  ? blocks.map((block) => `${block.id} | ${block.type}${block.type === "task" ? (block.done ? " [x]" : " [ ]") : ""}${block.by === "luna" ? "" : " | written by the learner"} | ${block.text.replace(/</g, "‹").replace(/>/g, "›").replace(/\n/g, "\\n")}`).join("\n")
  : "(empty)";

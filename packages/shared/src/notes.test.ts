import assert from "node:assert/strict";
import test from "node:test";
import { diagramSchema, lessonControlSchema, voiceTurnRequestSchema, applyNoteOps, type NoteBlock, type NoteOp } from "./notes.js";

const op = (value: Partial<NoteOp> & Pick<NoteOp, "action" | "id">): NoteOp => ({ after: null, type: null, text: null, done: null, ...value });
const block = (id: string, by: NoteBlock["by"], rev: number): NoteBlock => ({ id, type: "paragraph", text: id, done: false, by, rev });

test("inserts after a block or at the end, and skips taken ids and empty text", () => {
  const { blocks, applied } = applyNoteOps([block("a", "you", 1), block("b", "you", 1)], [
    op({ action: "insert", id: "c", after: "a", type: "idea", text: " maybe " }),
    op({ action: "insert", id: "d", text: "end" }),
    op({ action: "insert", id: "a", text: "dup" }),
    op({ action: "insert", id: "e", text: "  " }),
  ], "luna", 2, 1);
  assert.deepEqual(blocks.map((item) => item.id), ["a", "c", "b", "d"]);
  assert.equal(applied, 2);
  assert.deepEqual(blocks[1], { id: "c", type: "idea", text: "maybe", done: false, by: "luna", rev: 2 });
});

test("the companion never overwrites a block the learner edited after it read the notes", () => {
  const notes = [block("mine", "you", 5), block("old", "you", 3)];
  const { blocks, applied } = applyNoteOps(notes, [
    op({ action: "update", id: "mine", text: "rewritten" }),
    op({ action: "update", id: "old", type: "decision" }),
    op({ action: "delete", id: "missing" }),
  ], "luna", 6, 4);
  assert.equal(applied, 1);
  assert.equal(blocks[0]?.text, "mine");
  assert.deepEqual(blocks[1], { id: "old", type: "decision", text: "old", done: false, by: "luna", rev: 6 });
});

test("the learner's own edits always apply", () => {
  const { blocks } = applyNoteOps([block("x", "luna", 9)], [op({ action: "update", id: "x", done: true }), op({ action: "delete", id: "x" })], "you", 10, 1);
  assert.deepEqual(blocks, []);
});

test("voice turns, Luny's lesson controls and diagrams are bounded before they reach the model or the page", () => {
  const turn = { utterance: "Why fixed?", positionMs: 1200, playing: false, frame: "data:image/jpeg;base64,/9j/4AAQ", watchedFromMs: null };
  assert.equal(voiceTurnRequestSchema.safeParse(turn).success, true);
  assert.equal(voiceTurnRequestSchema.safeParse({ ...turn, utterance: null, watchedFromMs: 600_000, cue: "idle" }).success, true, "Luny picks the talk back up");
  assert.equal(voiceTurnRequestSchema.safeParse({ ...turn, cue: "nudge" }).success, false);
  assert.equal(voiceTurnRequestSchema.safeParse({ ...turn, utterance: null, frame: null }).success, true, "Luny opens the conversation");
  assert.equal(voiceTurnRequestSchema.safeParse({ ...turn, utterance: "   " }).success, false);
  assert.equal(voiceTurnRequestSchema.safeParse({ ...turn, frame: "https://example.com/frame.jpg" }).success, false);
  assert.equal(voiceTurnRequestSchema.safeParse({ ...turn, marks: "" }).success, false, "drawing on the lesson is gone");
  assert.equal(lessonControlSchema.safeParse({ seekMs: 70_000, playback: null }).success, true);
  assert.equal(lessonControlSchema.safeParse({ seekMs: -1, playback: "rewind" }).success, false);
  assert.equal(diagramSchema.safeParse({ nodes: [{ id: "x", label: "Loss", x: .5, y: .5 }], edges: [] }).success, true);
  assert.equal(diagramSchema.safeParse({ nodes: [{ id: "x", label: "Loss", x: .5, y: .5, w: 160, h: 60, color: "rose", shape: "pill" }], edges: [], height: 420 }).success, true, "the learner's styling");
  assert.equal(diagramSchema.safeParse({ nodes: [{ id: "x", label: "Loss", x: .5, y: .5, color: "red" }], edges: [] }).success, false);
  assert.equal(diagramSchema.safeParse({ nodes: [{ id: "x", label: "Loss", x: .5, y: .5, w: 4 }], edges: [] }).success, false);
});


test("voice can reorder existing notes and cannot move a stale learner edit", () => {
  const original = [block("a", "you", 1), block("b", "you", 4), block("c", "luna", 2)];
  const moved = applyNoteOps(original, [op({ action: "move", id: "a", after: "b" }), op({ action: "move", id: "b", after: null })], "luna", 5, 2);
  assert.deepEqual(moved.blocks.map((item) => item.id), ["b", "a", "c"]);
  assert.equal(moved.applied, 1);
  assert.equal(moved.blocks[1]?.text, "a");
});

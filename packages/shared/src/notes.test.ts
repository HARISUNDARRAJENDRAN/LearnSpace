import assert from "node:assert/strict";
import test from "node:test";
import { diagramSchema, notesTurnRequestSchema, tutorVisualSchema, applyNoteOps, type NoteBlock, type NoteOp, NOTES_OPENERS, spokenReply } from "./notes.js";

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

test("every opener is a sentence of its own, so it is voiced before the rest of the reply", () => {
  for (const opener of NOTES_OPENERS.filter(Boolean)) assert.match(opener, /^[A-Z].*[.!?]$/);
  assert.equal(spokenReply("Hmm, not quite.", "What about negatives? "), "Hmm, not quite. What about negatives?");
  assert.equal(spokenReply("", "Only the rest."), "Only the rest.");
  assert.equal(spokenReply("", ""), "");
});


test("spatial turns bound coordinates and image payloads before they reach the tutor", () => {
  const spatial = { pointer: { x: .5, y: .25 }, marks: [], selectedText: "hypotenuse", frame: "data:image/jpeg;base64,YWJj" };
  assert.equal(notesTurnRequestSchema.safeParse({ utterance: "Explain this", positionMs: 1200, spatial }).success, true);
  assert.equal(notesTurnRequestSchema.safeParse({ utterance: "Explain this", positionMs: 1200, spatial: { ...spatial, pointer: { x: 2, y: .25 } } }).success, false);
  assert.equal(notesTurnRequestSchema.safeParse({ utterance: "Explain this", positionMs: 1200, spatial: { ...spatial, frame: "https://example.com/private" } }).success, false);
  assert.equal(notesTurnRequestSchema.safeParse({ utterance: "Explain this", positionMs: 1200, spatial: { ...spatial, frame: "data:image/jpeg;base64," + "a".repeat(700_000) } }).success, false);
  assert.equal(tutorVisualSchema.safeParse({ marks: [{ id: "arrow", kind: "arrow", points: [{ x: .1, y: .2 }, { x: .8, y: .6 }], text: "Hypotenuse", color: "cyan" }], clear: false, seekMs: null, playback: null }).success, true);
  assert.equal(diagramSchema.safeParse({ nodes: [{ id: "x", label: "Loss", x: .5, y: .5 }], edges: [] }).success, true);
});


test("voice can reorder existing notes and cannot move a stale learner edit", () => {
  const original = [block("a", "you", 1), block("b", "you", 4), block("c", "luna", 2)];
  const moved = applyNoteOps(original, [op({ action: "move", id: "a", after: "b" }), op({ action: "move", id: "b", after: null })], "luna", 5, 2);
  assert.deepEqual(moved.blocks.map((item) => item.id), ["b", "a", "c"]);
  assert.equal(moved.applied, 1);
  assert.equal(moved.blocks[1]?.text, "a");
});

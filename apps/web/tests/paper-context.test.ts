import assert from "node:assert/strict";
import test from "node:test";
import { paperCitationAnchorSchema, studyAnchorSchema } from "@learnspace/shared/contracts";
import { lessonControlSchema, voiceTurnRequestSchema } from "@learnspace/shared/notes";
import { tutorTurnRequestSchema } from "@learnspace/shared/tutor";
import { parseCommand } from "../lib/notes/commands";
import { groundOutput } from "../lib/tutor/grounding";
import { paperCitationAnchors, paperReferenceOrdinals, rankPaperPassages, type PaperEvidence, type PaperPassage } from "../lib/research/paper-context";

const passage = (chunkId: string, ordinal: number, page: number, sectionId: string, content = "text"): PaperPassage => ({
  chunkId, ordinal, type: "paragraph", content, tokenCount: 10, headingPath: [sectionId], page, sectionId, citations: [], latex: null,
});

test("paper retrieval ranks matching passages first and uses section proximity for ties", () => {
  const passages = [passage("00000000-0000-4000-8000-000000000001", 0, 2, "background"), passage("00000000-0000-4000-8000-000000000002", 1, 9, "method")];
  const ranked = rankPaperPassages(passages, new Map([[passages[0]!.chunkId, 0.7]]), { page: 9, sectionId: "method" });
  assert.deepEqual(ranked.map(({ chunkId }) => chunkId), [passages[0]!.chunkId, passages[1]!.chunkId]);
  const nearby = rankPaperPassages(passages, new Map(), { page: 9, sectionId: "method" });
  assert.equal(nearby[0]?.chunkId, passages[1]!.chunkId);
});

test("paper citations include explicit and passage bibliography ordinals once", () => {
  const cited: PaperEvidence[] = [
    { chunkId: "00000000-0000-4000-8000-000000000001", ordinal: 0, content: "text", anchor: { kind: "paper", page: 1, sectionId: "intro", chunkId: "00000000-0000-4000-8000-000000000001" }, citations: [2, 3], tokenCount: 1 },
    { chunkId: "00000000-0000-4000-8000-000000000002", ordinal: 1, content: "text", anchor: { kind: "paper", page: 2, sectionId: "method", chunkId: "00000000-0000-4000-8000-000000000002" }, citations: [3, 5], tokenCount: 1 },
  ];
  assert.deepEqual(paperReferenceOrdinals("How does [2] relate to reference 5?", cited), [2, 5, 3]);
});

test("paper passage numbers map to deduplicated, validated citation anchors", () => {
  const first = { kind: "paper" as const, page: 3, sectionId: "method", chunkId: "00000000-0000-4000-8000-000000000001" };
  const second = { kind: "paper" as const, page: 4, sectionId: "results", chunkId: "00000000-0000-4000-8000-000000000002" };
  assert.deepEqual(paperCitationAnchors([2, 1, 2, 99], [{ anchor: first }, { anchor: second }]), [second, first]);

  const answer = groundOutput({ outcome: "answer", blocks: [{ type: "text", basis: "source", text: "The method changes the result.", cite: [2] }], followUps: [] }, [
    { chunkId: first.chunkId, ordinal: 0, startMs: null, endMs: null, content: "Method details", anchor: first },
    { chunkId: second.chunkId, ordinal: 1, startMs: null, endMs: null, content: "Results details", anchor: second },
  ]);
  assert.deepEqual(answer.sources[0]?.anchor, second);
});

test("paper anchors validate the study position and strict citation shape", () => {
  const chunkId = "00000000-0000-4000-8000-000000000001";
  assert.equal(studyAnchorSchema.safeParse({ kind: "paper", page: 4, sectionId: "3-2", chunkId }).success, true);
  assert.equal(studyAnchorSchema.safeParse({ kind: "paper", page: 4, chunkId }).success, true);
  assert.equal(paperCitationAnchorSchema.safeParse({ kind: "paper", page: 4, sectionId: "3-2", chunkId }).success, true);
  assert.equal(paperCitationAnchorSchema.safeParse({ kind: "paper", page: 4, chunkId }).success, false);
});

test("paper voice commands parse as reader controls", () => {
  assert.deepEqual(parseCommand("page 9"), { page: 9 });
  assert.deepEqual(parseCommand("section 3-2-attention"), { sectionId: "3-2-attention" });
  // A highlight names a passage of this turn's evidence, never a raw id; one it was not shown is ignored.
  const passages = [{ chunkId: "00000000-0000-4000-8000-000000000001", anchor: { page: 4, sectionId: "3-2" } }];
  const control = parseCommand("highlight 1", passages);
  assert.deepEqual(control, { chunkId: "00000000-0000-4000-8000-000000000001", page: 4, sectionId: "3-2", highlight: true });
  assert.equal(lessonControlSchema.safeParse(control).success, true);
  assert.equal(parseCommand("highlight 2", passages), null);
  assert.equal(parseCommand("highlight 00000000-0000-4000-8000-000000000001", passages), null);
  assert.deepEqual(parseCommand("reference 12"), { reference: 12 });
  assert.equal(lessonControlSchema.safeParse({ reference: 12 }).success, true);
  assert.equal(lessonControlSchema.safeParse({ reference: 12, seekMs: 0 }).success, false);
  assert.equal(lessonControlSchema.safeParse({ page: 4, playback: "pause" }).success, false);
  assert.equal(lessonControlSchema.safeParse({ page: 4, highlight: false }).success, true);
});

test("paper study requests use page and selection anchors, with no video position fields", () => {
  const idempotencyKey = "paper-question-1";
  assert.equal(tutorTurnRequestSchema.safeParse({ question: "Why this method?", idempotencyKey, anchor: { kind: "paper", page: 4, sectionId: "method", chunkId: "00000000-0000-4000-8000-000000000001" } }).success, true);
  assert.equal(tutorTurnRequestSchema.safeParse({ question: "Why this method?", idempotencyKey, positionMs: 4 }).success, true);
  assert.equal(voiceTurnRequestSchema.safeParse({ utterance: "Explain this part", anchor: { kind: "paper", page: 4, sectionId: "method" }, selection: "selected words", cue: null }).success, true);
  assert.equal(voiceTurnRequestSchema.safeParse({ utterance: "Explain this part", anchor: { kind: "paper", page: 4 }, positionMs: 4 }).success, false);
});

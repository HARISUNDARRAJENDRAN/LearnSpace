import assert from "node:assert/strict";
import test from "node:test";
import type { NoteBlock } from "@learnspace/shared/notes";
import { buildGuidePrompt, guideParts, notebookWindow } from "../lib/notes/prompt";

const lecture = (hours: number) => Array.from({ length: hours * 60 }, (_, minute) => ({ startMs: minute * 60_000, content: `minute ${minute} `.padEnd(1_000, "x") }));

test("a long lecture's guide is written in parts that cover all of it, in order", () => {
  assert.equal(guideParts(lecture(1)).length, 1, "an hour is one part");
  const day = lecture(24);
  const parts = guideParts(day);
  assert.ok(parts.length >= 14 && parts.length <= 18, `${parts.length} parts`);
  assert.deepEqual(parts.flat(), day, "every chunk once, in order");
  const sizes = parts.map((part) => part.reduce((sum, chunk) => sum + chunk.content.length, 0));
  assert.ok(Math.max(...sizes) <= 100_000, "each part fits one writer");
  assert.equal(parts.at(-1)!.at(-1)!.startMs, 1_439 * 60_000, "the last part reaches the end");
  const middle = buildGuidePrompt({ lesson: "<lesson/>", durationMs: 86_400_000, part: { index: 3, count: parts.length, fromMs: 18_000_000, toMs: 23_400_000 } });
  assert.match(middle, /part 4 of \d+: the stretch from 5:00:00 to 6:30:00/);
  assert.match(middle, /Do not open with an introduction/);
  assert.doesNotMatch(buildGuidePrompt({ lesson: "<lesson/>", durationMs: 600_000, part: { index: 0, count: 1, fromMs: 0, toMs: 600_000 } }), /part 1 of/, "a one-part guide is written as before");
});

test("a long notebook shows the sections around the learner in full and the rest as headings", () => {
  const blocks: NoteBlock[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    blocks.push({ id: `h${hour}`, type: "heading", text: `Topic ${hour} [${hour}:00:00]`, done: false, by: "luna", rev: 1 });
    for (let item = 0; item < 40; item += 1) blocks.push({ id: `p${hour}-${item}`, type: "paragraph", text: `Hour ${hour} detail ${item} `.padEnd(400, "."), done: false, by: "luna", rev: 1 });
  }
  blocks.push({ id: "mine", type: "bullet", text: "My own note", done: false, by: "you", rev: 2 });
  const text = notebookWindow(blocks, 15 * 3_600_000 + 60_000);
  assert.ok(text.length <= 64_000, `${text.length} chars`);
  assert.match(text, /p15-39 \| paragraph/, "the learner's section in full");
  assert.doesNotMatch(text, /p0-5 \| paragraph/, "a far section is cut to its heading");
  for (let hour = 0; hour < 24; hour += 1) assert.match(text, new RegExp(`h${hour} \\| heading`), "every heading stays, as the outline");
  assert.match(text, /mine \| bullet \| written by the learner/, "the learner's own notes are always shown");
  const short = blocks.slice(0, 10);
  assert.doesNotMatch(notebookWindow(short, 0), /not shown/, "a normal page is shown whole");
});

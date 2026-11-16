import assert from "node:assert/strict";
import test from "node:test";
import { applyNoteOps, type NoteBlock } from "@learnspace/shared/notes";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { fromFlow, parseDiagram, serialize, toFlow } from "../components/study/diagram";
import { safeNoteUrl, tableRows } from "../components/study/note-text";
import { diffBlocks, type PageBlock, replaceChanged } from "../components/study/notes-diff";
import { listenGeneration } from "../components/study/speech-model";
import { chimeDue, chunkEnd } from "../components/study/useLunaVoice";
import { BARGE_IN_MS, END_SILENCE_MS, Endpointer, FRAME, FRAME_MS, GUESS_SILENCE_MS, MIN_SPEECH_MS, type Utterance } from "../components/study/voice/vad";
import { isLecture, parseCommand, splitReply } from "../lib/notes/commands";

test("note media accepts published HTTPS sources without running generated markup", () => {
  assert.deepEqual(safeNoteUrl("https://example.com/diagram.png\nSource caption"), { url: "https://example.com/diagram.png", caption: "Source caption" });
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>", "http://example.com", "https://user:password@example.com"]) assert.equal(safeNoteUrl(url), null);
});

test("a table block reads as its header and rows, without the Markdown rule row", () => {
  assert.deepEqual(tableRows("| Rate | Effect |\n|:---|---:|\n| Small | **Slow** |\n\nLarge | $x^2$"), [["Rate", "Effect"], ["Small", "**Slow**"], ["Large", "$x^2$"]]);
});

test("the editor saves exactly the learner's changes, in the page's order", () => {
  const block = (id: string, text = id, type: NoteBlock["type"] = "paragraph"): NoteBlock => ({ id, type, text, done: false, by: "luna", rev: 1 });
  const saved = ["a", "b", "c", "d", "e"].map((id) => block(id));
  const pages: PageBlock[][] = [
    saved,
    [block("a"), block("c"), block("b", "b changed"), block("d"), block("e")],
    [block("e"), block("a"), block("n1", "new"), block("b"), block("d", "", "paragraph")],
    [block("b", "b", "heading"), { ...block("t1", "a task", "task"), done: true }, block("c"), block("a")],
    [block("blank", "   ")],
    [block("n0", "typed above everything"), block("a"), block("b"), block("c"), block("d"), block("e")],
    [block("e"), block("d"), block("c"), block("b"), block("a")],
  ];
  for (const page of pages) {
    const ops = diffBlocks(saved, page);
    const { blocks } = applyNoteOps(saved, ops, "you", 2, 1);
    const kept = page.filter((item) => item.text.trim());
    assert.deepEqual(blocks.map((item) => [item.id, item.type, item.text, item.done]), kept.map((item) => [item.id, item.type, item.text.trim(), item.done]));
  }
  assert.deepEqual(diffBlocks(saved, saved), [], "an unchanged page saves nothing");
  // Swapping two blocks is one move, so Luny's other notes stay hers.
  assert.deepEqual(diffBlocks(saved, [block("b"), block("a"), block("c"), block("d"), block("e")]).map((op) => [op.action, op.id]), [["move", "a"]]);
});

test("Moonshine gets enough tokens for short turns, where transformers.js gives none under a second", () => {
  assert.equal(listenGeneration(8_000).max_new_tokens, 12);
  assert.equal(listenGeneration(16_000 * 1.9).max_new_tokens, 13);
  assert.equal(listenGeneration(16_000 * 10).max_new_tokens, 65);
});

test("Luny's commands seek, play or pause the lesson, and nothing else she writes does", () => {
  assert.deepEqual(parseCommand("seek 1:02:03"), { seekMs: 3_723_000, playback: null });
  assert.equal(parseCommand("seek  2:05")?.seekMs, 125_000, "spacing does not matter");
  assert.equal(parseCommand("seek 90")?.seekMs, 90_000);
  assert.deepEqual(parseCommand("pause"), { seekMs: null, playback: "pause" });
  assert.equal(parseCommand("play")?.playback, "play");
  // She no longer draws on the lesson: old drawing commands are ignored, never spoken.
  for (const ignored of ["listen", "say hello", "circle 0.1 0.2 0.4 0.5 | base", "clear"]) assert.equal(parseCommand(ignored), null);
});

test("streamed text is spoken as soon as it can't be a command, and commands are cut out whole", () => {
  const pieces = ["Look at [", "[circle 0.1 0.1 0.3 0.3 | x]] this", " part [", "[listen"];
  let text = "";
  let read = 0;
  const said: string[] = [];
  const commands: string[] = [];
  for (const piece of pieces) {
    text += piece;
    const out = splitReply(text, read, false);
    read = out.next;
    said.push(out.say);
    commands.push(...out.commands);
  }
  assert.deepEqual(said, ["Look at ", " this", " part ", ""]);
  assert.deepEqual(commands, ["circle 0.1 0.1 0.3 0.3 | x"]);
  assert.deepEqual(splitReply(text, read, true), { say: "", commands: [], next: text.length }, "an unclosed command at the end is never spoken");
  assert.deepEqual(splitReply("Two [squared]", 0, true).say, "Two [squared]", "single brackets are speech");
});

test("only the lesson's own words while it plays count as the lesson, not the learner", () => {
  const chunks = [{ startMs: 60_000, content: "The learning rate decides how big each step is." }, { startMs: 600_000, content: "Momentum adds velocity." }];
  assert.equal(isLecture("the learning rate decides how big each step is", chunks, 70_000, true), true);
  assert.equal(isLecture("the learning rate decides how big each step is", chunks, 70_000, false), false, "a paused lesson can't be heard");
  assert.equal(isLecture("why does the learning rate matter so much", chunks, 70_000, true), false);
  assert.equal(isLecture("momentum adds velocity", chunks, 70_000, true), false, "words from far away in the lesson are the learner's");
});

test("a diagram survives the editor unchanged, and keeps what the learner moved, resized and recoloured", () => {
  const text = JSON.stringify({ nodes: [{ id: "a", label: "Input", x: 0.15, y: 0.5 }, { id: "b", label: "Output", x: 0.85, y: 0.5, w: 160, color: "blue", shape: "pill" }], edges: [{ from: "a", to: "b", label: "maps" }, { from: "a", to: "gone", label: "" }] });
  const diagram = parseDiagram(text);
  assert.ok(diagram);
  const flow = toFlow(diagram);
  assert.equal(flow.edges.length, 1, "an arrow to a missing box is dropped");
  assert.deepEqual(fromFlow(flow), { ...diagram, edges: [diagram.edges[0]] });
  const [a, b] = flow.nodes;
  assert.ok(a && b);
  const edited = fromFlow({ ...flow, height: 420, nodes: [{ ...a, position: { x: 0, y: 0 }, width: 200, data: { ...a.data, color: "rose" } }, b] });
  assert.deepEqual(edited.nodes[0], { id: "a", label: "Input", x: 0.167, y: 0.057, w: 200, color: "rose" });
  assert.equal(edited.height, 420);
  assert.equal(parseDiagram(JSON.stringify(edited)) !== null, true, "what the editor saves is a valid diagram");
  assert.equal(serialize(toFlow(diagram)), serialize(toFlow(parseDiagram(serialize(toFlow(diagram))) ?? diagram)), "saving is stable");
  assert.equal(parseDiagram("{not json"), null);
});

test("Luny chimes in after a minute of new watching, and waits longer each time she goes unanswered", () => {
  assert.equal(chimeDue(59_000, 0), false);
  assert.equal(chimeDue(60_000, 0), true);
  assert.equal(chimeDue(90_000, 1), false);
  assert.equal(chimeDue(120_000, 1), true);
  // The wait stops growing at four minutes.
  assert.equal(chimeDue(240_000, 9), true);
});

test("a saved edit replaces only the notes that changed, and the page always ends up exactly as saved", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      block: { content: "text*", attrs: { id: { default: "" }, kind: { default: "paragraph" } } },
      text: {},
    },
  });
  const page = (blocks: [string, string][]) => schema.node("doc", null, blocks.map(([id, text]) => schema.node("block", { id }, text ? schema.text(text) : [])));
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)] as T;
  for (let round = 0; round < 400; round += 1) {
    const before: [string, string][] = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, at) => [`b${at}`, pick(["", "x", "same", "same", "a longer line"])]);
    const after = before.map((block) => [...block] as [string, string]);
    for (let edits = 1 + Math.floor(random() * 3); edits > 0; edits -= 1) {
      const at = Math.floor(random() * (after.length + 1));
      const change = pick(["insert", "delete", "update"]);
      if (change === "insert" || after.length === 1) after.splice(at, 0, [pick(["n", "b0", "b1"]), pick(["same", "new", ""])]);
      else if (change === "delete") after.splice(Math.min(at, after.length - 1), 1);
      else {
        const block = after[Math.min(at, after.length - 1)];
        if (block) block[1] += pick(["!", "same"]);
      }
    }
    const state = EditorState.create({ schema, doc: page(before) });
    const next = page(after);
    const tr = replaceChanged(state.tr, next);
    assert.ok(tr.doc.eq(next), `round ${round}`);
    // Notes before the first change are the very nodes the page already had, so their views are kept.
    const from = state.doc.content.findDiffStart(next.content);
    if (from !== null) state.doc.forEach((node, offset) => { if (offset + node.nodeSize <= from) assert.equal(tr.doc.nodeAt(offset), node); });
  }
  // An unchanged page is left alone.
  const state = EditorState.create({ schema, doc: page([["a", "one"], ["b", "two"]]) });
  assert.equal(replaceChanged(state.tr, page([["a", "one"], ["b", "two"]])).steps.length, 0);
  // A note added at the end leaves every note before it untouched.
  const tr = replaceChanged(state.tr, page([["a", "one"], ["b", "two"], ["c", "three"]]));
  assert.equal(tr.doc.child(0), state.doc.child(0));
  assert.equal(tr.doc.child(1), state.doc.child(1));
});

test("the endpointer guesses the words in the learner's first pause, and confirms, drops or replaces the guess as they go on", async () => {
  const run = async (scores: number[], options: { playing?: boolean; resetAt?: number } = {}) => {
    const events: (Utterance | { type: "speech"; at: number })[] = [];
    let at = 0;
    const queue = [...scores];
    const endpointer = new Endpointer({
      score: async () => queue.shift() ?? 0,
      speech: () => events.push({ type: "speech", at }),
      utterance: (message) => events.push(message),
      error: (error) => { throw error; },
    });
    endpointer.active = true;
    endpointer.playing = options.playing ?? false;
    for (let index = 0; index < scores.length; index++) {
      at = (index + 1) * FRAME_MS;
      if (index === options.resetAt) endpointer.reset(1);
      await endpointer.frame(new Float32Array(FRAME).fill(index), at);
    }
    return events;
  };
  const frames = (ms: number) => Math.ceil(ms / FRAME_MS);
  const speech = (ms: number) => Array<number>(frames(ms)).fill(0.9);
  const silence = (ms: number) => Array<number>(frames(ms)).fill(0.05);

  // One utterance: heard once long enough, guessed after a short pause, confirmed once the pause is a turn's end.
  const one = await run([...silence(100), ...speech(600), ...silence(400)]);
  assert.deepEqual(one.map((event) => event.type), ["speech", "guess", "final"]);
  const guess = one[1] as Extract<Utterance, { type: "guess" }>;
  const final = one[2] as Extract<Utterance, { type: "final" }>;
  assert.equal(final.id, guess.id);
  assert.equal(final.heard, true);
  // The guess is the speech, the frames just before it, and the pause it was guessed in: what the learner said, unclipped.
  assert.equal(guess.audio.length, (frames(100) + frames(600) + frames(GUESS_SILENCE_MS)) * FRAME);
  // The turn is timed from the learner's last word, not from when its end was confirmed.
  assert.equal(final.endedAt, (frames(100) + frames(600)) * FRAME_MS);

  // A pause the learner talks past drops its guess; the utterance goes on, and its own guess is the one confirmed.
  const resumed = await run([...speech(400), ...silence(150), ...speech(400), ...silence(400)]);
  assert.deepEqual(resumed.map((event) => event.type), ["speech", "guess", "drop", "guess", "final"]);
  const [, first, dropped, second, confirmed] = resumed as [unknown, Extract<Utterance, { type: "guess" }>, Extract<Utterance, { type: "drop" }>, Extract<Utterance, { type: "guess" }>, Extract<Utterance, { type: "final" }>];
  assert.equal(dropped.id, first.id);
  assert.equal(confirmed.id, second.id);
  assert.ok(second.audio.length > first.audio.length);

  // A blip too short to be a turn is never written down.
  assert.deepEqual(await run([...speech(MIN_SPEECH_MS - 2 * FRAME_MS), ...silence(END_SILENCE_MS + 100)]), []);
  // While Luny talks, middling speech doesn't start an utterance, and clear speech must last longer before it stops her.
  assert.deepEqual(await run([...Array<number>(frames(600)).fill(0.7), ...silence(400)], { playing: true }), []);
  const over = await run([...speech(600), ...silence(400)], { playing: true });
  assert.equal(over[0]?.type, "speech");
  assert.ok((over[0] as { at: number }).at >= BARGE_IN_MS);
  // A reset mid-utterance drops what was heard so far: the pause after it ends nothing.
  const reset = await run([...speech(400), ...silence(150), ...silence(400)], { resetAt: frames(400) + 4 });
  assert.deepEqual(reset.map((event) => event.type), ["speech", "guess", "drop"]);
});

test("Luny's first piece ends at her first clause, so she starts speaking sooner; later pieces are whole sentences", () => {
  // The reply streams in a letter at a time, as the model's text does; only the last call knows it is complete.
  const pieces = (text: string) => {
    const out: string[] = [];
    let spoken = 0;
    for (let length = 1; length <= text.length; length += 1) {
      const sofar = text.slice(0, length);
      const final = length === text.length;
      for (let end = chunkEnd(sofar, spoken, out.length === 0, final); end > 0; end = chunkEnd(sofar, spoken, out.length === 0, final)) {
        out.push(sofar.slice(spoken, end).trim());
        spoken = end;
      }
    }
    return out;
  };
  assert.deepEqual(pieces("Right — a big step jumps past the minimum. What happens to the loss?"), ["Right —", "a big step jumps past the minimum.", "What happens to the loss?"]);
  assert.deepEqual(pieces("Exactly, the steps get too big to settle."), ["Exactly,", "the steps get too big to settle."]);
  // A clause mark inside the first few letters is not a pause worth speaking alone.
  assert.deepEqual(pieces("No, it's fine."), ["No, it's fine."]);
  assert.deepEqual(pieces("So the gradient tells me the direction, and the rate the size."), ["So the gradient tells me the direction,", "and the rate the size."]);
  // While the reply still streams, a clause waits for the space after it, and a sentence for what follows.
  assert.equal(chunkEnd("Right —", 0, true, false), -1);
  assert.equal(chunkEnd("Right — a", 0, true, false), "Right — ".length);
  assert.equal(chunkEnd("It overshoots.", 0, false, false), -1);
});

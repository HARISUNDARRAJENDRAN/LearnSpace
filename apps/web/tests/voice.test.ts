import assert from "node:assert/strict";
import test from "node:test";
import { safeNoteUrl } from "../components/study/NoteMedia";
import { chunkEnd } from "../components/study/voice/useVoiceCompanion";

/** Every chunk `chunkEnd` hands to the voice for `text`, as if it arrived all at once. */
function chunks(text: string, final: boolean): string[] {
  const out: string[] = [];
  for (let from = 0, end = chunkEnd(text, 0, true, final); end > 0; from = end, end = chunkEnd(text, from, false, final)) out.push(text.slice(from, end));
  return out;
}

test("Luna speaks whole sentences, and starts on a clause when the first sentence is long", () => {
  assert.deepEqual(chunks("Nice. Why do you think so? It", false), ["Nice. ", "Why do you think so? "]);
  assert.deepEqual(chunks("Nice. Why do you think so? It", true), ["Nice. ", "Why do you think so? ", "It"]);
  assert.deepEqual(chunks("That holds for positive numbers, but what about negative ones", false), ["That holds for positive numbers, "]);
  assert.deepEqual(chunks("Hmm, wait", false), [], "a clause break this early waits for more words");
  assert.deepEqual(chunks("It is 3.5 times", false), [], "a decimal point is not a sentence end");
  assert.deepEqual(chunks("Done.", false), [], "a sentence is complete only once what follows it arrives");
  assert.deepEqual(chunks("Done.", true), ["Done."]);
  assert.deepEqual(chunks("Test “bigger is faster.” Even so", false), ["Test “bigger is faster.” "], "a sentence may end inside curly quotes");
});


test("note media accepts published HTTPS sources without running generated markup", () => {
  assert.deepEqual(safeNoteUrl("https://example.com/diagram.png\nSource caption"), { url: "https://example.com/diagram.png", caption: "Source caption" });
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>", "http://example.com", "https://user:password@example.com"]) assert.equal(safeNoteUrl(url), null);
});

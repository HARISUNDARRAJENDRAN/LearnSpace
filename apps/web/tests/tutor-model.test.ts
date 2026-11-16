import assert from "node:assert/strict";
import test from "node:test";
import { openAiTutorModel } from "../lib/ai/tutor-model";

const stream = (events: object[]) => new Response(new ReadableStream({
  start(controller) {
    for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    controller.close();
  },
}), { status: 200 });

test("a reply that opens with a preamble is spoken once: only the final answer counts", async (t) => {
  const { fetch } = globalThis;
  const key = process.env.OPENAI_API_KEY;
  t.after(() => { globalThis.fetch = fetch; process.env.OPENAI_API_KEY = key; });
  process.env.OPENAI_API_KEY = "test";
  globalThis.fetch = async () => stream([
    { type: "response.output_item.added", output_index: 0, item: { type: "message", phase: "commentary" } },
    { type: "response.output_text.delta", output_index: 0, delta: "Sure. Two cubed is eight." },
    { type: "response.output_item.added", output_index: 1, item: { type: "message", phase: "final_answer" } },
    { type: "response.output_text.delta", output_index: 1, delta: "Sure. " },
    { type: "response.output_text.delta", output_index: 1, delta: "Two cubed is eight." },
    { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 4 } } },
  ]);
  const seen: string[] = [];
  const result = await openAiTutorModel({ depth: "quick", instructions: "", developer: "", user: "", cacheKey: "test" }, { signal: new AbortController().signal, onText: (text) => seen.push(text) });
  assert.equal(result.text, "Sure. Two cubed is eight.");
  assert.deepEqual(seen, ["Sure. ", "Sure. Two cubed is eight."]);
});

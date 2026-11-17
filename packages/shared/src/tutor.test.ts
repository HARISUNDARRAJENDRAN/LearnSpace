import assert from "node:assert/strict";
import test from "node:test";
import { tutorBlockViewSchema, tutorInteractionRequestSchema, tutorModelOutputSchema, tutorOutputJsonSchema, tutorTurnRequestSchema } from "./tutor.js";

type Node = Record<string, unknown>;

function walk(node: unknown, visit: (node: Node) => void) {
  if (Array.isArray(node)) node.forEach((item) => walk(item, visit));
  else if (node && typeof node === "object") {
    visit(node as Node);
    Object.values(node).forEach((value) => walk(value, visit));
  }
}

test("the tutor output schema is valid for OpenAI strict structured outputs", () => {
  const schema = tutorOutputJsonSchema();
  assert.equal(schema.$schema, undefined);
  walk(schema, (node) => {
    assert.equal(node.const, undefined, "strict mode spells constants as enum");
    assert.equal(node.oneOf, undefined, "strict mode supports anyOf, not oneOf");
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...(node.required as string[])].sort(), Object.keys(node.properties as Node).sort(), "every property is required");
    }
  });
});

test("model output and browser views are validated by the shared schemas", () => {
  const output = { outcome: "answer", needsReasoning: false, followUps: ["Why?"], blocks: [{ type: "check", basis: "source", question: "Q?", options: ["a", "b"], answer: 1, explanation: "e", hint: "h", concept: "c", cite: [1] }], learner: { goal: null, concepts: [], openQuestions: [], nextStep: "next" } };
  assert.equal(tutorModelOutputSchema.safeParse(output).success, true);
  assert.equal(tutorModelOutputSchema.safeParse({ ...output, blocks: [{ type: "iframe", src: "https://evil.example" }] }).success, false);
  assert.equal(tutorModelOutputSchema.safeParse({ ...output, blocks: [{ type: "text", basis: "source", text: "x", cite: [1], html: "<b>x</b>" }] }).success, false);
  assert.equal(tutorBlockViewSchema.safeParse({ type: "script", id: "b0" }).success, false);
  assert.equal(tutorBlockViewSchema.safeParse({ type: "text", id: "b0", text: "x", src: [0], onClick: "alert(1)" }).success, false);
  assert.equal(tutorTurnRequestSchema.safeParse({ question: "x".repeat(1_001), positionMs: 0, idempotencyKey: "key-12345" }).success, false);
  assert.equal(tutorInteractionRequestSchema.safeParse({ action: "delete", messageId: crypto.randomUUID(), blockId: "b0" }).success, false);
  assert.equal(tutorInteractionRequestSchema.safeParse({ action: "answer", messageId: crypto.randomUUID(), blockId: "b0; DROP", choice: 0 }).success, false);
});

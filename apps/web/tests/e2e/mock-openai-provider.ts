import { createServer } from "node:http";

// A stand-in for the Responses API that answers like the tutor contract asks: from the numbered evidence it is given.
const port = Number(process.env.PORT ?? 4011);
const learner = { goal: "Understand the learning rate", concepts: [{ name: "Learning rate", status: "introduced" }], openQuestions: [], nextStep: "Check the learning rate" };

function evidenceNumber(user: string, text: string): number {
  for (const block of user.split(/\n(?=\[\d+\])/)) if (block.includes(text)) return Number(/\[(\d+)\]/.exec(block)?.[1] ?? 1);
  return 1;
}

function reply(user: string): unknown {
  const question = user.split("<question>")[1] ?? "";
  if (/capital of france/i.test(question)) return { outcome: "off_topic", blocks: [], learner };
  const rate = evidenceNumber(user, "learning rate decides");
  const overshoot = evidenceNumber(user, "overshoot");
  return {
    outcome: "answer",
    blocks: [
      { type: "concept", term: "Learning rate", definition: "How big each step against the gradient is.", cite: [rate] },
      { type: "check", question: "What happens if the learning rate is too large?", options: ["The steps overshoot and the loss can blow up", "Training stops immediately", "The gradient becomes zero"], answer: 0, explanation: "Large steps overshoot the minimum.", hint: "Think about what a big step does near the bottom.", concept: "Learning rate", cite: [overshoot] },
    ],
    learner,
  };
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    if (request.url !== "/v1/responses") {
      response.writeHead(404, { "Content-Type": "application/json" }).end('{"error":{"code":"not_found"}}');
      return;
    }
    const input = (JSON.parse(body) as { input: Array<{ role: string; content: string }> }).input;
    const text = JSON.stringify(reply(input.find((item) => item.role === "user")?.content ?? ""));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: Record<string, unknown>) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({ type: "response.created" });
    for (let index = 0; index < text.length; index += 40) send({ type: "response.output_text.delta", delta: text.slice(index, index + 40) });
    send({ type: "response.completed", response: { usage: { input_tokens: 3_000, input_tokens_details: { cached_tokens: 1_200 }, output_tokens: 1_800, output_tokens_details: { reasoning_tokens: 1_400 } } } });
    response.end();
  });
});

server.listen(port, "127.0.0.1");

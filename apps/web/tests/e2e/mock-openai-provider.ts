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
  if (/for dinner/i.test(question)) return { outcome: "off_topic", blocks: [], followUps: [], learner };
  if (/value of e\b/i.test(question)) return { outcome: "general", blocks: [{ type: "text", text: "**e** is about 2.71828, the base of the natural logarithm: $e = \\lim_{n \\to \\infty} (1 + 1/n)^n$.", cite: [] }], followUps: ["Where does e show up in growth?"], learner };
  const rate = evidenceNumber(user, "learning rate decides");
  if (/\nDoubt: /.test(question)) return { outcome: "answer", blocks: [{ type: "text", text: "Each step moves **against** the gradient because that is the way downhill.", cite: [rate] }], followUps: [], learner };
  const overshoot = evidenceNumber(user, "overshoot");
  return {
    outcome: "answer",
    blocks: [
      { type: "concept", term: "Learning rate", definition: "How big each step against the gradient is.", cite: [rate] },
      { type: "check", question: "What happens if the learning rate is too large?", options: ["The steps overshoot and the loss can blow up", "Training stops immediately", "The gradient becomes zero"], answer: 0, explanation: "Large steps overshoot the minimum.", hint: "Think about what a big step does near the bottom.", concept: "Learning rate", cite: [overshoot] },
    ],
    followUps: ["What if the learning rate is too small?"],
    learner,
  };
}

// A mastery check whose right options are all A, and a grader that wants the word "overshoot".
function mastery(instructions: string, user: string): unknown {
  if (instructions.startsWith("You grade")) {
    const correct = /overshoot/i.test(user.split("<answer>")[1] ?? "");
    return { verdict: correct ? "correct" : "incorrect", feedback: correct ? "Right: big steps overshoot the minimum." : "Say what a big step does near the minimum." };
  }
  if (instructions.startsWith("You write the learning analysis")) {
    return { summary: "You traced how the step size drives overshooting.", strengths: ["Why a large learning rate overshoots"], mistakes: [], improvements: [], practice: [{ concept: "Learning rate", question: "What does a tiny learning rate cost?", answer: "Training crawls: many more steps to reach the minimum." }] };
  }
  const choice = (n: number) => ({ type: "choice", cite: [n], concept: "Learning rate", question: `Hard question ${n}: what does a much larger learning rate do?`, options: ["It overshoots the minimum", "It stops training", "It zeroes the gradient", "It removes momentum"], answer: 0, explanation: "Large steps jump past the minimum." });
  const written = (n: number) => ({ type: "written", cite: [n], concept: "Loss growth", question: `Hard question ${n}: why can the loss grow?`, keyPoints: ["Steps overshoot the minimum"], modelAnswer: "Each step jumps past the minimum, so the loss can grow." });
  return { questions: [choice(1), choice(2), choice(3), written(3), written(4)] };
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
    const input = (JSON.parse(body) as { input: Array<{ role: string; content: string | Array<{ text: string }> }> }).input;
    const first = input[0]?.content;
    const instructions = Array.isArray(first) ? (first[0]?.text ?? "") : "";
    const content = input.find((item) => item.role === "user")?.content;
    const user = Array.isArray(content) ? content.map((part) => part.text ?? "").join("\n") : String(content ?? "");
    const developer = String(input.at(-1)?.role === "developer" ? input.at(-1)?.content ?? "" : "");
    // The notes scribe: writes the first exchange up as a paragraph and a diagram, and rewrites it when asked to.
    const scribe = () => {
      const conversation = user.split("<conversation>")[1] ?? "";
      const fields = { after: null, done: null };
      if (/Actually change/.test(conversation)) return { ops: [{ ...fields, action: "update", id: "p1", type: "paragraph", text: "Smaller steps can help avoid overshooting." }] };
      if (user.includes("p1 |")) return { ops: [] };
      return { ops: [
        { ...fields, action: "insert", id: "p1", type: "paragraph", text: "The learning rate controls the step size [1:10]." },
        { ...fields, action: "insert", id: "d1", type: "diagram", text: JSON.stringify({ nodes: [{ id: "a", label: "Gradient", x: .15, y: .5 }, { id: "b", label: "Step", x: .85, y: .5 }], edges: [{ from: "a", to: "b", label: "learning rate" }] }) },
      ] };
    };
    // The study guide: one of every kind of block the page renders, apart from a diagram (the scribe draws that one).
    const guide = () => ({ blocks: [
      { type: "heading", text: "Gradient descent [0:00]" },
      { type: "paragraph", text: "**Gradient descent** minimises a loss by repeatedly stepping against its gradient, written $\\nabla L$." },
      { type: "paragraph", text: "$$\\theta_{t+1} = \\theta_t - \\eta \\nabla L(\\theta_t)$$" },
      { type: "eli5", text: "You are on a foggy hill and want the valley: feel which way is downhill and take a step." },
      { type: "step", text: "Compute the gradient at the current weights." },
      { type: "step", text: "Move the weights a small step the other way." },
      { type: "example", text: "With $\\eta = 0.1$ and a gradient of 4, the weight moves by 0.4." },
      { type: "table", text: "| Learning rate | Effect |\n|---|---|\n| Too small | Slow progress |\n| Too large | Overshoots [2:00] |" },
      { type: "code", text: "python\nfor step in range(100):\n    w -= lr * grad(w)" },
      { type: "takeaway", text: "The gradient gives the direction; the learning rate gives the size." },
      { type: "aside", text: "Momentum and Adam are common refinements the video does not cover." },
    ] });
    // Luny out loud: plain text, with a drawing when asked for one; she listens to anything else.
    const talker = () => {
      const said = /\nLearner: (.*)$/.exec(user)?.[1] ?? null;
      // The learner went quiet after words Luny let go by: she answers them now.
      if (said === null && /they are waiting for you/.test(developer)) return "Right, so the step is the rate times the gradient.";
      if (said === null) return "Hey! What are you working through right now?";
      if (/power three/.test(said)) return "Two times two times two, so eight.";
      if (/diagram/.test(said)) return "It sets the size of each step. [[seek 1:10]]";
      if (/Actually change/.test(said)) return "Done, shorter now.";
      if (/flaky server/.test(said)) return "It will, I keep it until it is saved.";
      return "[[listen]]";
    };
    const text = instructions.startsWith("You are Luny") ? talker() : JSON.stringify(instructions.startsWith("You keep the shared notebook") ? scribe() : instructions.startsWith("You write the study guide") ? guide() : instructions.includes("mastery check") ? mastery(instructions, user) : { needsReasoning: false, ...(reply(user) as object) });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: Record<string, unknown>) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({ type: "response.created" });
    for (let index = 0; index < text.length; index += 40) send({ type: "response.output_text.delta", delta: text.slice(index, index + 40) });
    send({ type: "response.completed", response: { usage: { input_tokens: 3_000, input_tokens_details: { cached_tokens: 1_200 }, output_tokens: 1_800, output_tokens_details: { reasoning_tokens: 1_400 } } } });
    response.end();
  });
});

server.listen(port, "127.0.0.1");

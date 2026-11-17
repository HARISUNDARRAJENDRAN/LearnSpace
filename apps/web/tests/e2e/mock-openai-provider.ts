import { createServer, type ServerResponse } from "node:http";

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
  if (/value of e\b/i.test(question)) return { outcome: "general", blocks: [{ type: "text", basis: "source", text: "**e** is about 2.71828, the base of the natural logarithm: $e = \\lim_{n \\to \\infty} (1 + 1/n)^n$.", cite: [] }], followUps: ["Where does e show up in growth?"], learner };
  const rate = evidenceNumber(user, "learning rate decides");
  if (/\nDoubt: /.test(question)) return { outcome: "answer", blocks: [{ type: "text", basis: "source", text: "Each step moves **against** the gradient because that is the way downhill.", cite: [rate] }], followUps: [], learner };
  const overshoot = evidenceNumber(user, "overshoot");
  return {
    outcome: "answer",
    blocks: [
      { type: "concept", basis: "source", term: "Learning rate", definition: "How big each step against the gradient is.", cite: [rate] },
      { type: "check", basis: "source", question: "What happens if the learning rate is too large?", options: ["The steps overshoot and the loss can blow up", "Training stops immediately", "The gradient becomes zero"], answer: 0, explanation: "Large steps overshoot the minimum.", hint: "Think about what a big step does near the bottom.", concept: "Learning rate", cite: [overshoot] },
    ],
    followUps: ["What if the learning rate is too small?"],
    learner: { goal: "Understand regularized tree boosting", concepts: [{ name: "Model complexity", status: "introduced" }], openQuestions: [], nextStep: "Trace the objective terms" },
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

function paperTutor(user: string): unknown {
  const question = /<question>\s*([\s\S]*?)\s*<\/question>/.exec(user)?.[1] ?? "";
  const related = /related research|reference|citation/i.test(question);
  return {
    needsReasoning: false,
    outcome: "answer",
    blocks: [{
      type: "text",
      basis: related ? "cited_work" : "source",
      cite: [1],
      text: related
        ? "The verified bibliography identifies a related paper on tree boosting. This paper cites it while describing the method, so it is a useful next source to read."
        : "The objective balances prediction loss against a penalty for model complexity, so a new tree must improve fit enough to justify its added complexity.",
    }],
    followUps: ["Why penalize tree size?", "How does it scale?"],
    learner,
  };
}

function paperPlanner(user: string): unknown {
  const paper = JSON.parse(user) as { title?: string; abstract?: string | null; passages?: Array<{ content?: string }> };
  const gpu = paper.title === "GPU-dependent distributed boosting";
  return {
    contributions: [{
      component: gpu ? "Distributed GPU training" : "Regularized tree objective",
      mechanism: gpu
        ? "The method updates model parameters over billions of examples on a distributed GPU cluster."
        : "Each added tree reduces prediction loss while the objective penalizes unnecessary model complexity.",
      focus: gpu
        ? "A faithful training exercise would require a multi-node GPU cluster and a massive image corpus."
        : "Compute the regularized objective from prediction loss, model complexity, and regularization strength.",
      concept: "math",
      difficulty: "easy",
      cite: [1],
      feasibility: {
        feasible: !gpu,
        runtimeMs: gpu ? 120_000 : 30,
        memoryMb: gpu ? 4096 : 16,
        dependencies: ["python-stdlib"],
        educationalValue: "A small deterministic exercise makes the method's key computation concrete for a learner.",
        reason: gpu
          ? "A CPU sandbox cannot reproduce multi-node GPU training over billions of examples."
          : "A constant-time objective calculation runs deterministically within the CPU sandbox limits.",
      },
    }],
    coreMechanism: gpu
      ? "The core mechanism distributes repeated training updates across a large GPU cluster."
      : "The core mechanism balances prediction loss against a penalty for added tree complexity.",
    coreCite: [1],
  };
}

function paperProjectGuide(user: string): unknown {
  const paper = JSON.parse(user) as { title?: string };
  const gpu = paper.title === "GPU-dependent distributed boosting";
  return {
    title: gpu ? "A project around distributed training" : "A project around tree boosting",
    mechanism: gpu ? "Distributed parameter updates" : "Regularized tree boosting",
    objective: gpu
      ? "Understand how repeated updates depend on data, model state and compute."
      : "Trace how prediction loss and model complexity shape a tree update.",
    prerequisites: [{ name: "A prediction and a loss", why: "The loss measures how far a model's prediction is from its target." }],
    relationship: { text: "This mechanism is described in the paper's core method.", cite: [1] },
    motivation: {
      scenario: "A learner adds one more component to a model.",
      prediction: "What should happen if complexity grows without improving fit?",
      answer: "The regularized objective should penalize the added complexity.",
      cite: [1],
    },
    workedExample: { steps: [
      { text: "Start with prediction loss 2 and complexity penalty 0.5.", latex: null, values: null, cite: [1] },
      { text: "Add the two terms to get an objective of 2.5.", latex: null, values: [{ name: "objective", value: 2.5 }], cite: [1] },
    ] },
    explorer: {
      parameters: [],
      outputs: [{ id: "objective", label: "Toy objective", symbol: "L" }],
      functionCode: "def explore():\n    return {\"objective\": 2.5}",
      chart: null,
    },
    edgeCases: [{ setup: "The added model component changes no prediction.", prediction: "Does the objective still gain a penalty?", answer: "Yes. The complexity term can still increase the objective.", cite: [1] }],
    mapping: [
      { toy: "A single added component", fullSystem: "A tree added at one boosting iteration", cite: [1] },
      { toy: "One loss and penalty", fullSystem: "The paper's regularized objective", cite: [1] },
    ],
    caveats: [{ text: "This small example does not reproduce the full training system.", cite: [1] }],
    project: {
      steps: [
        { text: "Build a tiny synthetic example with two model updates.", cite: [1] },
        { text: "Record how prediction loss and complexity change after each update.", cite: [1] },
      ],
      expectedResults: ["A more complex model needs enough loss reduction to justify its penalty."],
      validation: "Check each objective by adding its loss and penalty terms.",
      misconceptions: ["Lower training loss alone does not guarantee a better regularized objective."],
      furtherExploration: ["Compare exact and approximate split candidates."],
      gpuReproductionPlan: gpu ? { steps: ["Use a multi-node GPU cluster.", "Train on the paper's large image corpus."] } : null,
    },
    takeaways: [
      { text: "The objective balances fit and complexity.", cite: [1] },
      { text: "A small toy explains one computation, not the whole system.", cite: [1] },
    ],
  };
}

function paperNotesGuide(): unknown {
  const labels = ["A. Research context", "B. Required foundations", "C. Core intuition", "D. Architecture and mechanisms", "E. Mathematical explanation", "F. Experiments and results", "G. Related research", "H. Practical understanding"];
  return { blocks: labels.flatMap((text) => [
    { type: "heading", text, cite: null },
    { type: "paragraph", text: "XGBoost balances prediction loss with model complexity while using systems techniques to scale tree learning.", cite: [1] },
  ]) };
}

function paperScribe(user: string): unknown {
  if (!/worked example|small example|save this insight/i.test(user)) return { ops: [] };
  return { ops: [{ action: "insert", id: "worked-example", after: null, type: "example", text: "Worked example: with prediction loss 2 and a complexity penalty of 0.5, the objective is 2.5.", done: null, cite: [1] }] };
}

function paperTalker(user: string, developer: string): string {
  const utterance = /\nLearner: ([\s\S]*)$/.exec(user)?.[1] ?? null;
  if (utterance === null) return /they are waiting for you/.test(developer) ? "The objective adds the complexity penalty to the prediction loss." : "Hi. What part of the paper are you working through?";
  if (/worked example|example/i.test(utterance)) return "Suppose the prediction loss is two and the complexity penalty is zero point five. The objective is two point five.";
  if (/equation|objective/i.test(utterance)) return "The regularized objective adds a complexity penalty to the prediction loss. A lower prediction loss can still be outweighed by unnecessary complexity.";
  return "The paper connects its method to the passages you are reading.";
}

function codingProblem(): unknown {
  const source = "def solve(loss, complexity, regularization):\n    return loss + regularization * complexity";
  return {
    title: "Compute the regularized objective",
    concept: "math",
    difficulty: "easy",
    statement: "Given the prediction loss, model complexity, and regularization strength, return the objective formed by adding the weighted complexity penalty to the loss.",
    signature: { functionName: "regularizedObjective", params: [{ name: "loss", type: "double" }, { name: "complexity", type: "double" }, { name: "regularization", type: "double" }], returns: "double" },
    compare: "exact",
    numericTolerance: { absolute: 0.000001, relative: 0.000001 },
    constraints: ["0 <= loss <= 100", "0 <= complexity <= 100", "0 <= regularization <= 10"],
    examples: [
      { args: "[2, 0.5, 1]", expected: "2.5", explanation: "Add half a unit of complexity penalty to the loss of two." },
      { args: "[1.25, 2, 0.1]", expected: "1.45", explanation: "The regularization strength weights the complexity term before it is added." },
    ],
    edgeCases: [
      { args: "[0, 0, 0]", expected: "0", why: "A zero loss and penalty keep the objective at zero." },
      { args: "[3, 0, 10]", expected: "3", why: "No model complexity means there is no penalty." },
      { args: "[0, 4, 0.5]", expected: "2", why: "A model with no prediction loss still pays its weighted complexity." },
    ],
    generator: "def generate(rng, size):\n    return [rng.uniform(0, 100), rng.uniform(0, 100), rng.uniform(0, 10)]",
    validator: "def validate(loss, complexity, regularization):\n    if not 0 <= loss <= 100 or not 0 <= complexity <= 100 or not 0 <= regularization <= 10:\n        raise ValueError('values must be within the stated ranges')",
    baseline: { approach: "Multiply complexity by regularization strength and add the loss.", time: "O(1)", space: "O(1)", code: source },
    optimal: { approach: "The same constant-time calculation is already optimal.", time: "O(1)", space: "O(1)", code: source },
    efficiencyMatters: false,
    hints: [
      { level: 1, stage: "correct", text: "Which part of the objective depends on how complex the model is?" },
      { level: 2, stage: "correct", text: "Weight the complexity term by regularization strength." },
      { level: 3, stage: "correct", text: "Multiply complexity by the regularization strength, then add the prediction loss." },
      { level: 4, stage: "correct", text: "Read the three arguments, multiply the last two, and add that product to the first." },
    ],
    misconceptions: [],
    cite: [1],
    related: [],
  };
}

// The structured chat completions (lib/ai/openai.ts structuredCompletion), told apart by their schema name.
type Evidence = { title: string; minutes: number; finished: boolean };
type PlanItem = { id: string; title: string; evidence: Evidence[] };
type Candidate = { id: string; title: string; type: string; why: string };
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

function structured(name: string, user: string): unknown {
  // Goal planning: three to-dos over the coming days, so onboarding shows the model's plan rather than the goal itself.
  if (name === "goal_todos") {
    const { goal } = JSON.parse(user) as { goal: string };
    return { todos: [
      { title: "Solve one warm-up exercise", reason: `A first small win towards: ${goal}`, kind: "practice", day: 0 },
      { title: `Watch a lesson on ${goal}`.slice(0, 160), reason: "See the idea worked through once.", kind: "watch", day: 1 },
      { title: "Review what you got wrong", reason: "Mistakes are where the learning is.", kind: "review", day: 2 },
    ] };
  }
  // A free-text plan with no kind words in it: "again" means a review, anything else is practice.
  if (name === "plan_kind") return { kind: /\bagain\b/i.test(user) ? "review" : "practice" };
  // The observer: an item is done when that day's study shares a topic word with it, and not otherwise.
  if (name === "plan_verdicts") {
    const { items } = JSON.parse(user) as { items: PlanItem[] };
    return { items: items.map((item) => {
      const topic = words(item.title);
      const match = item.evidence.find((entry) => [...words(entry.title)].some((word) => topic.has(word)));
      return match
        ? { id: item.id, progressPct: 100, done: true, note: `Covered by ${match.title} (${match.minutes} min).` }
        : { id: item.id, progressPct: 0, done: false, note: `Nothing about ${item.title} in that day's study.` };
    }) };
  }
  // The planner: one action per candidate, worded unlike the fallback's "Finish ...".
  if (name === "next_actions") {
    const { candidates } = JSON.parse(user) as { candidates: Candidate[] };
    const when = ["today", "tomorrow", "later"] as const;
    return { actions: candidates.slice(0, 3).map((candidate, index) => ({
      title: `Keep going with ${candidate.title}`.slice(0, 160), reason: `${candidate.why}; the planner picked it.`, kind: candidate.type === "video" ? "watch" : "read",
      minutes: 25, when: when[index], resourceId: candidate.id, searchQuery: candidate.title,
    })) };
  }
  // Coding classification: a transcript about recursion is a DSA lesson worth practising; anything else is not.
  if (name === "coding_profile") {
    const passage = /\[(\d+)\][^\n]*\n[^\n]*recursi/i.exec(user);
    if (!passage) return { category: "conceptual_cs", practiceFit: 0.1, language: "none", difficulty: "easy", concepts: [], reason: "Explains an idea; no code to write." };
    return { category: "dsa_lesson", practiceFit: 0.9, language: "python", difficulty: "easy", concepts: [{ concept: "recursion", focus: "Base case and recursive step", cite: [Number(passage[1])] }], reason: "Writes recursive functions step by step." };
  }
  return null;
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/v1/chat/completions") {
      const input = JSON.parse(body) as { messages: Array<{ role: string; content: string }>; response_format?: { json_schema?: { name?: string } } };
      const instructions = input.messages.find((message) => message.role === "system")?.content ?? "";
      const user = input.messages.find((message) => message.role === "user")?.content ?? "";
      const planned = structured(input.response_format?.json_schema?.name ?? "", user);
      const text = planned !== null ? JSON.stringify(planned) : instructions.startsWith("Read the parsed research paper and identify its actual technical contributions")
        ? JSON.stringify(paperPlanner(user))
        : instructions.startsWith("Write one careful project and intuition guide")
          ? JSON.stringify(paperProjectGuide(user))
          : instructions.startsWith("You write one original coding problem")
            ? JSON.stringify(codingProblem())
            : JSON.stringify(reply(user));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: text } }] }));
      return;
    }
    if (path !== "/v1/responses") {
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
      const fields = { after: null, done: null, cite: null };
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
    ].map((block) => ({ ...block, cite: null })) });
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
    const text = instructions.startsWith("You are Luny, LearnSpace's research tutor")
      ? JSON.stringify(paperTutor(user))
      : instructions.startsWith("You are Luny, a thinking partner for one learner studying a research paper")
        ? paperTalker(user, developer)
        : instructions.startsWith("You write the study guide for one research paper")
          ? JSON.stringify(paperNotesGuide())
          : instructions.startsWith("You keep the shared notebook for a learner who is studying one research paper")
            ? JSON.stringify(paperScribe(user))
            : instructions.startsWith("Read the parsed research paper and identify its actual technical contributions")
              ? JSON.stringify(paperPlanner(user))
              : instructions.startsWith("Write one careful project and intuition guide")
                ? JSON.stringify(paperProjectGuide(user))
                : instructions.startsWith("You write one original coding problem")
                  ? JSON.stringify(codingProblem())
                  : instructions.startsWith("You are Luny")
                    ? talker()
                    : JSON.stringify(instructions.startsWith("You keep the shared notebook") ? scribe() : instructions.startsWith("You write the study guide") ? guide() : instructions.includes("mastery check") ? mastery(instructions, user) : { needsReasoning: false, ...(reply(user) as object) });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: Record<string, unknown>) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({ type: "response.created" });
    for (let index = 0; index < text.length; index += 40) send({ type: "response.output_text.delta", delta: text.slice(index, index + 40) });
    send({ type: "response.completed", response: { usage: { input_tokens: 3_000, input_tokens_details: { cached_tokens: 1_200 }, output_tokens: 1_800, output_tokens_details: { reasoning_tokens: 1_400 } } } });
    response.end();
  });
});

server.listen(port, "127.0.0.1");

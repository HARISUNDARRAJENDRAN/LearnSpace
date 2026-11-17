import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { CodingConcept } from "@learnspace/shared/coding";
import type { PaperCitationAnchor } from "@learnspace/shared/contracts";
import { codingEligible } from "../coding/policy";
import { guideJsonSchema, guideWithAnchors, planPaperFromPassages, plannerJsonSchema, type PaperPlanner, type ResearchGuideDraft, verifyExplorer } from "./practice";

const anchor: PaperCitationAnchor = { kind: "paper", page: 3, sectionId: "3-attention", chunkId: randomUUID() };
const passages = [{ number: 1, content: "Scaled dot-product attention computes a softmax over query-key compatibility scores.", anchor }];

const planner: PaperPlanner = async () => ({
  contributions: [{ component: "Scaled dot-product attention", mechanism: "Scale query-key dot products before applying softmax to compute weights.", focus: "Implement one row of deterministic attention over a small tensor.", concept: "math" as CodingConcept, difficulty: "medium", cite: [1], feasibility: { feasible: true, runtimeMs: 30, memoryMb: 16, dependencies: ["python-stdlib"], educationalValue: "Shows how score scale changes the sharpness of the attention distribution.", reason: "Small vectors and a stable softmax fit a deterministic CPU exercise." } }],
  coreMechanism: "Scaled query-key dot products determine attention weights.", coreCite: [1],
});

test("planner maps numbered citations to stored anchors and marks a bounded CPU contribution feasible", async () => {
  const plan = await planPaperFromPassages({ title: "Attention", abstract: null, passages }, planner);
  assert.deepEqual(plan.contributions[0]?.anchors, [anchor]);
  assert.equal(plan.contributions[0]?.eligible, true);
  assert.equal(codingEligible("paper", { concepts: [], feasibleComponents: plan.contributions.filter((item) => item.eligible), verifiedExercises: 1 }), true);
});

test("planner rejects GPU-only feasibility and cannot fabricate an anchor", async () => {
  const gpuOnly: PaperPlanner = async () => ({
    contributions: [{ component: "Full model pretraining", mechanism: "Train a large transformer using distributed tensor parallelism.", focus: "Reproduce the full model training run.", concept: "implementation", difficulty: "hard", cite: [1], feasibility: { feasible: true, runtimeMs: 120_000, memoryMb: 4096, dependencies: ["numpy"], educationalValue: "Demonstrates the systems behavior of large-scale training.", reason: "Requires a GPU cluster to reproduce faithfully." } }],
    coreMechanism: "Distributed training synchronizes gradients across devices.", coreCite: [99],
  });
  const plan = await planPaperFromPassages({ title: "Scaling", abstract: null, passages }, gpuOnly);
  assert.equal(plan.contributions[0]?.eligible, false);
  assert.deepEqual(plan.coreAnchors, []);
  assert.equal(codingEligible("paper", { concepts: [], feasibleComponents: plan.contributions.filter((item) => item.eligible), verifiedExercises: 0 }), false);
});

function guideDraft(overrides: Partial<ResearchGuideDraft> = {}): ResearchGuideDraft {
  return {
    title: "Attention weights in miniature", mechanism: "Query-key scores produce normalized weights.", objective: "Predict the effect of scaling scores.",
    prerequisites: [], relationship: { text: "The paper uses attention to mix value vectors.", cite: [1] },
    motivation: { scenario: "Two tokens compete for focus.", prediction: "Which receives more weight?", answer: "The larger score receives more weight.", cite: [1] },
    workedExample: { steps: [{ text: "For q=[1,0], k1=[2,0], score is 2.", latex: null, values: [{ name: "q1", value: 1 }, { name: "q2", value: 0 }, { name: "k1", value: 2 }, { name: "score", value: 2 }], cite: [1] }, { text: "Scaling by sqrt(2) gives 1.414.", latex: "2/\\sqrt{2}=1.414", values: [{ name: "scaled", value: 1.414 }], cite: [1] }] },
    explorer: { parameters: [{ id: "scale", label: "Score scale", symbol: "s", values: [1, 2] }], outputs: [{ id: "weight", label: "First-token weight", symbol: "w_1" }], functionCode: "def explore(scale):\n    import math\n    return {'weight': 1 / (1 + math.exp(-2 * scale))}\n", chart: null },
    edgeCases: [{ setup: "Both scores are equal.", prediction: "Weights tie.", answer: "Each weight is 0.5.", cite: [1] }],
    mapping: [{ toy: "Two scores become weights.", fullSystem: "The paper applies this per query and head.", cite: [1] }, { toy: "One value vector is mixed.", fullSystem: "The model mixes all value vectors.", cite: [1] }],
    caveats: [{ text: "This uses two scores and does not reproduce the full model.", cite: [1] }],
    project: { steps: [{ text: "Compute two scores.", cite: [1] }, { text: "Normalize them with softmax.", cite: [1] }], expectedResults: ["Weights sum to one."], validation: "Check both weights are finite and sum to one.", misconceptions: [], furtherExploration: [], gpuReproductionPlan: null },
    takeaways: [{ text: "Scaling changes weight sharpness.", cite: [1] }, { text: "Softmax weights sum to one.", cite: [1] }],
    ...overrides,
  };
}

test("guide contract resolves model passage numbers to paper anchors and checks complete explorer tables", () => {
  const draft = guideDraft();
  const table = [{ parameters: { scale: 1 }, outputs: { weight: 0.8807970779778823 } }, { parameters: { scale: 2 }, outputs: { weight: 0.9820137900379085 } }];
  const guide = guideWithAnchors(draft, passages, table);
  assert.deepEqual(guide.relationship.anchors, [anchor]);
  assert.equal(guide.explorer.table.length, 2);
});

test("explorer verification rejects failed, non-finite and nondeterministic sandbox results", async () => {
  const draft = guideDraft();
  const report = (stdout: string, status: "ok" | "runtime_error" = "ok") => ({ compile: null, runs: [{ status, stdout, stderr: "", result: "", wallMs: 1, cpuMs: 1, maxRssKb: 100, exitCode: status === "ok" ? 0 : 1, signal: null }] });
  await assert.rejects(verifyExplorer(draft, async () => report("", "runtime_error")), /execution failed/);
  await assert.rejects(verifyExplorer(draft, async () => report('[{"parameters":{"scale":1},"outputs":{"weight":1e999}},{"parameters":{"scale":2},"outputs":{"weight":0.9}}]')), /non-finite/);
  let calls = 0;
  await assert.rejects(verifyExplorer(draft, async () => {
    calls += 1;
    return report(JSON.stringify([{ parameters: { scale: 1 }, outputs: { weight: calls } }, { parameters: { scale: 2 }, outputs: { weight: 0.9 } }]));
  }), /nondeterministic/);
});

test("planner and guide schemas are valid for OpenAI strict structured outputs", () => {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, index) => { walk(item, `${path}/${index}`); }); return; }
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    assert.equal(object.propertyNames, undefined, `${path}: strict mode forbids propertyNames (z.record)`);
    if (object.type === "object") {
      assert.equal(object.additionalProperties, false, path);
      assert.deepEqual([...(object.required as string[])].sort(), Object.keys(object.properties as object).sort(), `${path}: every property is required`);
    }
    for (const [key, value] of Object.entries(object)) walk(value, `${path}/${key}`);
  };
  walk(plannerJsonSchema, "planner");
  walk(guideJsonSchema, "guide");
});

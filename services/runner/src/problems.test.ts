import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { clearProblemCache, problemSolution, ProblemStateError, runLearner, submitLearner, verifyProblem, type ProblemRecord, type ProblemStore } from "./problems.js";
import { createDatabaseStore } from "./store.js";
import { testExecute } from "./test-sandbox.js";

const { execute, skip } = await testExecute();

/** Maximum subarray: a quadratic brute force and Kadane's linear scan, so efficiency is a stage of its own. */
const spec = {
  title: "Best Run",
  statement: "Return the largest sum of a non-empty contiguous subarray.",
  signature: { functionName: "maxSubarray", params: [{ name: "nums", type: "int[]" }], returns: "int" },
  compare: "exact",
  examples: [
    { args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expected: 6, explanation: "[4, -1, 2, 1] sums to 6." },
    { args: [[1]], expected: 1, explanation: "A single element." },
  ],
};
const authored = {
  generator: "def generate(rng, size):\n    n = rng.randint(1, 8) if size == 'small' else 100000\n    return [[rng.randint(-20, 20) if size == 'small' else rng.randint(-10000, 10000) for _ in range(n)]]\n",
  validator: "def validate(nums):\n    if not 1 <= len(nums) <= 100000:\n        raise ValueError('nums must have 1 to 100000 elements')\n    if any(abs(x) > 10000 for x in nums):\n        raise ValueError('values must be within 10000')\n",
  baseline: { approach: "Try every start and extend.", time: "O(n^2)", space: "O(1)", code: "def solve(nums):\n    best = nums[0]\n    for i in range(len(nums)):\n        s = 0\n        for j in range(i, len(nums)):\n            s += nums[j]\n            best = max(best, s)\n    return best\n" },
  optimal: { approach: "Kadane: extend the run or restart.", time: "O(n)", space: "O(1)", code: "def solve(nums):\n    best = cur = nums[0]\n    for x in nums[1:]:\n        cur = max(x, cur + x)\n        best = max(best, cur)\n    return best\n" },
  edgeCases: [
    { args: [[-3, -1, -2]], expected: -1, why: "all negative: the answer is the largest element, not 0" },
    { args: [[5, -9, 6]], expected: 6, why: "a dip that should restart the run" },
    { args: [[0]], expected: 0, why: "a single zero" },
  ],
};

function memoryStore(records: Record<string, Partial<ProblemRecord>>): ProblemStore & { records: Map<string, ProblemRecord> } {
  const map = new Map<string, ProblemRecord>();
  for (const [id, record] of Object.entries(records)) map.set(id, { id, status: "verifying", spec, authored, tests: null, perfLimitMs: null, verification: null, ...record });
  return {
    records: map,
    async load(id) {
      const record = map.get(id);
      return record ? structuredClone(record) : null;
    },
    async publish(id, result) {
      const record = map.get(id);
      if (record?.status !== "verifying") return false;
      Object.assign(record, { status: "verified", tests: result.tests, perfLimitMs: result.perfLimitMs, verification: result.verification });
      return true;
    },
    async reject(id, failure) {
      const record = map.get(id);
      if (record?.status === "verifying") Object.assign(record, { status: "rejected", verification: { failure } });
    },
  };
}

const sound = randomUUID();
const store = memoryStore({ [sound]: {} });

test("a sound problem verifies: its tests are materialized and its baseline is too slow for the large suite", { skip }, async () => {
  const result = await verifyProblem(execute, store, sound);
  assert.equal(result.status, "verified", JSON.stringify(result));
  const record = store.records.get(sound)!;
  const tests = record.tests as { small: Array<{ kind: string; expected: unknown; why?: string }>; large: unknown[] };
  assert.equal(tests.small.filter((item) => item.kind === "example").length, 2);
  assert.equal(tests.small.filter((item) => item.kind === "edge")[0]?.why, "all negative: the answer is the largest element, not 0");
  assert.ok(tests.small.filter((item) => item.kind === "random").length >= 10);
  assert.equal(tests.large.length, 3);
  assert.ok(record.perfLimitMs! >= 1_500);
  if (result.status === "verified") assert.equal(result.verification.efficiencyStage, true);
});

test("verification rejects a wrong expected output, disagreeing references and inputs that break the constraints", { skip }, async () => {
  const wrongExample = randomUUID();
  const buggyOptimal = randomUUID();
  const badGenerator = randomUUID();
  const outOfRange = randomUUID();
  const broken = memoryStore({
    [wrongExample]: { spec: { ...spec, examples: [spec.examples[0], { ...spec.examples[1], expected: 2 }] } },
    // Clamps at 0: right on most inputs, wrong when every element is negative.
    [buggyOptimal]: { authored: { ...authored, edgeCases: authored.edgeCases.slice(1), optimal: { ...authored.optimal, code: "def solve(nums):\n    best = cur = 0\n    for x in nums:\n        cur = max(0, cur + x)\n        best = max(best, cur)\n    return best\n" } } },
    [badGenerator]: { authored: { ...authored, generator: "def generate(rng, size):\n    return [[]]\n" } },
    [outOfRange]: { authored: { ...authored, edgeCases: [{ args: [[20000]], expected: 20000, why: "big" }] } },
  });
  const results = await Promise.all([wrongExample, buggyOptimal, badGenerator, outOfRange].map((id) => verifyProblem(execute, broken, id, { largeCases: 1 })));
  const failures = results.map((result) => (result.status === "rejected" ? result.failure : "verified"));
  assert.match(failures[0]!, /^example 2 expects 2 but both references return 1/);
  assert.match(failures[1]!, /references disagree/);
  assert.match(failures[2]!, /generator produced an invalid input \[\[\]\]: ValueError: nums must have 1 to 100000 elements/);
  assert.match(failures[3]!, /^edge case 1 breaks the problem's constraints: ValueError: values must be within 10000/);
  for (const id of [wrongExample, buggyOptimal, badGenerator, outOfRange]) assert.equal(broken.records.get(id)!.status, "rejected");
  await assert.rejects(verifyProblem(execute, broken, wrongExample), ProblemStateError);
});

test("when the baseline already fits the time budget, efficiency is not a separate stage", { skip }, async () => {
  const id = randomUUID();
  const linear = memoryStore({ [id]: { authored: { ...authored, baseline: { ...authored.baseline, code: "def solve(nums):\n    best = nums[0]\n    run = 0\n    for x in nums:\n        run = max(x, run + x) if run else x\n        best = max(best, run)\n    return best\n" } } } });
  const result = await verifyProblem(execute, linear, id, { largeCases: 2 });
  assert.equal(result.status, "verified", JSON.stringify(result));
  if (result.status === "verified") {
    assert.equal(result.verification.efficiencyStage, false);
    assert.equal(typeof result.verification.baselineMs, "number");
  }
});

test("Run answers the examples and the learner's own valid inputs, and says why invalid ones were skipped", { skip }, async () => {
  const code = "function maxSubarray(nums) {\n  console.log('n =', nums.length);\n  return Math.max(...nums);\n}\n";
  const result = await runLearner(execute, store, sound, { language: "javascript", code, custom: [[[2, -1, 2]], [[99999]], [["x"]]] });
  assert.equal(result.verdict, "ran");
  assert.deepEqual(result.cases.map((item) => [item.kind, item.index, item.output, item.expected, item.passed]), [
    ["example", 0, 4, 6, false],
    ["example", 1, 1, 1, true],
    ["custom", 0, 2, 3, false],
  ]);
  assert.equal(result.cases[0]!.stdout, "n = 9");
  assert.deepEqual(result.invalid.map((item) => item.index), [1, 2]);
  assert.match(result.invalid[0]!.reason, /within 10000/);
  assert.match(result.invalid[1]!.reason, /nums\[0\] must be a 32-bit integer/);
  const broken = await runLearner(execute, store, sound, { language: "python", code: "class Solution:\n    def maxSubarray(self, nums)\n        pass\n", custom: [] });
  assert.equal(broken.verdict, "compile_error");
});

test("Submit grades correctness on the small suite and efficiency on the large one, without revealing hidden tests", { skip }, async () => {
  const slow = await submitLearner(execute, store, sound, { language: "python", code: `class Solution:\n    def maxSubarray(self, nums):\n${authored.baseline.code.split("\n").slice(1).map((line) => `    ${line}`).join("\n")}` });
  assert.deepEqual([slow.verdict, slow.correct, slow.efficient], ["accepted_slow", true, false]);
  const fast = await submitLearner(execute, store, sound, { language: "cpp", code: "class Solution {\npublic:\n    int maxSubarray(vector<int>& nums) {\n        int best = nums[0], cur = 0;\n        for (int x : nums) { cur = max(x, cur + x); best = max(best, cur); }\n        return best;\n    }\n};\n" });
  assert.deepEqual([fast.verdict, fast.correct, fast.efficient, fast.passed === fast.total], ["accepted", true, true, true]);
  // Passes both examples but clamps at zero: the hidden all-negative edge case catches it.
  const clamped = await submitLearner(execute, store, sound, { language: "python", code: "class Solution:\n    def maxSubarray(self, nums):\n        best = cur = 0\n        for x in nums:\n            cur = max(0, cur + x)\n            best = max(best, cur)\n        return best\n" });
  assert.equal(clamped.verdict, "wrong_answer");
  assert.deepEqual(clamped.failure, { exampleIndex: null, output: null, stdout: null, error: null });
  assert.equal(clamped.tutorNote, "all negative: the answer is the largest element, not 0");
  assert.ok(!JSON.stringify(clamped).includes("-3,-1,-2"));
  const crash = await submitLearner(execute, store, sound, { language: "python", code: "class Solution:\n    def maxSubarray(self, nums):\n        return 6 if len(nums) > 1 else nums[1]\n" });
  assert.equal(crash.verdict, "runtime_error");
  assert.deepEqual(crash.failure, { exampleIndex: 1, output: null, stdout: "", error: "IndexError: list index out of range (line 3)" });
  const solution = await problemSolution(store, sound);
  assert.equal(solution.optimal.time, "O(n)");
});

// The runner role's view of the database: it reads the secret half and is the only one that can publish a problem.
const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
const runnerUrl = process.env.DATABASE_RUNNER_URL;
test("through the database, the runner verifies a problem the app handed it", { skip: skip || (!migratorUrl || !runnerUrl ? "DATABASE_MIGRATOR_URL and DATABASE_RUNNER_URL are required" : false) }, async () => {
  const sql = postgres(migratorUrl!, { max: 1 });
  const database = createDatabaseStore(runnerUrl!);
  const id = randomUUID();
  try {
    await sql`INSERT INTO practice.coding_problems (id, concept, difficulty, status, title, spec, tutor, contract_version) VALUES (${id}, 'dynamic-programming', 'medium', 'verifying', ${spec.title}, ${sql.json(spec)}, ${sql.json({})}, 'runner-test')`;
    await sql`INSERT INTO practice.coding_problem_secrets (problem_id, authored) VALUES (${id}, ${sql.json(authored)})`;
    const result = await verifyProblem(execute, database, id, { largeCases: 1 });
    assert.equal(result.status, "verified", JSON.stringify(result));
    const [row] = await sql<Array<{ status: string; verified_at: Date | null; perf_limit_ms: number | null; small: number }>>`
      SELECT p.status, p.verified_at, s.perf_limit_ms, jsonb_array_length(s.tests->'small') AS small
      FROM practice.coding_problems p JOIN practice.coding_problem_secrets s ON s.problem_id = p.id WHERE p.id = ${id}
    `;
    assert.equal(row?.status, "verified");
    assert.ok(row?.verified_at && row.perf_limit_ms && row.small >= 15);
    clearProblemCache();
    const graded = await submitLearner(execute, database, id, { language: "python", code: "class Solution:\n    def maxSubarray(self, nums):\n        return max(nums)\n" });
    assert.equal(graded.verdict, "wrong_answer");
  } finally {
    await sql`DELETE FROM practice.coding_problems WHERE id = ${id}`;
    await sql.end();
    await database.close();
  }
});

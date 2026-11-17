import assert from "node:assert/strict";
import test from "node:test";
import type { CodingLanguage, Signature } from "@learnspace/shared/coding";
import { sameValue, starterCode } from "@learnspace/shared/coding-code";
import { testExecute } from "../test-sandbox.js";
import { executeCases, gradeSubmission, gradeSuite, type TestCase } from "./grade.js";
import { referenceAsSolution } from "./harness.js";
import type { Execute } from "../executor.js";

// These run real code in real sandbox containers: Docker and the sandbox image must be available.
const { execute: runnerSandbox, skip } = await testExecute();

const twoSum: Signature = { functionName: "twoSum", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }], returns: "int[]" };
const twoSumCases: TestCase[] = [
  { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
  { args: [[3, 2, 4], 6], expected: [2, 1] },
  { args: [[-3, 4, 3, 90], 0], expected: [0, 2] },
];
const twoSumSolutions: Record<CodingLanguage, string> = {
  python: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i\n",
  javascript: "function twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];\n    seen.set(nums[i], i);\n  }\n}\n",
  typescript: "function twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    if (seen.has(target - nums[i])) return [seen.get(target - nums[i])!, i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n",
  java: "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        Map<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            if (seen.containsKey(target - nums[i])) return new int[] { seen.get(target - nums[i]), i };\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}\n",
  cpp: "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int, int> seen;\n        for (int i = 0; i < (int) nums.size(); i++) {\n            if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};\n            seen[nums[i]] = i;\n        }\n        return {};\n    }\n};\n",
};

// Every scalar and nested type crosses the harness both ways.
const mixed: Signature = {
  functionName: "mix",
  params: [{ name: "words", type: "string[]" }, { name: "grid", type: "int[][]" }, { name: "scale", type: "double" }, { name: "flag", type: "bool" }, { name: "big", type: "long" }],
  returns: "string[][]",
};
const mixedCase: TestCase = { args: [["héllo", "a\"b\\c\n"], [[1, 2], [3, 4]], 1.5, true, 9_000_000_000_000], expected: [["héllo!", "a\"b\\c\n!"], ["15", "true", "9000000000001"]] };
const mixedSolutions: Record<CodingLanguage, string> = {
  python: "class Solution:\n    def mix(self, words, grid, scale, flag, big):\n        return [[w + '!' for w in words], [str(int(sum(map(sum, grid)) * scale)), 'true' if flag else 'false', str(big + 1)]]\n",
  javascript: "function mix(words, grid, scale, flag, big) {\n  return [words.map((w) => w + '!'), [String(Math.trunc(grid.flat().reduce((a, b) => a + b, 0) * scale)), String(flag), String(big + 1)]];\n}\n",
  typescript: "function mix(words: string[], grid: number[][], scale: number, flag: boolean, big: number): string[][] {\n  return [words.map((w) => w + '!'), [String(Math.trunc(grid.flat().reduce((a, b) => a + b, 0) * scale)), String(flag), String(big + 1)]];\n}\n",
  java: "class Solution {\n    public String[][] mix(String[] words, int[][] grid, double scale, boolean flag, long big) {\n        long sum = 0; for (int[] row : grid) for (int x : row) sum += x;\n        String[] a = new String[words.length]; for (int i = 0; i < words.length; i++) a[i] = words[i] + \"!\";\n        return new String[][] { a, { String.valueOf((long) (sum * scale)), String.valueOf(flag), String.valueOf(big + 1) } };\n    }\n}\n",
  cpp: "class Solution {\npublic:\n    vector<vector<string>> mix(vector<string>& words, vector<vector<int>>& grid, double scale, bool flag, long long big) {\n        long long sum = 0; for (auto& row : grid) for (int x : row) sum += x;\n        vector<string> a; for (auto& w : words) a.push_back(w + \"!\");\n        return {a, {to_string((long long) (sum * scale)), flag ? \"true\" : \"false\", to_string(big + 1)}};\n    }\n};\n",
};

const LANGUAGES: CodingLanguage[] = ["python", "javascript", "typescript", "java", "cpp"];

test("declared numeric tolerance grades close floats and rejects outside values and NaN; exact integer grading is unchanged", async () => {
  const executeReturning = (value: unknown): Execute => async () => ({ compile: null, runs: [{ status: "ok", stdout: "", stderr: "", result: JSON.stringify({ i: 0, ok: true, v: value, ms: 1 }), wallMs: 1, cpuMs: 1, maxRssKb: 100, exitCode: 0, signal: null }] });
  const signature: Signature = { functionName: "score", params: [{ name: "x", type: "double" }], returns: "double" };
  const input = { signature, compare: "exact" as const, numericTolerance: { absolute: 0.01, relative: 0 }, language: "python" as const, code: "def score(x): return x", cases: [{ args: [1], expected: 1 }], timeoutMs: 1000 };
  assert.equal((await gradeSuite(executeReturning(1.005), input)).verdict, "accepted");
  assert.equal((await gradeSuite(executeReturning(1.02), input)).verdict, "wrong_answer");
  assert.equal(sameValue("double", 1, Number.NaN, "exact", input.numericTolerance), false);
  const integer = await gradeSuite(executeReturning(1.005), { ...input, signature: { ...signature, returns: "int" }, numericTolerance: undefined });
  assert.equal(integer.verdict, "wrong_answer");
});

test("every language's starter code compiles and every value type crosses the harness both ways", { skip }, async () => {
  await Promise.all(LANGUAGES.map(async (language) => {
    const starter = await executeCases(runnerSandbox, { signature: twoSum, language, code: starterCode(twoSum, language), cases: [[[1, 2], 3]], timeoutMs: 10_000 });
    // Java and C++ starters have no return statement: they compile (C++) or fail (Java) as LeetCode's do; none may crash the harness.
    if (language !== "java") assert.equal(starter.compileError, null, `${language} starter: ${starter.compileError}`);
    const solved = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "unordered", language, code: twoSumSolutions[language], cases: twoSumCases, timeoutMs: 10_000 });
    assert.equal(solved.verdict, "accepted", `${language}: ${JSON.stringify(solved)}`);
    const types = await gradeSuite(runnerSandbox, { signature: mixed, compare: "exact", language, code: mixedSolutions[language], cases: [mixedCase], timeoutMs: 10_000 });
    assert.equal(types.verdict, "accepted", `${language} types: ${JSON.stringify(types)}`);
  }));
});

test("wrong answers, runtime errors with their line, compile errors and per-case output are told apart", { skip }, async () => {
  const wrong = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language: "python", code: "class Solution:\n    def twoSum(self, nums, target):\n        print('looking', target)\n        return [0, 1]\n", cases: twoSumCases, timeoutMs: 10_000 });
  assert.equal(wrong.verdict, "wrong_answer");
  assert.equal(wrong.failedIndex, 1);
  assert.equal(wrong.failedOutcome?.stdout, "looking 6");
  const crash = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language: "python", code: "class Solution:\n    def twoSum(self, nums, target):\n        return [nums[10]]\n", cases: twoSumCases, timeoutMs: 10_000 });
  assert.equal(crash.verdict, "runtime_error");
  assert.deepEqual(crash.failedOutcome?.error, { type: "IndexError", message: "list index out of range", line: 3 });
  const javaCrash = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language: "java", code: "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[] { nums[10] };\n    }\n}\n", cases: twoSumCases, timeoutMs: 10_000 });
  assert.equal(javaCrash.failedOutcome?.error?.type, "ArrayIndexOutOfBoundsException");
  assert.equal(javaCrash.failedOutcome?.error?.line, 3);
  const segfault = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language: "cpp", code: "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        if (target == 6) { int* p = nullptr; *p = 1; }\n        return {0, 1};\n    }\n};\n", cases: twoSumCases, timeoutMs: 10_000 });
  assert.equal(segfault.verdict, "runtime_error");
  assert.equal(segfault.failedIndex, 1);
  for (const [language, code] of [["python", "class Solution:\n    def twoSum(self, nums, target)\n        pass\n"], ["typescript", "function twoSum(nums: number[], target: number): number[] {\n  return [;\n}\n"], ["cpp", "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { return x; } };"]] as const) {
    const result = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language, code, cases: twoSumCases, timeoutMs: 10_000 });
    assert.equal(result.verdict, "compile_error", language);
    assert.ok(result.compileError, language);
  }
  const missing = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language: "javascript", code: "function other() {}", cases: twoSumCases, timeoutMs: 10_000 });
  assert.equal(missing.verdict, "runtime_error");
  assert.equal(missing.failedOutcome?.error?.type, "ReferenceError");
});

test("a submission is correct on the small suite and efficient only if the large suite beats the clock", { skip }, async () => {
  const search: Signature = { functionName: "countBelow", params: [{ name: "nums", type: "int[]" }, { name: "queries", type: "int[]" }], returns: "int[]" };
  const nums = Array.from({ length: 100_000 }, (_, index) => index * 2);
  const queries = Array.from({ length: 100_000 }, (_, index) => (index * 7919) % 200_000);
  const expected = queries.map((query) => Math.ceil(query / 2));
  const small: TestCase[] = [{ args: [[1, 3, 5], [0, 2, 6]], expected: [0, 1, 3] }];
  const large: TestCase[] = [{ args: [nums, queries], expected }];
  const linear = "def solve(nums, queries):\n    return [sum(1 for x in nums if x < q) for q in queries]\n";
  const binary = "import bisect\ndef solve(nums, queries):\n    return [bisect.bisect_left(nums, q) for q in queries]\n";
  const input = { signature: search, compare: "exact" as const, language: "python" as const, small, large, perfLimitMs: 2_000, efficiencyStage: true };
  const slow = await gradeSubmission(runnerSandbox, { ...input, code: referenceAsSolution(search, linear) });
  assert.equal(slow.verdict, "accepted_slow");
  assert.equal(slow.correct, true);
  assert.equal(slow.efficient, false);
  const fast = await gradeSubmission(runnerSandbox, { ...input, code: referenceAsSolution(search, binary) });
  assert.equal(fast.verdict, "accepted");
  assert.equal(fast.efficient, true);
  assert.equal(fast.passed, 2);
});

test("an infinite loop is a time limit on the case it was running", { skip }, async () => {
  const result = await gradeSuite(runnerSandbox, { signature: twoSum, compare: "exact", language: "javascript", code: "function twoSum(nums, target) {\n  if (target === 6) while (true) {}\n  return [0, 1];\n}\n", cases: twoSumCases, timeoutMs: 1_500 });
  assert.equal(result.verdict, "time_limit");
  assert.equal(result.failedIndex, 1);
  assert.equal(result.passed, 1);
});

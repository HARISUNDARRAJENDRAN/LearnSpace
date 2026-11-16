import { CODING_LANGUAGES, COMPARE_MODES, signatureSchema, type Signature } from "@learnspace/shared/coding";
import { argsError, sameValue, typeError } from "@learnspace/shared/coding-code";
import { z } from "zod";
import type { ProblemSolution, RunCaseResult, RunResult, SubmitResult, Verification, VerifyResult } from "./api.js";
import type { Execute } from "./executor.js";
import { CORRECTNESS_LIMIT_MS, executeCases, gradeSubmission, timeLimitFor, type CaseOutcome, type Execution, type TestCase } from "./grading/grade.js";
import { referenceAsSolution } from "./grading/harness.js";
import { prepareCases, ReferenceToolError, solveCases, type ReferenceSources } from "./grading/reference.js";

// ---------------------------------------------------------------------------------------------------------------------
// What the runner reads. `spec` is the public half (the app wrote it, learners see it); `authored` and `tests` are the
// secret half, which only this service reads.

const caseSchema = z.object({ args: z.array(z.unknown()), expected: z.unknown() });
const approachSchema = z.object({ approach: z.string(), time: z.string(), space: z.string(), code: z.string().max(20_000) });

export const problemSpecSchema = z.object({
  signature: signatureSchema,
  compare: z.enum(COMPARE_MODES),
  examples: z.array(caseSchema.extend({ explanation: z.string().optional() })).min(1).max(5),
});

export const authoredSchema = z.object({
  generator: z.string().max(20_000),
  validator: z.string().max(20_000),
  baseline: approachSchema,
  optimal: approachSchema,
  edgeCases: z.array(caseSchema.extend({ why: z.string() })).max(12),
});

const storedTestsSchema = z.object({
  small: z.array(caseSchema.extend({ kind: z.enum(["example", "edge", "random"]), why: z.string().optional() })),
  large: z.array(caseSchema),
});
export type StoredTests = z.infer<typeof storedTestsSchema>;

export type ProblemRecord = {
  id: string;
  status: "generating" | "verifying" | "verified" | "rejected";
  spec: unknown;
  authored: unknown;
  tests: unknown;
  perfLimitMs: number | null;
  verification: unknown;
};


/** Where problems live: the database through the runner role in production, memory in tests. */
export interface ProblemStore {
  load(id: string): Promise<ProblemRecord | null>;
  /** Stores the materialized tests and marks the problem verified; false when it was no longer verifying. */
  publish(id: string, result: { tests: StoredTests; perfLimitMs: number; verification: Verification }): Promise<boolean>;
  reject(id: string, failure: string, verification: Record<string, unknown>): Promise<void>;
}

export class ProblemNotFoundError extends Error {}
/** The problem is not in a state this call can act on (not verifying for verify, not verified for grading). */
export class ProblemStateError extends Error {}
class Rejection extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Verification: the model wrote the problem, its examples, its edge cases and both references; none of that is trusted
// until the sandbox shows it holds together.

export const VERIFY_DEFAULTS = { smallCases: 40, largeCases: 3 };
const REFERENCE_LIMIT_MS = 20_000;
const MAX_OPTIMAL_MS = 8_000;

const preview = (value: unknown) => {
  const text = JSON.stringify(value) ?? "null";
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

function describe(outcome: CaseOutcome | undefined, execution: Execution): string {
  if (!outcome || outcome.ok === null) return execution.status === "timeout" ? "ran out of time" : `stopped (${execution.status})`;
  if (outcome.error) return `${outcome.error.type}: ${outcome.error.message}${outcome.error.line ? ` (line ${outcome.error.line})` : ""}`;
  return "failed";
}

function requireAnswers(name: string, execution: Execution, cases: unknown[][]): unknown[] {
  if (execution.compileError) throw new Rejection(`the ${name} reference does not compile: ${execution.compileError.slice(0, 300)}`);
  return cases.map((args, index) => {
    const outcome = execution.outcomes[index];
    if (!outcome?.ok) throw new Rejection(`the ${name} reference failed on ${preview(args)}: ${describe(outcome, execution)}`);
    return outcome.value;
  });
}

/** The problem's large-suite budget in Python: generous next to the optimal reference, never below what start-up costs. */
export function perfLimitFor(optimalMs: number): number {
  return Math.min(12_000, Math.max(1_500, Math.round(optimalMs * 3 + 500)));
}

export async function verifyProblem(execute: Execute, store: ProblemStore, id: string, options: { smallCases?: number; largeCases?: number; seed?: number } = {}): Promise<VerifyResult> {
  const record = await store.load(id);
  if (!record) throw new ProblemNotFoundError(id);
  if (record.status !== "verifying") throw new ProblemStateError(`problem is ${record.status}`);
  const counts = { small: options.smallCases ?? VERIFY_DEFAULTS.smallCases, large: options.largeCases ?? VERIFY_DEFAULTS.largeCases };
  try {
    const verified = await verify(execute, record, counts, options.seed ?? 1);
    const published = await store.publish(id, verified);
    if (!published) throw new ProblemStateError("problem stopped verifying");
    return { status: "verified", verification: verified.verification };
  } catch (error) {
    if (!(error instanceof Rejection || error instanceof ReferenceToolError)) throw error;
    const failure = error.message.slice(0, 1_000);
    await store.reject(id, failure, { checkedAt: new Date().toISOString() });
    return { status: "rejected", failure };
  }
}

async function verify(execute: Execute, record: ProblemRecord, counts: { small: number; large: number }, seed: number) {
  const spec = problemSpecSchema.safeParse(record.spec);
  if (!spec.success) throw new Rejection(`the problem statement is malformed: ${spec.error.issues[0]?.message ?? "invalid"}`);
  const authored = authoredSchema.safeParse(record.authored);
  if (!authored.success) throw new Rejection(`the problem's references are malformed: ${authored.error.issues[0]?.message ?? "invalid"}`);
  const { signature, compare } = spec.data;
  const { baseline, optimal } = authored.data;

  // The authored cases, as written: the examples the learner reads, then the edge cases.
  const written = [
    ...spec.data.examples.map((example, index) => ({ ...example, kind: "example" as const, label: `example ${index + 1}`, why: undefined })),
    ...authored.data.edgeCases.map((edge, index) => ({ args: edge.args, expected: edge.expected, kind: "edge" as const, label: `edge case ${index + 1}`, why: edge.why })),
  ];
  for (const item of written) {
    const error = argsError(signature, item.args) ?? typeError(signature.returns, item.expected, "expected");
    if (error) throw new Rejection(`${item.label}: ${error}`);
  }

  // Every input, written or generated, must satisfy the problem's own validator.
  const sources: ReferenceSources = { generator: authored.data.generator, validator: authored.data.validator, reference: optimal.code };
  const prepared = await prepareCases(execute, sources, { authored: written.map((item) => item.args), small: counts.small, large: counts.large, seed });
  for (const [index, verdict] of prepared.authored.entries()) {
    if (!verdict.valid) throw new Rejection(`${written[index]!.label} breaks the problem's constraints: ${verdict.reason ?? "rejected by the validator"}`);
  }
  for (const generated of [...prepared.small, ...prepared.large]) {
    const error = generated.valid ? argsError(signature, generated.args) : generated.reason ?? "rejected by the validator";
    if (error) throw new Rejection(`the generator produced an invalid input ${preview(generated.args)}: ${error}`);
  }
  const seen = new Set(written.map((item) => JSON.stringify(item.args)));
  const random = prepared.small.map((item) => item.args as unknown[]).filter((args) => {
    const key = JSON.stringify(args);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (random.length < Math.min(10, counts.small)) throw new Rejection(`the generator produced only ${random.length} distinct small inputs`);
  const largeArgs = prepared.large.map((item) => item.args as unknown[]);

  // Differential testing on the small suite: the baseline (brute force) and the optimal reference must agree with each
  // other on every input, and with every expected output the model wrote.
  const smallArgs = [...written.map((item) => item.args), ...random];
  const asSolution = (code: string) => referenceAsSolution(signature, code);
  const [baselineSmall, optimalSmall] = await Promise.all([
    executeCases(execute, { signature, language: "python", code: asSolution(baseline.code), cases: smallArgs, timeoutMs: REFERENCE_LIMIT_MS }),
    executeCases(execute, { signature, language: "python", code: asSolution(optimal.code), cases: smallArgs, timeoutMs: REFERENCE_LIMIT_MS }),
  ]);
  const baselineAnswers = requireAnswers("baseline", baselineSmall, smallArgs);
  const optimalAnswers = requireAnswers("optimal", optimalSmall, smallArgs);
  for (const [index, args] of smallArgs.entries()) {
    const answer = optimalAnswers[index];
    const shapeError = typeError(signature.returns, answer, "the optimal reference's answer");
    if (shapeError) throw new Rejection(`${shapeError} on ${preview(args)}`);
    if (!sameValue(signature.returns, answer, baselineAnswers[index], compare)) {
      throw new Rejection(`the references disagree on ${preview(args)}: baseline ${preview(baselineAnswers[index])}, optimal ${preview(answer)}`);
    }
    const item = written[index];
    if (item && !sameValue(signature.returns, item.expected, answer, compare)) {
      throw new Rejection(`${item.label} expects ${preview(item.expected)} but both references return ${preview(answer)}`);
    }
  }

  // The large suite: the optimal reference answers it (twice, which must agree) and sets the time budget; the baseline
  // then runs against that budget, and whether it fits decides if efficiency is a stage of its own.
  const optimalRuns: Execution[] = [];
  for (let run = 0; run < 2 && largeArgs.length > 0; run += 1) {
    optimalRuns.push(await executeCases(execute, { signature, language: "python", code: asSolution(optimal.code), cases: largeArgs, timeoutMs: REFERENCE_LIMIT_MS }));
  }
  const largeAnswers = optimalRuns.length ? requireAnswers("optimal", optimalRuns[0]!, largeArgs) : [];
  if (optimalRuns[1]) {
    const again = requireAnswers("optimal", optimalRuns[1], largeArgs);
    if (again.some((answer, index) => !sameValue(signature.returns, largeAnswers[index], answer, compare))) throw new Rejection("the optimal reference is not deterministic");
  }
  for (const [index, answer] of largeAnswers.entries()) {
    const shapeError = typeError(signature.returns, answer, "the optimal reference's answer");
    if (shapeError) throw new Rejection(`${shapeError} on large input ${index + 1}`);
  }
  const optimalMs = Math.max(0, ...optimalRuns.map((run) => run.wallMs));
  if (optimalMs > MAX_OPTIMAL_MS) throw new Rejection(`the optimal reference needs ${optimalMs} ms on the large inputs`);
  const perfLimitMs = perfLimitFor(optimalMs);

  let baselineMs: number | null = null;
  let efficiencyStage = false;
  if (largeArgs.length > 0) {
    const baselineLarge = await executeCases(execute, { signature, language: "python", code: asSolution(baseline.code), cases: largeArgs, timeoutMs: timeLimitFor("python", perfLimitMs) });
    if (baselineLarge.status === "timeout" || baselineLarge.status === "memory") {
      efficiencyStage = true;
    } else {
      const answers = requireAnswers("baseline", baselineLarge, largeArgs);
      if (answers.some((answer, index) => !sameValue(signature.returns, largeAnswers[index], answer, compare))) throw new Rejection("the references disagree on a large input");
      baselineMs = baselineLarge.wallMs;
    }
  }

  const tests: StoredTests = {
    small: smallArgs.map((args, index) => {
      const item = written[index];
      return { args, expected: optimalAnswers[index], kind: item?.kind ?? "random", ...(item?.why ? { why: item.why } : {}) };
    }),
    large: largeArgs.map((args, index) => ({ args, expected: largeAnswers[index] })),
  };
  const verification: Verification = { smallCases: tests.small.length, largeCases: tests.large.length, optimalMs, baselineMs, efficiencyStage, checkedAt: new Date().toISOString() };
  return { tests, perfLimitMs, verification };
}

// ---------------------------------------------------------------------------------------------------------------------
// Grading a learner. Only verified problems are graded, and results never carry a hidden test's input or expected output.

type Verified = { signature: Signature; compare: z.infer<typeof problemSpecSchema>["compare"]; examples: StoredTests["small"]; tests: StoredTests; perfLimitMs: number; efficiencyStage: boolean; sources: ReferenceSources; solution: { baseline: z.infer<typeof approachSchema>; optimal: z.infer<typeof approachSchema> } };

const verifiedCache = new Map<string, Verified>();
const CACHE_SIZE = 32;

async function loadVerified(store: ProblemStore, id: string): Promise<Verified> {
  const cached = verifiedCache.get(id);
  if (cached) return cached;
  const record = await store.load(id);
  if (!record) throw new ProblemNotFoundError(id);
  if (record.status !== "verified" || record.perfLimitMs === null) throw new ProblemStateError(`problem is ${record.status}`);
  const spec = problemSpecSchema.parse(record.spec);
  const authored = authoredSchema.parse(record.authored);
  const tests = storedTestsSchema.parse(record.tests);
  const verification = (record.verification ?? {}) as Partial<Verification>;
  const verified: Verified = {
    signature: spec.signature,
    compare: spec.compare,
    examples: tests.small.filter((test) => test.kind === "example"),
    tests,
    perfLimitMs: record.perfLimitMs,
    efficiencyStage: verification.efficiencyStage === true,
    sources: { generator: authored.generator, validator: authored.validator, reference: authored.optimal.code },
    solution: { baseline: authored.baseline, optimal: authored.optimal },
  };
  // Verified problems never change, so they can be kept; the oldest goes first.
  verifiedCache.set(id, verified);
  if (verifiedCache.size > CACHE_SIZE) verifiedCache.delete(verifiedCache.keys().next().value!);
  return verified;
}

export const learnerRunSchema = z.object({
  language: z.enum(CODING_LANGUAGES),
  code: z.string().max(40_000),
  /** The learner's own inputs, already parsed from their text. */
  custom: z.array(z.array(z.unknown()).max(8)).max(4).default([]),
}).strict();
export const learnerSubmitSchema = learnerRunSchema.omit({ custom: true });

const errorText = (error: CaseOutcome["error"]) => (error ? `${error.type}: ${error.message}${error.line ? ` (line ${error.line})` : ""}` : null);


function stopped(status: Execution["status"]): RunResult["verdict"] {
  return status === "timeout" ? "time_limit" : status === "memory" ? "memory_limit" : status === "output_limit" ? "output_limit" : "runtime_error";
}

/**
 * Run: the examples plus the learner's own inputs. Their inputs are checked against the problem's validator, and the
 * reference answers the valid ones, so a custom case shows an expected output too.
 */
export async function runLearner(execute: Execute, store: ProblemStore, id: string, input: z.infer<typeof learnerRunSchema>): Promise<RunResult> {
  const problem = await loadVerified(store, id);
  const invalid: RunResult["invalid"] = [];
  const typed: unknown[][] = [];
  const typedIndex: number[] = [];
  input.custom.forEach((args, index) => {
    const error = argsError(problem.signature, args);
    if (error) invalid.push({ index, reason: error });
    else {
      typed.push(args);
      typedIndex.push(index);
    }
  });
  const cases = [...problem.examples.map((example) => example.args), ...typed];
  const limit = Math.max(CORRECTNESS_LIMIT_MS / 2, timeLimitFor(input.language, problem.perfLimitMs));
  const [execution, solved] = await Promise.all([
    executeCases(execute, { signature: problem.signature, language: input.language, code: input.code, cases, timeoutMs: limit }),
    solveCases(execute, problem.sources, typed),
  ]);
  for (const [position, answer] of solved.entries()) if (!answer.valid) invalid.push({ index: typedIndex[position]!, reason: answer.reason });
  invalid.sort((left, right) => left.index - right.index);
  if (execution.compileError) return { verdict: "compile_error", compileOutput: execution.compileError, cases: [], invalid };
  const results: RunCaseResult[] = [];
  for (const [index, args] of cases.entries()) {
    const example = index < problem.examples.length;
    const answer = example ? null : solved[index - problem.examples.length]!;
    if (answer && !answer.valid) continue;
    const expected = example ? problem.examples[index]!.expected : answer?.valid && answer.ok ? answer.value : null;
    const known = example || Boolean(answer?.valid && answer.ok);
    const outcome = execution.outcomes[index]!;
    results.push({
      index: example ? index : typedIndex[index - problem.examples.length]!,
      kind: example ? "example" : "custom",
      args,
      output: outcome.ok ? outcome.value : null,
      expected,
      passed: outcome.ok === null ? null : outcome.ok && known ? sameValue(problem.signature.returns, expected, outcome.value, problem.compare) : outcome.ok ? null : false,
      stdout: outcome.stdout,
      error: outcome.ok === null ? null : errorText(outcome.error),
      ms: outcome.ms,
    });
  }
  const unfinished = execution.outcomes.some((outcome) => outcome.ok === null);
  return { verdict: unfinished ? stopped(execution.status) : "ran", compileOutput: null, cases: results, invalid };
}


export async function submitLearner(execute: Execute, store: ProblemStore, id: string, input: z.infer<typeof learnerSubmitSchema>): Promise<SubmitResult> {
  const problem = await loadVerified(store, id);
  const small: TestCase[] = problem.tests.small;
  const grade = await gradeSubmission(execute, { signature: problem.signature, compare: problem.compare, language: input.language, code: input.code, small, large: problem.tests.large, perfLimitMs: problem.perfLimitMs, efficiencyStage: problem.efficiencyStage });
  let failure: SubmitResult["failure"] = null;
  let tutorNote: string | null = null;
  const failing = grade.verdict !== "accepted" && grade.verdict !== "accepted_slow" && grade.verdict !== "compile_error";
  if (failing) {
    const test = grade.failedIndex === null ? null : problem.tests.small[grade.failedIndex] ?? null;
    const outcome = grade.failedOutcome;
    if (test?.kind === "example") {
      failure = { exampleIndex: problem.examples.indexOf(test), output: outcome?.ok ? outcome.value : null, stdout: outcome?.stdout ?? null, error: errorText(outcome?.error ?? null) };
    } else {
      failure = { exampleIndex: null, output: null, stdout: null, error: outcome?.error ? `${outcome.error.type}${outcome.error.line ? ` on line ${outcome.error.line}` : ""}` : null };
      tutorNote = test?.why ?? (grade.failedIndex !== null && grade.failedIndex >= small.length ? "fails on a large input at the problem's limits" : null);
    }
  }
  return {
    verdict: grade.verdict,
    passed: grade.passed,
    total: grade.total,
    correct: grade.correct,
    efficient: grade.efficient,
    runtimeMs: grade.verdict === "compile_error" ? null : Math.round(grade.wallMs),
    memoryKb: grade.verdict === "compile_error" ? null : grade.maxRssKb,
    compileOutput: grade.compileError,
    failure,
    tutorNote,
  };
}

/** The references, for after an attempt ends or a learner gives up: the app decides when. */
export async function problemSolution(store: ProblemStore, id: string): Promise<ProblemSolution> {
  return (await loadVerified(store, id)).solution;
}

export function clearProblemCache() {
  verifiedCache.clear();
}

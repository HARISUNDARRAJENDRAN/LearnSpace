import type { CodingLanguage, CompareMode, Signature, Verdict } from "@learnspace/shared/coding";
import { sameValue } from "@learnspace/shared/coding-code";
import type { Execute } from "../executor.js";
import type { RunReport } from "../protocol.js";
import { harnessFiles } from "./harness.js";

export type TestCase = { args: unknown[]; expected: unknown };

export type CaseOutcome = {
  index: number;
  /** null: the case never finished (the program crashed or ran out of time while on it). */
  ok: boolean | null;
  value: unknown;
  error: { type: string; message: string; line: number | null } | null;
  ms: number | null;
  stdout: string;
};

export type Execution = {
  compileError: string | null;
  /** How the run as a whole ended, as the sandbox measured it. */
  status: RunReport["status"];
  outcomes: CaseOutcome[];
  wallMs: number;
  maxRssKb: number;
  stderr: string;
};

/**
 * Time limits are calibrated on Python, the language reference solutions are written and timed in; faster runtimes get
 * proportionally less, and the JVM its start-up on top.
 */
export function timeLimitFor(language: CodingLanguage, pythonMs: number): number {
  const scaled = { python: pythonMs, javascript: pythonMs * 0.6, typescript: pythonMs * 0.6 + 150, java: pythonMs * 0.6 + 700, cpp: pythonMs * 0.4 }[language];
  return Math.round(Math.max(800, scaled));
}

/** Small cases: generous, so only a runaway loop hits it. */
export const CORRECTNESS_LIMIT_MS = 10_000;
const MEMORY_MB = 512;

function splitStdout(stdout: string, count: number): string[] {
  const parts = Array.from({ length: count }, () => "");
  let current = -1;
  for (const line of stdout.split("\n")) {
    const match = /^\u001e(\d+)\u001e$/.exec(line);
    if (match) { current = Number(match[1]); continue; }
    if (current >= 0 && current < count) parts[current] += parts[current] ? `\n${line}` : line;
  }
  return parts.map((part) => part.replace(/\n+$/, "").slice(0, 4_000));
}

function readOutcomes(report: RunReport, count: number): { outcomes: CaseOutcome[]; compileError: string | null; setup: CaseOutcome["error"] } {
  const stdout = splitStdout(report.stdout, count);
  const outcomes: CaseOutcome[] = Array.from({ length: count }, (_, index) => ({ index, ok: null, value: null, error: null, ms: null, stdout: stdout[index] ?? "" }));
  let compileError: string | null = null;
  let setup: CaseOutcome["error"] = null;
  for (const line of report.result.split("\n")) {
    if (!line.trim()) continue;
    let parsed: { i?: number; ok?: boolean; v?: unknown; e?: string; m?: string; line?: number | null; ms?: number; ce?: string; setup?: { e: string; m: string; line: number | null } };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed.ce === "string") compileError = parsed.ce;
    else if (parsed.setup) setup = { type: String(parsed.setup.e), message: String(parsed.setup.m ?? ""), line: parsed.setup.line ?? null };
    else if (typeof parsed.i === "number" && parsed.i >= 0 && parsed.i < count) {
      const outcome = outcomes[parsed.i]!;
      outcome.ok = parsed.ok === true;
      outcome.value = parsed.ok ? parsed.v ?? null : null;
      outcome.error = parsed.ok ? null : { type: String(parsed.e ?? "Error"), message: String(parsed.m ?? ""), line: typeof parsed.line === "number" ? parsed.line : null };
      outcome.ms = typeof parsed.ms === "number" ? Math.round(parsed.ms * 100) / 100 : null;
    }
  }
  return { outcomes, compileError, setup };
}

/** Runs a learner's code on argument lists in one sandboxed process and reads back what each case returned. */
export async function executeCases(execute: Execute, input: { signature: Signature; language: CodingLanguage; code: string; cases: unknown[][]; timeoutMs: number }): Promise<Execution> {
  const response = await execute({
    language: input.language,
    files: harnessFiles(input.signature, input.language, input.code),
    runs: [{ stdin: JSON.stringify(input.cases), timeoutMs: input.timeoutMs }],
    memoryMb: MEMORY_MB,
  });
  const empty = { outcomes: [], wallMs: 0, maxRssKb: 0, stderr: "" };
  if (response.compile && !response.compile.ok) return { ...empty, status: "ok", compileError: response.compile.output.slice(0, 4_000) || "Compilation failed." };
  const report = response.runs[0];
  if (!report) return { ...empty, status: "runtime_error", compileError: null };
  const { outcomes, compileError, setup } = readOutcomes(report, input.cases.length);
  if (compileError) return { ...empty, status: "ok", compileError };
  if (setup) for (const outcome of outcomes) if (outcome.ok === null) { outcome.ok = false; outcome.error = setup; }
  return { compileError: null, status: report.status, outcomes, wallMs: report.wallMs, maxRssKb: report.maxRssKb, stderr: report.stderr.slice(0, 4_000) };
}

/** What stopped an unfinished case, from how the whole run ended. */
function stopVerdict(status: RunReport["status"]): Verdict {
  return status === "timeout" ? "time_limit" : status === "memory" ? "memory_limit" : status === "output_limit" ? "output_limit" : "runtime_error";
}

export type SuiteResult = {
  verdict: Verdict;
  passed: number;
  total: number;
  /** The first case that failed, by index in the suite. */
  failedIndex: number | null;
  failedOutcome: CaseOutcome | null;
  compileError: string | null;
  wallMs: number;
  maxRssKb: number;
};

/** Grades one suite: every case must return the expected value; the first failure decides the verdict. */
export async function gradeSuite(execute: Execute, input: { signature: Signature; compare: CompareMode; language: CodingLanguage; code: string; cases: TestCase[]; timeoutMs: number }): Promise<SuiteResult> {
  const execution = await executeCases(execute, { ...input, cases: input.cases.map((test) => test.args) });
  const total = input.cases.length;
  if (execution.compileError) return { verdict: "compile_error", passed: 0, total, failedIndex: null, failedOutcome: null, compileError: execution.compileError, wallMs: 0, maxRssKb: 0 };
  let passed = 0;
  for (const [index, test] of input.cases.entries()) {
    const outcome = execution.outcomes[index]!;
    const verdict: Verdict | null = outcome.ok === null ? stopVerdict(execution.status) : !outcome.ok ? "runtime_error" : sameValue(input.signature.returns, test.expected, outcome.value, input.compare) ? null : "wrong_answer";
    if (verdict) return { verdict, passed, total, failedIndex: index, failedOutcome: outcome, compileError: null, wallMs: execution.wallMs, maxRssKb: execution.maxRssKb };
    passed += 1;
  }
  // Every case answered, but the process still went over (e.g. a slow exit): the time limit is the limit.
  if (execution.status === "timeout") return { verdict: "time_limit", passed, total, failedIndex: null, failedOutcome: null, compileError: null, wallMs: execution.wallMs, maxRssKb: execution.maxRssKb };
  return { verdict: "accepted", passed, total, failedIndex: null, failedOutcome: null, compileError: null, wallMs: execution.wallMs, maxRssKb: execution.maxRssKb };
}

export type SubmissionGrade = SuiteResult & {
  /** All small cases pass: a correct solution, whatever its speed. */
  correct: boolean;
  /** The large cases pass within the limit too. */
  efficient: boolean;
};

/**
 * A full submission: the small suite decides correctness; only then the large suite, timed from outside the program,
 * decides efficiency. A correct but slow solution is `accepted_slow` when the problem has an efficiency stage.
 */
export async function gradeSubmission(execute: Execute, input: { signature: Signature; compare: CompareMode; language: CodingLanguage; code: string; small: TestCase[]; large: TestCase[]; perfLimitMs: number; efficiencyStage: boolean }): Promise<SubmissionGrade> {
  const total = input.small.length + input.large.length;
  const small = await gradeSuite(execute, { ...input, cases: input.small, timeoutMs: CORRECTNESS_LIMIT_MS });
  if (small.verdict !== "accepted") return { ...small, total, correct: false, efficient: false };
  if (input.large.length === 0) return { ...small, total, correct: true, efficient: true };
  const large = await gradeSuite(execute, { ...input, cases: input.large, timeoutMs: timeLimitFor(input.language, input.perfLimitMs) });
  const passed = small.passed + large.passed;
  const wallMs = Math.max(small.wallMs, large.wallMs);
  const maxRssKb = Math.max(small.maxRssKb, large.maxRssKb);
  if (large.verdict === "accepted") return { ...large, passed, total, wallMs, maxRssKb, correct: true, efficient: true };
  const slow = large.verdict === "time_limit";
  const failedIndex = large.failedIndex === null ? null : input.small.length + large.failedIndex;
  if (slow && input.efficiencyStage) return { ...large, verdict: "accepted_slow", passed, total, failedIndex, wallMs, maxRssKb, correct: true, efficient: false };
  return { ...large, passed, total, failedIndex, wallMs, maxRssKb, correct: false, efficient: false };
}

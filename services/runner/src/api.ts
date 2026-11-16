import type { CodingLanguage, Verdict } from "@learnspace/shared/coding";

/** The runner's grading API as the app sees it: requests, and responses that never contain a hidden test. */

export type Verification = {
  smallCases: number;
  largeCases: number;
  /** Python wall-clock time of the optimal reference on the large suite, and the baseline's when it finished. */
  optimalMs: number;
  baselineMs: number | null;
  /** The baseline could not finish the large suite in time: a correct solution and an efficient one are different stages. */
  efficiencyStage: boolean;
  checkedAt: string;
};

export type VerifyResult = { status: "verified"; verification: Verification } | { status: "rejected"; failure: string };

export type LearnerRunRequest = { language: CodingLanguage; code: string; custom: unknown[][] };
export type LearnerSubmitRequest = { language: CodingLanguage; code: string };

export type RunCaseResult = { index: number; kind: "example" | "custom"; args: unknown[]; output: unknown; expected: unknown; passed: boolean | null; stdout: string; error: string | null; ms: number | null };
export type RunResult = {
  verdict: "ran" | "compile_error" | "time_limit" | "memory_limit" | "output_limit" | "runtime_error";
  compileOutput: string | null;
  cases: RunCaseResult[];
  invalid: Array<{ index: number; reason: string }>;
};

export type SubmitResult = {
  verdict: Verdict;
  passed: number;
  total: number;
  correct: boolean;
  efficient: boolean;
  runtimeMs: number | null;
  memoryKb: number | null;
  compileOutput: string | null;
  /**
   * The first failing test. Its input, expected output, printed output and full error only when it is a shown example;
   * a hidden test shows only the kind of error and its line.
   */
  failure: { exampleIndex: number | null; output: unknown; stdout: string | null; error: string | null } | null;
  /** For the tutor only (never the learner): what the failing hidden edge case was written to catch. */
  tutorNote: string | null;
};

export type ReferenceApproach = { approach: string; time: string; space: string; code: string };
export type ProblemSolution = { baseline: ReferenceApproach; optimal: ReferenceApproach };

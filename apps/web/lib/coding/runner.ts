import type { LearnerRunRequest, LearnerSubmitRequest, ProblemSolution, RunResult, SubmitResult, VerifyResult } from "@learnspace/runner/api";

/**
 * The code runner (services/runner) is the only thing that executes learner code and the only reader of a problem's hidden
 * tests and reference code. The app sends it code and a problem id; it answers with results that never contain a hidden
 * test. This client is all the app knows about it.
 */
export class RunnerUnavailableError extends Error {
  constructor(readonly reason: "not_configured" | "busy" | "failed" | "problem_not_ready") {
    super(reason);
  }
}

export function runnerConfigured(): boolean {
  return Boolean(process.env.RUNNER_URL && process.env.RUNNER_TOKEN);
}

async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number }): Promise<T> {
  const url = process.env.RUNNER_URL;
  const token = process.env.RUNNER_TOKEN;
  if (!url || !token) throw new RunnerUnavailableError("not_configured");
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new RunnerUnavailableError("failed");
  }
  if (response.status === 503) throw new RunnerUnavailableError((await response.json().catch(() => null))?.error === "busy" ? "busy" : "not_configured");
  if (response.status === 409 || response.status === 404) throw new RunnerUnavailableError("problem_not_ready");
  if (!response.ok) throw new RunnerUnavailableError("failed");
  return (await response.json()) as T;
}

/** Checks an authored problem in the sandbox and publishes it (verified) or rejects it. Takes tens of seconds. */
export const verifyProblem = (problemId: string) => call<VerifyResult>(`/v1/problems/${problemId}/verify`, { method: "POST", body: {}, timeoutMs: 280_000 });

export const runProblem = (problemId: string, request: LearnerRunRequest) => call<RunResult>(`/v1/problems/${problemId}/run`, { method: "POST", body: request, timeoutMs: 90_000 });

export const submitProblem = (problemId: string, request: LearnerSubmitRequest) => call<SubmitResult>(`/v1/problems/${problemId}/submit`, { method: "POST", body: request, timeoutMs: 120_000 });

/** The reference approaches: the app asks only once an attempt is over or the learner chose to see it. */
export const problemSolution = (problemId: string) => call<ProblemSolution>(`/v1/problems/${problemId}/solution`, { method: "GET", timeoutMs: 15_000 });

import { z } from "zod";

/** The languages the sandbox image can build and run. */
export const SANDBOX_LANGUAGES = ["python", "javascript", "typescript", "java", "cpp"] as const;
export type SandboxLanguage = (typeof SANDBOX_LANGUAGES)[number];

export const RUNNER_LIMITS = {
  maxRuns: 8,
  maxRunTimeoutMs: 30_000,
  maxCompileTimeoutMs: 30_000,
  maxSourceBytes: 512 * 1024,
  maxStdinBytes: 24 * 1024 * 1024,
  maxMemoryMb: 1_024,
} as const;

/** One execution: the files are written to the sandbox, compiled once, then run once per entry in `runs`. */
export const executeRequestSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  files: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*\.[a-z]+$/), z.string()),
  runs: z.array(z.object({ stdin: z.string(), timeoutMs: z.number().int().min(100).max(RUNNER_LIMITS.maxRunTimeoutMs) }).strict()).min(1).max(RUNNER_LIMITS.maxRuns),
  compileTimeoutMs: z.number().int().min(1_000).max(RUNNER_LIMITS.maxCompileTimeoutMs).default(20_000),
  memoryMb: z.number().int().min(64).max(RUNNER_LIMITS.maxMemoryMb).default(512),
  stdoutLimit: z.number().int().min(0).max(1 << 20).default(64 * 1024),
  resultLimit: z.number().int().min(0).max(32 << 20).default(16 << 20),
}).strict().refine((value) => Object.values(value.files).reduce((sum, file) => sum + Buffer.byteLength(file), 0) <= RUNNER_LIMITS.maxSourceBytes, "source too large")
  .refine((value) => value.runs.reduce((sum, run) => sum + Buffer.byteLength(run.stdin), 0) <= RUNNER_LIMITS.maxStdinBytes, "input too large");
export type ExecuteRequest = z.input<typeof executeRequestSchema>;

/** ok, or why the program stopped: a non-zero exit or signal, the time limit, the memory limit, or too much output. */
export const RUN_STATUSES = ["ok", "runtime_error", "timeout", "memory", "output_limit"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type RunReport = {
  status: RunStatus;
  stdout: string;
  stderr: string;
  /** What the program wrote to fd 3: the harness's per-case results. */
  result: string;
  /** Measured by the sandbox's entrypoint, outside the program. */
  wallMs: number;
  cpuMs: number;
  maxRssKb: number;
  exitCode: number | null;
  signal: string | null;
};

export type ExecuteResponse = {
  compile: { ok: boolean; status: RunStatus; output: string; ms: number } | null;
  /** Empty when compilation failed. */
  runs: RunReport[];
};

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import Docker from "dockerode";
import { z } from "zod";
import { createExecutor, RunnerBusyError, type Execute } from "./executor.js";
import { learnerRunSchema, learnerSubmitSchema, problemSolution, ProblemNotFoundError, ProblemStateError, runLearner, submitLearner, verifyProblem, type ProblemStore } from "./problems.js";
import { executeRequestSchema } from "./protocol.js";
import { createSandbox, SandboxError } from "./sandbox.js";
import { createDatabaseStore } from "./store.js";

const MAX_BODY_BYTES = 26 * 1024 * 1024;

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorized(request: IncomingMessage, token: string): boolean {
  const given = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const PROBLEM_ROUTE = /^\/v1\/problems\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(verify|run|submit|solution)$/;

function parse<T>(schema: z.ZodType<T>, body: string): { ok: true; data: T } | { ok: false; error: string; issues?: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(body || "{}");
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "invalid_request", issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message) };
}

/**
 * The runner's HTTP surface, for the app only (a bearer token): raw execution, and grading against problems whose tests,
 * generators and reference solutions it alone reads. Grading responses never contain a hidden test.
 */
export function createRunnerServer(options: { token: string; execute: Execute; store: ProblemStore | null }): Server {
  const { execute, store } = options;
  async function route(request: IncomingMessage, response: ServerResponse) {
    const url = (request.url ?? "").split("?")[0]!;
    if (request.method === "GET" && url === "/health") return send(response, 200, { ok: true, problems: Boolean(store) });
    const problem = PROBLEM_ROUTE.exec(url);
    if (url !== "/v1/execute" && !problem) return send(response, 404, { error: "not_found" });
    if (!authorized(request, options.token)) return send(response, 401, { error: "unauthorized" });
    const expected = problem?.[2] === "solution" ? "GET" : "POST";
    if (request.method !== expected) return send(response, 405, { error: "method_not_allowed" });
    const body = expected === "POST" ? await readBody(request) : "";
    if (body === null) return send(response, 413, { error: "too_large" });

    if (!problem) {
      const parsed = parse(executeRequestSchema, body);
      if (!parsed.ok) return send(response, 400, parsed);
      return send(response, 200, await execute(parsed.data));
    }
    if (!store) return send(response, 503, { error: "problems_not_configured" });
    const [, id, action] = problem as unknown as [string, string, "verify" | "run" | "submit" | "solution"];
    if (action === "verify") {
      const parsed = parse(z.object({ seed: z.number().int().min(0).max(1_000_000).optional() }).strict(), body);
      if (!parsed.ok) return send(response, 400, parsed);
      return send(response, 200, await verifyProblem(execute, store, id, parsed.data.seed === undefined ? {} : { seed: parsed.data.seed }));
    }
    if (action === "run") {
      const parsed = parse(learnerRunSchema, body);
      if (!parsed.ok) return send(response, 400, parsed);
      return send(response, 200, await runLearner(execute, store, id, parsed.data));
    }
    if (action === "submit") {
      const parsed = parse(learnerSubmitSchema, body);
      if (!parsed.ok) return send(response, 400, parsed);
      return send(response, 200, await submitLearner(execute, store, id, parsed.data));
    }
    return send(response, 200, await problemSolution(store, id));
  }
  return createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      if (error instanceof RunnerBusyError) return send(response, 503, { error: "busy" });
      if (error instanceof ProblemNotFoundError) return send(response, 404, { error: "problem_not_found" });
      if (error instanceof ProblemStateError) return send(response, 409, { error: "problem_state", message: error.message });
      console.error("[runner] request failed", error instanceof Error ? error.message : error);
      return send(response, 502, { error: error instanceof SandboxError ? "sandbox_failed" : "internal_error" });
    }
  });
}

async function main() {
  const token = process.env.RUNNER_TOKEN;
  if (!token || token.length < 16) throw new Error("RUNNER_TOKEN (16+ characters) is required");
  const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
  const sandbox = createSandbox(docker, { image: process.env.SANDBOX_IMAGE ?? "learnspace-sandbox:1", runtime: process.env.SANDBOX_RUNTIME || undefined, cpus: Number(process.env.SANDBOX_CPUS ?? 1) });
  await docker.getImage(process.env.SANDBOX_IMAGE ?? "learnspace-sandbox:1").inspect().catch(() => {
    throw new Error("The sandbox image is missing; build it with `pnpm --filter @learnspace/runner sandbox:build`.");
  });
  await sandbox.sweep();
  const port = Number(process.env.PORT ?? 4100);
  const execute = createExecutor(sandbox.execute, { concurrency: Number(process.env.RUNNER_CONCURRENCY ?? 4), queue: Number(process.env.RUNNER_QUEUE ?? 32) });
  // Without the runner role's database URL the runner only executes code; grading needs the problems' secret half.
  const store = process.env.DATABASE_RUNNER_URL ? createDatabaseStore(process.env.DATABASE_RUNNER_URL) : null;
  if (!store) console.warn("[runner] DATABASE_RUNNER_URL is unset: problem grading is disabled");
  const server = createRunnerServer({ token, execute, store });
  server.requestTimeout = 300_000;
  server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`[runner] listening on ${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

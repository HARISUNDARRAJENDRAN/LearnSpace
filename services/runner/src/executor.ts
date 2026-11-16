import { executeRequestSchema, type ExecuteRequest, type ExecuteResponse } from "./protocol.js";
import type { createSandbox } from "./sandbox.js";

/** Every container slot is taken and the queue is full: the caller should try again shortly. */
export class RunnerBusyError extends Error {
  constructor() {
    super("busy");
  }
}

export type Execute = (request: ExecuteRequest) => Promise<ExecuteResponse>;

/**
 * The one way code reaches the sandbox: requests are checked against the protocol's limits, and at most `concurrency`
 * containers run at once with `queue` more waiting. Grading, verification and the raw execute endpoint all share it, so
 * the limit counts containers, not HTTP requests.
 */
export function createExecutor(run: ReturnType<typeof createSandbox>["execute"], options: { concurrency: number; queue: number }): Execute {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async (request) => {
    const envelope = executeRequestSchema.parse(request);
    if (running >= options.concurrency) {
      if (waiting.length >= options.queue) throw new RunnerBusyError();
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    try {
      return await run(envelope);
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

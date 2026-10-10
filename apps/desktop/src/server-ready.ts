export interface WaitForServerOptions {
  timeoutMs: number;
  intervalMs: number;
}

/**
 * Polls `healthUrl` until it responds with a 2xx status or the timeout elapses.
 * Rejects with a `timed out` error so callers can fail startup loudly instead
 * of opening a window against a dead local runtime.
 */
export async function waitForServer(healthUrl: string, options: WaitForServerOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(options.intervalMs * 20) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`timed out after ${options.timeoutMs}ms waiting for ${healthUrl}${detail}`);
}

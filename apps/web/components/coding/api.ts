import type { CodingStateView, RunResultView } from "@learnspace/shared/coding";

export class CodingRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

/** One call to the session's coding API; errors carry the server's message, which is written for the learner. */
export async function codingApi<T = CodingStateView>(sessionId: string, path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const response = await fetch(`/api/v1/study-sessions/${sessionId}/coding${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.keepalive ? { keepalive: true } : {}),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as ({ error?: { code?: string; message?: string } } & T) | null;
  if (!response.ok) throw new CodingRequestError(payload?.error?.code ?? "REQUEST_FAILED", payload?.error?.message ?? "Something went wrong. Try again.", response.status);
  return payload as T;
}

export type RunResponse = { run: RunResultView & { custom: boolean[] }; state: CodingStateView };

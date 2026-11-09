/** Raised when the session endpoint for a tool does not exist yet, so the panel can say so instead of failing. */
export class StudyToolUnavailableError extends Error {}

export async function postStudyAction<T>(sessionId: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/v1/study-sessions/${sessionId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }) });
  if (response.status === 404 || response.status === 501) throw new StudyToolUnavailableError(action);
  if (!response.ok) throw new Error(`Study ${action} failed`);
  return (await response.json()) as T;
}

export type DesktopAuthHandoff =
  | { status: "success"; token: string; maxAge: number; destination: string }
  | { status: "error"; message: string };

function parseHandoff(value: unknown): DesktopAuthHandoff {
  if (!value || typeof value !== "object") throw new Error("Invalid authentication response.");
  const result = value as Record<string, unknown>;
  if (result.status === "error" && typeof result.message === "string") {
    return { status: "error", message: result.message };
  }
  if (
    result.status === "success" &&
    typeof result.token === "string" && result.token.length >= 40 &&
    typeof result.maxAge === "number" && Number.isSafeInteger(result.maxAge) && result.maxAge > 0 &&
    typeof result.destination === "string" && result.destination.startsWith("/")
  ) {
    return {
      status: "success",
      token: result.token,
      maxAge: result.maxAge,
      destination: result.destination,
    };
  }
  throw new Error("Invalid authentication response.");
}

export async function startDesktopAuthHandoff(
  appOrigin: string,
  flowId: string,
  verifier: string,
): Promise<void> {
  const response = await fetch(new URL(`/api/auth/desktop/${flowId}`, appOrigin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-learnspace-desktop": "1",
    },
    body: JSON.stringify({ verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("LearnSpace could not start Google sign-in.");
}

export async function completeDesktopAuthHandoff(
  appOrigin: string,
  flowId: string,
  verifier: string,
  code: string,
): Promise<DesktopAuthHandoff> {
  const response = await fetch(new URL(`/api/auth/desktop/${flowId}/complete`, appOrigin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-learnspace-desktop": "1",
    },
    body: JSON.stringify({ verifier, code }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("LearnSpace could not complete Google sign-in.");
  return parseHandoff(await response.json());
}

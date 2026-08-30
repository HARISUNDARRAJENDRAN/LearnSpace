import type { SessionContext } from "./repository";
import { AuthError } from "./errors";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AuthError("INVALID_JSON", "Send a valid JSON request body.");
  }
}

export function getSessionContext(request: Request): SessionContext {
  const userAgent = request.headers.get("user-agent");
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp?.trim();
  const context: SessionContext = {};

  if (userAgent) {
    context.userAgent = userAgent;
  }
  if (ipAddress) {
    context.ipAddress = ipAddress;
  }

  return context;
}

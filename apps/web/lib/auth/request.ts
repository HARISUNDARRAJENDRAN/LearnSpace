import { AuthError } from "./errors";
import type { SessionContext } from "./repository";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AuthError("INVALID_JSON", "Send a valid JSON request body.");
  }
}

export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  if (process.env.AUTH_TEST_MODE === "true" || process.env.NODE_ENV !== "production") {
    return realIp || forwardedFor || "unknown";
  }

  // Production is reachable only through Cloudflare Tunnel, which sets this
  // header itself; the server port is published on loopback only.
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export function getSessionContext(request: Request): SessionContext {
  const userAgent = request.headers.get("user-agent");
  const ipAddress = getClientIp(request);
  const context: SessionContext = {};

  if (userAgent) {
    context.userAgent = userAgent;
  }
  if (ipAddress !== "unknown") {
    context.ipAddress = ipAddress;
  }

  return context;
}

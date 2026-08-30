import { getAuthSecret } from "./config";
import { hashIpAddress } from "./crypto";
import { AuthError } from "./errors";
import { getClientIp } from "./request";

type RateLimitInput = {
  request: Request;
  bucket: string;
  limit: number;
  windowSeconds: number;
  identifier?: string;
};

type Counter = { count: number; resetAt: number };

const memoryCounters = new Map<string, Counter>();
let warnedUnavailable = false;

function memoryIncrement(key: string, windowSeconds: number): Counter {
  const now = Date.now();
  const current = memoryCounters.get(key);
  if (!current || current.resetAt <= now) {
    const counter = { count: 1, resetAt: now + windowSeconds * 1000 };
    memoryCounters.set(key, counter);
    return counter;
  }

  current.count += 1;
  return current;
}

async function redisIncrement(key: string, windowSeconds: number): Promise<Counter> {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  )?.replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash Redis is not configured");
  }

  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`${url}/incr/${encodeURIComponent(key)}`, { headers });
  if (!response.ok) {
    throw new Error(`Upstash increment failed with ${response.status}`);
  }

  const body = (await response.json()) as { result?: unknown };
  if (typeof body.result !== "number") {
    throw new Error("Upstash returned an invalid counter");
  }

  if (body.result === 1) {
    const expiryResponse = await fetch(
      `${url}/expire/${encodeURIComponent(key)}/${windowSeconds}`,
      { headers },
    );
    if (!expiryResponse.ok) {
      throw new Error(`Upstash expiry failed with ${expiryResponse.status}`);
    }
  }

  return { count: body.result, resetAt: Date.now() + windowSeconds * 1000 };
}

async function increment(key: string, windowSeconds: number): Promise<Counter> {
  if (
    process.env.AUTH_RATE_LIMIT_BACKEND === "memory" ||
    (!process.env.UPSTASH_REDIS_REST_URL &&
      !process.env.KV_REST_API_URL &&
      process.env.NODE_ENV !== "production")
  ) {
    return memoryIncrement(key, windowSeconds);
  }

  try {
    return await redisIncrement(key, windowSeconds);
  } catch (error) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.error("[auth] rate limiter unavailable; allowing the request", error);
    }
    return { count: 0, resetAt: Date.now() + windowSeconds * 1000 };
  }
}

export async function enforceRateLimit(input: RateLimitInput): Promise<void> {
  const secret = getAuthSecret();
  const ipHash = hashIpAddress(getClientIp(input.request), secret);
  const identifierHash = input.identifier
    ? hashIpAddress(input.identifier.trim().toLowerCase(), secret)
    : "none";
  const key = `learnspace:auth:${input.bucket}:${ipHash}:${identifierHash}`;
  const counter = await increment(key, input.windowSeconds);

  if (counter.count > input.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((counter.resetAt - Date.now()) / 1000),
    );
    throw new AuthError(
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      429,
      retryAfterSeconds,
    );
  }
}

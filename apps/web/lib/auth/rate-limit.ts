import { getAuthSecret } from "./config";
import { hashIpAddress } from "./crypto";
import { AuthError } from "./errors";
import { getClientIp } from "./request";
import { redisCommands } from "@learnspace/shared/recommendation-cache";

type RateLimitInput = {
  request: Request;
  bucket: string;
  limit: number;
  windowSeconds: number;
  identifier?: string;
};

type Counter = { count: number; resetAt: number };

const redisIncrementScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return {count, redis.call("TTL", KEYS[1])}
`;

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
  const result = (await redisCommands([
    ["EVAL", redisIncrementScript, "1", key, String(windowSeconds)],
  ]))?.[0];
  if (
    !Array.isArray(result) || typeof result[0] !== "number" ||
    typeof result[1] !== "number" || result[1] < 0
  ) {
    throw new Error("Upstash returned an invalid counter");
  }

  return { count: result[0], resetAt: Date.now() + result[1] * 1000 };
}

async function increment(key: string, windowSeconds: number): Promise<Counter> {
  const production = process.env.NODE_ENV === "production";
  if (
    (!production && process.env.AUTH_RATE_LIMIT_BACKEND === "memory") ||
    (!process.env.UPSTASH_REDIS_REST_URL &&
      !process.env.KV_REST_API_URL &&
      !production)
  ) {
    return memoryIncrement(key, windowSeconds);
  }

  try {
    return await redisIncrement(key, windowSeconds);
  } catch {
    if (production) {
      throw new AuthError(
        "RATE_LIMIT_UNAVAILABLE",
        "Authentication is temporarily unavailable. Please try again.",
        503,
      );
    }
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn("[auth] rate limiter unavailable; using the local development fallback");
    }
    return memoryIncrement(key, windowSeconds);
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

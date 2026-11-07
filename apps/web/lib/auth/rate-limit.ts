import { getAuthDatabase } from "@learnspace/db";
import { sql } from "drizzle-orm";
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

/** One fixed window per key, counted in Postgres so every server instance shares it. */
async function increment(key: string, windowSeconds: number): Promise<Counter> {
  const [row] = await getAuthDatabase().execute<{ count: number; reset_at: Date }>(sql`
    INSERT INTO ops.rate_limit_counters AS counter (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN counter.reset_at <= now() THEN 1 ELSE counter.count + 1 END,
      reset_at = CASE WHEN counter.reset_at <= now() THEN excluded.reset_at ELSE counter.reset_at END
    RETURNING count, reset_at
  `);
  if (!row) throw new Error("rate limit counter was not returned");
  return { count: row.count, resetAt: new Date(row.reset_at).getTime() };
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

import type { DiscoveryHomeResponse } from "@learnspace/shared";

const homeFeedTtlSeconds = 20 * 60;

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function homeFeedCacheKey(userId: string): string {
  return `ls:v1:discovery:home:${userId}:profile-v1:catalog-v1`;
}

async function redisCommand(command: string[]): Promise<unknown> {
  const config = redisConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return body && typeof body === "object" && "result" in body ? body.result : null;
}

export async function getCachedHomeFeed(userId: string): Promise<DiscoveryHomeResponse | null> {
  try {
    const result = await redisCommand(["GET", homeFeedCacheKey(userId)]);
    if (typeof result !== "string") return null;
    const parsed: unknown = JSON.parse(result);
    return parsed && typeof parsed === "object" ? parsed as DiscoveryHomeResponse : null;
  } catch {
    return null;
  }
}

export async function setCachedHomeFeed(userId: string, value: DiscoveryHomeResponse): Promise<void> {
  try {
    await redisCommand(["SETEX", homeFeedCacheKey(userId), String(homeFeedTtlSeconds), JSON.stringify(value)]);
  } catch {
    return;
  }
}

export async function invalidateHomeFeedCache(userId: string): Promise<void> {
  try {
    await redisCommand(["DEL", homeFeedCacheKey(userId)]);
  } catch {
    return;
  }
}

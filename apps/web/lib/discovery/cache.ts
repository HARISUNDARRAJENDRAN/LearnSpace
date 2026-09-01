import type { DiscoveryHomeResponse } from "@learnspace/shared";

const homeFeedTtlSeconds = 20 * 60;

export type HomeFeedFingerprint = {
  profileFingerprint: string;
  catalogFingerprint: string;
};

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function homeFeedAliasKey(userId: string): string {
  return `ls:v1:discovery:home:${userId}:current`;
}

export function homeFeedCacheKey(userId: string, fingerprints: HomeFeedFingerprint): string {
  return `ls:v1:discovery:home:${userId}:${fingerprints.profileFingerprint}:${fingerprints.catalogFingerprint}`;
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

export async function getCachedHomeFeed(userId: string, fingerprints: HomeFeedFingerprint): Promise<DiscoveryHomeResponse | null> {
  try {
    const key = homeFeedCacheKey(userId, fingerprints);
    const currentKey = await redisCommand(["GET", homeFeedAliasKey(userId)]);
    if (currentKey !== key) return null;
    const result = await redisCommand(["GET", key]);
    if (typeof result !== "string") return null;
    const parsed: unknown = JSON.parse(result);
    return parsed && typeof parsed === "object" ? parsed as DiscoveryHomeResponse : null;
  } catch {
    return null;
  }
}

export async function setCachedHomeFeed(userId: string, fingerprints: HomeFeedFingerprint, value: DiscoveryHomeResponse): Promise<void> {
  try {
    const key = homeFeedCacheKey(userId, fingerprints);
    await redisCommand(["SETEX", key, String(homeFeedTtlSeconds), JSON.stringify(value)]);
    await redisCommand(["SETEX", homeFeedAliasKey(userId), String(homeFeedTtlSeconds), key]);
  } catch {
    return;
  }
}

export async function invalidateHomeFeedCache(userId: string): Promise<void> {
  try {
    const currentKey = await redisCommand(["GET", homeFeedAliasKey(userId)]);
    await redisCommand([
      "DEL",
      homeFeedAliasKey(userId),
      ...(typeof currentKey === "string" ? [currentKey] : []),
    ]);
  } catch {
    return;
  }
}

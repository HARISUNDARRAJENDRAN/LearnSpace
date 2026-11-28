import type { DiscoveryHomeResponse } from "@learnspace/shared";
import { cacheDelete, cacheGet, cacheSet, homeDashboardCacheKey, redisCommands } from "@learnspace/shared/recommendation-cache";

const homeFeedTtlSeconds = 20 * 60;
const homeFeedL1TtlMs = 20_000;

export type HomeFeedFingerprint = {
  profileFingerprint: string;
  catalogFingerprint: string;
};

function homeFeedAliasKey(userId: string): string {
  return `ls:v1:discovery:home:${userId}:current`;
}

export function homeFeedCacheKey(userId: string, fingerprints: HomeFeedFingerprint): string {
  return `ls:v1:discovery:home:${userId}:${fingerprints.profileFingerprint}:${fingerprints.catalogFingerprint}`;
}

export async function getRedisValue(key: string): Promise<string | null> {
  const rows = await redisCommands([["GET", key]]);
  return typeof rows?.[0] === "string" ? rows[0] : null;
}

export async function setRedisValue(key: string, value: string, ttlSeconds: number): Promise<void> {
  await redisCommands([["SETEX", key, String(Math.max(1, Math.floor(ttlSeconds))), value]]);
}

export async function getCachedHomeFeed(userId: string, fingerprints: HomeFeedFingerprint): Promise<DiscoveryHomeResponse | null> {
  try {
    const key = homeFeedCacheKey(userId, fingerprints);
    const localHit = await cacheGet<DiscoveryHomeResponse>(key, homeFeedL1TtlMs);
    if (localHit) return localHit;
    const rows = await redisCommands([["GET", homeFeedAliasKey(userId)], ["GET", key]]);
    if (rows?.[0] !== key || typeof rows?.[1] !== "string") return null;
    const parsed: unknown = JSON.parse(rows[1]);
    return parsed && typeof parsed === "object" ? parsed as DiscoveryHomeResponse : null;
  } catch {
    return null;
  }
}

export async function setCachedHomeFeed(userId: string, fingerprints: HomeFeedFingerprint, value: DiscoveryHomeResponse): Promise<void> {
  try {
    const key = homeFeedCacheKey(userId, fingerprints);
    await cacheSet(key, value, homeFeedTtlSeconds, homeFeedL1TtlMs);
    await redisCommands([["SETEX", homeFeedAliasKey(userId), String(homeFeedTtlSeconds), key]]);
  } catch {
    return;
  }
}

export async function invalidateHomeFeedCache(userId: string): Promise<void> {
  try {
    const rows = await redisCommands([["GET", homeFeedAliasKey(userId)]]);
    const currentKey = typeof rows?.[0] === "string" ? rows[0] : null;
    await cacheDelete(homeDashboardCacheKey(userId), homeFeedAliasKey(userId), ...(currentKey ? [currentKey] : []));
  } catch {
    return;
  }
}

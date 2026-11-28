import { Redis } from "ioredis";
import { RECOMMENDATION_CONFIG as config } from "./recommendation-config.js";

const LOCAL_CACHE_MAX_ENTRIES = 500;
const localCache = new Map<string, { value: string; expiresAt: number }>();

function localCacheEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.AUTH_TEST_MODE !== "true";
}

function readLocal(key: string): string | null {
  if (!localCacheEnabled()) return null;
  const hit = localCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    localCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeLocal(key: string, value: string, ttlMs: number): void {
  if (!localCacheEnabled() || ttlMs <= 0) return;
  if (localCache.size >= LOCAL_CACHE_MAX_ENTRIES) {
    const oldest = localCache.keys().next().value;
    if (oldest !== undefined) localCache.delete(oldest);
  }
  localCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearLocalCache(): void {
  localCache.clear();
}

export function redisConfigured(): boolean {
  return Boolean(
    process.env.REDIS_URL
      ?? process.env.KV_URL
      ?? ((process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)
        && (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN)),
  );
}

let client: Redis | null = null;
let connecting: Promise<unknown> | null = null;
export async function redisCommands(commands: string[][]): Promise<unknown[] | null> {
  if (commands.length === 0) return [];
  try {
    // Prefer stateless Upstash/Vercel KV REST over TCP when both are injected (e.g. Vercel serverless & Cloudflare Workers).
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (url && token) {
      const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(commands), cache: "no-store", signal: AbortSignal.timeout(config.redisTimeoutMs) });
      if (!response.ok) return null;
      const result = await response.json() as Array<{ result?: unknown; error?: unknown }>;
      return Array.isArray(result) && result.length === commands.length && !result.some((item) => item.error) ? result.map((item) => item.result) : null;
    }
    const redisUrl = process.env.REDIS_URL ?? process.env.KV_URL;
    if (redisUrl) {
      if (client?.status === "end") client = null;
      if (!client) { client = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: config.redisTimeoutMs, commandTimeout: config.redisTimeoutMs, retryStrategy: () => null });
        client.on("error", () => {});
      }
      if (client.status === "wait") connecting = client.connect().finally(() => { connecting = null; });
      if (connecting) await connecting;
      if (client.status !== "ready") return null;
      const result = await client.pipeline(commands.map(([name, ...args]) => [name!.toLowerCase(), ...args])).exec();
      if (!result || result.some(([error]) => error)) return null;
      return result.map(([, value]) => value);
    }
    return null;
  } catch { return null; }
}

/** Reads a JSON value from L1 memory cache (warm instance) then Redis L2. */
export async function cacheGet<T>(key: string, l1TtlMs = 0): Promise<T | null> {
  const local = readLocal(key);
  if (local !== null) {
    try { return JSON.parse(local) as T; } catch { localCache.delete(key); }
  }
  const rows = await redisCommands([["GET", key]]);
  const raw = rows?.[0];
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as T;
    if (l1TtlMs > 0) writeLocal(key, raw, l1TtlMs);
    return parsed;
  } catch { return null; }
}

/** Writes a JSON value to Redis L2 (with TTL) and optional L1 memory cache. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number, l1TtlMs = 0): Promise<void> {
  const serialized = JSON.stringify(value);
  if (l1TtlMs > 0) writeLocal(key, serialized, l1TtlMs);
  await redisCommands([["SETEX", key, String(Math.max(1, Math.floor(ttlSeconds))), serialized]]);
}

/** Deletes one or more keys from both L1 memory cache and Redis L2. */
export async function cacheDelete(...keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return;
  for (const key of unique) localCache.delete(key);
  await redisCommands([["DEL", ...unique]]);
}

export function authSessionCacheKey(tokenHash: string): string {
  return `ls:v1:auth:session:${tokenHash}`;
}
export function homeDashboardCacheKey(userId: string): string {
  return `ls:v1:home:${encodeURIComponent(userId)}`;
}
export function catalogFingerprintCacheKey(catalogGeneration: string): string {
  return `ls:v2:discovery:catalog-fp:${encodeURIComponent(catalogGeneration)}`;
}

export function recommendationCacheKey(userId: string, topicId: string | null = null): string {
  return `ls:v2:recommend:${config.version}:${encodeURIComponent(userId)}:${encodeURIComponent(topicId ?? "all")}`;
}
export function recommendationProfileKey(userId: string): string { return `ls:v2:learner:${encodeURIComponent(userId)}`; }
export function recommendationGenerationKey(userId: string): string { return `ls:v2:recommend:generation:${encodeURIComponent(userId)}`; }
export const recommendationCatalogKey = "ls:v2:recommend:catalog-generation";

export type RecommendationCacheEntry<T> = { userId: string; topicId: string | null; generation: string; catalogGeneration: string; freshUntil: number; value: T };
export async function readRecommendationCache<T>(userId: string, topicId: string | null = null): Promise<{ entry: RecommendationCacheEntry<T> | null; generation: string; catalogGeneration: string }> {
  const rows = await redisCommands([["GET", recommendationCacheKey(userId, topicId)], ["GET", recommendationGenerationKey(userId)], ["GET", recommendationCatalogKey]]);
  const generation = String(rows?.[1] ?? "0"), catalogGeneration = String(rows?.[2] ?? "0");
  try {
    const entry = typeof rows?.[0] === "string" ? JSON.parse(rows[0]) as RecommendationCacheEntry<T> : null;
    return { entry: entry?.userId === userId && entry.topicId === topicId && entry.generation === generation && entry.catalogGeneration === catalogGeneration ? entry : null, generation, catalogGeneration };
  } catch { return { entry: null, generation, catalogGeneration }; }
}
export async function writeRecommendationCache<T>(entry: RecommendationCacheEntry<T>): Promise<void> {
  await redisCommands([["SETEX", recommendationCacheKey(entry.userId, entry.topicId), String(config.cacheStaleSeconds), JSON.stringify(entry)]]);
}
export async function invalidateRecommendations(userId: string): Promise<void> {
  await redisCommands([["INCR", recommendationGenerationKey(userId)]]);
}
export async function closeRecommendationRedis(): Promise<void> {
  clearLocalCache();
  client?.disconnect();
  client = null;
}

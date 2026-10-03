import { Redis } from "ioredis";
import { RECOMMENDATION_CONFIG as config } from "./recommendation-config.js";

let client: Redis | null = null;
let connecting: Promise<unknown> | null = null;
export async function redisCommands(commands: string[][]): Promise<unknown[] | null> {
  try {
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
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(commands), cache: "no-store", signal: AbortSignal.timeout(config.redisTimeoutMs) });
    if (!response.ok) return null;
    const result = await response.json() as Array<{ result?: unknown; error?: unknown }>;
    return Array.isArray(result) && result.length === commands.length && !result.some((item) => item.error) ? result.map((item) => item.result) : null;
  } catch { return null; }
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
export async function closeRecommendationRedis(): Promise<void> { client?.disconnect(); client = null; }

import { createHash } from "node:crypto";
import { SOURCE_DISCOVERY_MAX_RESULTS } from "@learnspace/shared";
import type { DiscoveryResource } from "../discovery/ranker";
import { getRedisValue, setRedisValue } from "../discovery/cache";

const freshTtlMs = 5 * 60 * 1000;
const staleTtlMs = 60 * 60 * 1000;
const maxMemoryEntries = 128;

type StoredPool = {
  resources: DiscoveryResource[];
  freshUntil: number;
  staleUntil: number;
};

const memory = new Map<string, StoredPool>();

function cacheKey(mode: "learn" | "research", rankingIntent: string, query: string): string {
  const fingerprint = createHash("sha256")
    .update(`${mode}\n${rankingIntent}\n${query.trim().replace(/\s+/g, " ").toLowerCase()}`)
    .digest("hex");
  return `ls:v2:source-discovery:candidates:${mode}:${rankingIntent}:${fingerprint}`;
}

function decode(value: string): StoredPool | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const body = parsed as Record<string, unknown>;
    if (!Array.isArray(body.resources) || typeof body.freshUntil !== "number" || typeof body.staleUntil !== "number") return null;
    const resources = body.resources.filter((resource): resource is DiscoveryResource => Boolean(resource && typeof resource === "object"))
      .map((resource) => {
        const value = resource as DiscoveryResource;
        return {
          ...value,
          publishedAt: value.publishedAt ? new Date(value.publishedAt) : null,
          publicationDate: value.publicationDate ? new Date(value.publicationDate) : null,
        };
      }).slice(0, SOURCE_DISCOVERY_MAX_RESULTS);
    return { resources, freshUntil: body.freshUntil, staleUntil: body.staleUntil };
  } catch {
    return null;
  }
}

function remember(key: string, pool: StoredPool): void {
  memory.delete(key);
  memory.set(key, pool);
  while (memory.size > maxMemoryEntries) memory.delete(memory.keys().next().value as string);
}

export async function getSourceCandidatePool(
  mode: "learn" | "research",
  rankingIntent: string,
  query: string,
): Promise<{ resources: DiscoveryResource[]; stale: boolean; tier: "memory" | "redis" } | null> {
  const key = cacheKey(mode, rankingIntent, query);
  const now = Date.now();
  const local = memory.get(key);
  if (local && local.staleUntil > now) {
    return { resources: local.resources, stale: local.freshUntil <= now, tier: "memory" };
  }
  try {
    const remote = await getRedisValue(key);
    const decoded = remote ? decode(remote) : null;
    if (decoded && decoded.staleUntil > now) {
      remember(key, decoded);
      return { resources: decoded.resources, stale: decoded.freshUntil <= now, tier: "redis" };
    }
  } catch {
    // Cache failure must never block catalog or live retrieval.
  }
  return null;
}

export async function setSourceCandidatePool(
  mode: "learn" | "research",
  rankingIntent: string,
  query: string,
  resources: DiscoveryResource[],
): Promise<void> {
  if (resources.length === 0) return;
  const now = Date.now();
  const pool: StoredPool = { resources: resources.slice(0, SOURCE_DISCOVERY_MAX_RESULTS), freshUntil: now + freshTtlMs, staleUntil: now + staleTtlMs };
  const key = cacheKey(mode, rankingIntent, query);
  remember(key, pool);
  try {
    await setRedisValue(key, JSON.stringify(pool), Math.ceil(staleTtlMs / 1000));
  } catch {
    // Redis is an optimization, not a correctness dependency.
  }
}

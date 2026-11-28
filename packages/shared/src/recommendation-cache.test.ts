import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  authSessionCacheKey,
  cacheDelete,
  cacheGet,
  cacheSet,
  catalogFingerprintCacheKey,
  clearLocalCache,
  homeDashboardCacheKey,
  redisConfigured,
} from "./recommendation-cache.js";

test("cache helpers round-trip and invalidate via Upstash REST pipeline", async () => {
  const store = new Map<string, string>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const commands = JSON.parse(Buffer.concat(chunks).toString("utf8")) as string[][];
      const results = commands.map(([cmd, ...args]) => {
        if (cmd === "GET") return { result: store.get(args[0]!) ?? null };
        if (cmd === "SETEX") {
          store.set(args[0]!, args[2]!);
          return { result: "OK" };
        }
        if (cmd === "DEL") {
          let deleted = 0;
          for (const key of args) if (store.delete(key)) deleted += 1;
          return { result: deleted };
        }
        return { result: null };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const prevRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${address.port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

  try {
    assert.equal(redisConfigured(), true);
    const key = authSessionCacheKey("abc123");
    assert.equal(await cacheGet(key), null);
    await cacheSet(key, { ok: true, n: 42 }, 60, 5_000);
    assert.deepEqual(await cacheGet<{ ok: boolean; n: number }>(key, 5_000), { ok: true, n: 42 });
    clearLocalCache();
    // Still hits mock Redis after L1 is cleared.
    assert.deepEqual(await cacheGet<{ ok: boolean; n: number }>(key), { ok: true, n: 42 });
    await cacheDelete(key);
    assert.equal(await cacheGet(key), null);
    assert.equal(homeDashboardCacheKey("u1"), "ls:v1:home:u1");
    assert.equal(catalogFingerprintCacheKey("7"), "ls:v2:discovery:catalog-fp:7");
  } finally {
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
    if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedisUrl;
    clearLocalCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

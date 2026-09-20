import { randomUUID } from "node:crypto";

const baseUrl = process.env.SOURCE_DISCOVERY_BENCHMARK_URL;
const cookie = process.env.SOURCE_DISCOVERY_BENCHMARK_COOKIE;
const iterations = Math.max(1, Number(process.env.SOURCE_DISCOVERY_BENCHMARK_ITERATIONS ?? 2));
const mode = process.env.SOURCE_DISCOVERY_BENCHMARK_MODE === "research" ? "research" : "learn";
const queries = (process.env.SOURCE_DISCOVERY_BENCHMARK_QUERIES ?? [
  "python for beginners",
  "kubernetes networking",
  "how transformers work",
  "linear algebra eigenvectors",
  "diffusion models",
  "attention mechanisms",
]).filter(Boolean);

if (!baseUrl || !cookie) {
  throw new Error("Set SOURCE_DISCOVERY_BENCHMARK_URL and SOURCE_DISCOVERY_BENCHMARK_COOKIE");
}

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(2));
}

async function measure(query, rankingIntent, scenario) {
  const started = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/source-discovery/search`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mode, query, rankingIntent, correlationId: randomUUID() }),
  });
  const body = await response.json();
  const elapsedMs = performance.now() - started;
  return {
    query,
    scenario: response.ok && scenario === "auto"
      ? !body.timings ? "run_reuse"
        : body.cacheState === "fresh" ? "warm"
        : body.cacheState === "stale" ? "stale"
          : body.retrieval === "catalog" ? "catalog"
            : body.retrieval === "live_web" || body.retrieval === "blended" ? "live"
              : "cold"
      : response.ok ? scenario : "error",
    status: response.status,
    resultCount: Array.isArray(body.candidates) ? body.candidates.length : 0,
    retrieval: typeof body.retrieval === "string" ? body.retrieval : "unknown",
    timings: body.timings ?? null,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    serverTiming: response.headers.get("server-timing"),
  };
}

const samples = [];
for (const query of queries) {
  samples.push(await measure(query, "best_match", "auto"));
  for (let index = 1; index < iterations; index += 1) {
    samples.push(await measure(query, "best_match", "auto"));
  }
}

const summary = Object.groupBy(samples, (sample) => `${sample.scenario}:${sample.retrieval}`);
const report = Object.fromEntries(Object.entries(summary).map(([scenario, values]) => {
  const timings = values.map((sample) => sample.elapsedMs);
  const providerTimings = values.map((sample) => sample.timings?.providerMs ?? sample.timings?.exaMs).filter((value) => typeof value === "number");
  return [scenario, {
    count: timings.length,
    p50Ms: percentile(timings, 50),
    p95Ms: percentile(timings, 95),
    p99Ms: percentile(timings, 99),
    qualifiedResultRate: Number((values.filter((sample) => sample.resultCount > 0).length / values.length).toFixed(3)),
    errorRate: Number((values.filter((sample) => sample.status >= 400).length / values.length).toFixed(3)),
    providerP50Ms: percentile(providerTimings, 50),
    providerP95Ms: percentile(providerTimings, 95),
  }];
}));

console.log(JSON.stringify({ mode, queries, report, samples }, null, 2));

import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { rankDiscoveryResources, type DiscoveryResource, type LearnerProfile } from "../lib/discovery/ranker";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";

const url = new URL(process.env.DATABASE_MIGRATOR_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55433") throw new Error("Benchmark requires the isolated local CI database on port 55433");
const db = postgres(url.toString(), { max: 10, prepare: false });
const source = process.env.BENCHMARK_SOURCE_TABLE;
if (source && !/^recommend_bench_[0-9]+$/.test(source)) throw new Error("Invalid benchmark source table");
const indexMemoryMb = Number(process.env.BENCHMARK_INDEX_MEMORY_MB ?? 256);
if (!Number.isInteger(indexMemoryMb) || indexMemoryMb < 64 || indexMemoryMb > 2048) throw new Error("Benchmark index memory must be 64–2048 MB");
const name = `recommend_bench_${process.pid}`;
const table = `discovery.${name}`;
const measurements: unknown[] = [];
const percentile = (samples: number[], fraction: number) => samples.slice().sort((a, b) => a - b)[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]!;
const summarize = (samples: number[]) => ({ n: samples.length, medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95), maximumMs: Math.max(...samples) });
let seed = 42;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
const vector = () => Array.from({ length: config.embeddingDimensions }, () => Math.round((random() - .5) * 1000) / 1000);
const queryVector = JSON.stringify(vector());
try {
  await db.unsafe(`CREATE UNLOGGED TABLE ${table} (id integer PRIMARY KEY, embedding vector(1536), category integer)`);
  let previous = 0;
  for (const size of [1000, 10000, 50000, 100000]) {
    const ingestStart = performance.now();
    if (source) await db.unsafe(`INSERT INTO ${table} SELECT * FROM discovery.${source} WHERE id >= $1 AND id < $2`, [previous, size]);
    for (let base = source ? size : previous; base < size; base += 250) {
      const rows = Array.from({ length: Math.min(250, size - base) }, (_, index) => ({ id: base + index, embedding: JSON.stringify(vector()), category: (base + index) % 12 }));
      await db.unsafe(`INSERT INTO ${table} SELECT id, embedding::vector, category FROM jsonb_to_recordset($1::text::jsonb) AS x(id integer, embedding text, category integer)`, [JSON.stringify(rows)]);
    }
    console.info(JSON.stringify({ stage: "benchmark_ingest", size, ms: performance.now() - ingestStart }));
    const buildStart = performance.now();
    await db.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL maintenance_work_mem = '${indexMemoryMb}MB'`);
      await tx.unsafe(`SET LOCAL max_parallel_maintenance_workers = 0`);
      await tx.unsafe(`CREATE INDEX ${name}_hnsw ON ${table} USING hnsw (embedding vector_cosine_ops)`);
      await tx.unsafe(`ANALYZE ${table}`);
    });
    const indexBuildMs = performance.now() - buildStart;
    const query = () => db.begin(async (tx) => { await tx.unsafe(`SET LOCAL hnsw.ef_search = ${config.annEfSearch}`); await tx.unsafe("SET LOCAL hnsw.iterative_scan = 'relaxed_order'"); const rows = await tx.unsafe(`SELECT id FROM ${table} ORDER BY embedding <=> $1::vector LIMIT 100`, [queryVector]); if (rows.length !== 100) throw new Error(`ANN returned ${rows.length} candidates`); return rows; });
    await query();
    const sequential: number[] = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); await query(); sequential.push(performance.now() - start); }
    const concurrent: number[] = [];
    await Promise.all(Array.from({ length: 50 }, async () => { const start = performance.now(); await query(); concurrent.push(performance.now() - start); }));
    const explain = await db.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL hnsw.ef_search = ${config.annEfSearch}`);
      await tx.unsafe("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
      return tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM ${table} ORDER BY embedding <=> $1::vector LIMIT 100`, [queryVector]);
    });
    const indexBytes = await db.unsafe(`SELECT pg_relation_size('${table.replace(name, name + "_hnsw")}')::bigint bytes`);
    measurements.push({ size, indexBuildMs, indexBytes: Number(indexBytes[0]!.bytes), sequential: summarize(sequential), concurrent50: summarize(concurrent), explain: explain[0], memory: process.memoryUsage() });
    await mkdir("../../docs/benchmarks", { recursive: true });
    await writeFile("../../docs/benchmarks/semantic-load.json", JSON.stringify({ dimensions: config.embeddingDimensions, efSearch: config.annEfSearch, indexMemoryMb, synthetic: true, ann: measurements }, null, 2));
    console.info(JSON.stringify({ size, indexBuildMs, sequential: summarize(sequential), concurrent50: summarize(concurrent) }));
    await db.unsafe(`DROP INDEX discovery.${name}_hnsw`);
    previous = size;
  }
  const now = new Date();
  const profile: LearnerProfile = { conceptIds: ["python"], affinities: new Map(), conceptNames: new Map(), persona: "student", learningIntents: [], preferredFormats: [], preferredDuration: "no_preference", selfReportedLevel: "intermediate", semanticRanking: true, recentInterests: { python: .8 } };
  const resources: DiscoveryResource[] = Array.from({ length: config.candidateCount }, (_, i) => ({ id: String(i), type: "video", provider: "youtube", externalId: String(i), canonicalUrl: `https://youtube.com/watch?v=bench${i}`, title: `Benchmark ${i}`, description: null, language: "en", qualityScore: .6 + random() * .4, thumbnailUrl: null, channelTitle: `Channel ${i % 16}`, durationMs: 300000 + i * 10000, publishedAt: now, paperAbstract: null, venue: null, publicationDate: null, citationCount: null, metadata: { estimatedLevel: i % 3 === 0 ? "beginner" : "intermediate", subtopic: String(i % 8) }, concepts: [{ id: "python", name: "Python", relevance: .7 + random() * .3 }], quality: null, semanticSimilarity: .55 + random() * .45 }));
  const ranks: number[] = [];
  for (let i = 0; i < 200; i++) { const start = performance.now(); const output = rankDiscoveryResources(resources, profile, now, config.resultCount); if (output.videos.filter((v) => v.finalRank).length !== 24) throw new Error("Ranker did not fill bounded feed"); ranks.push(performance.now() - start); }
  await mkdir("../../docs/benchmarks", { recursive: true });
  await writeFile("../../docs/benchmarks/semantic-load.json", JSON.stringify({ timestamp: now.toISOString(), dimensions: config.embeddingDimensions, efSearch: config.annEfSearch, indexMemoryMb, synthetic: true, database: "isolated CI PostgreSQL16/pgvector0.8.6", ann: measurements, ranking100To24: summarize(ranks) }, null, 2));
  console.info(JSON.stringify({ ranking100To24: summarize(ranks) }));
} finally { await db.unsafe(`DROP TABLE IF EXISTS ${table}`); await db.end(); }

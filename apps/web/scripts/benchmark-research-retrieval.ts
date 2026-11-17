import { instantDiscovery } from "@learnspace/shared/exa-discovery";
import { retrieveResearchPapers } from "../lib/research/retrieval/index.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Expected = { arxivId: string; title: string; year: number };
type Query = { category: string; query: string; expected: Expected[] };
type Candidate = { arxivId: string | null; title: string; year: number | null };
type Run = { candidates: Candidate[]; failures: string[]; latencyMs: number };
type Metrics = {
  queries: number;
  recallAt10: number;
  nDCGAt10: number;
  identifierResolution: number;
  latencyMs: { p50: number; p95: number };
  failedQueries: number;
  categories: Record<string, { queries: number; recallAt10: number; nDCGAt10: number }>;
};

for (const root of [process.cwd(), resolve(process.cwd(), "../..")]) {
  for (const filename of [".env.local", ".env.development.local", ".env", ".env.development"]) {
    try { process.loadEnvFile(resolve(root, filename)); } catch { /* Optional local configuration. */ }
  }
}

const benchmarkDir = resolve(process.cwd(), "../../docs/benchmarks/research-retrieval");
const queries = JSON.parse(await readFile(resolve(benchmarkDir, "queries.json"), "utf8")) as Query[];
const apiKey = process.env.EXA_API_KEY?.trim() ?? "";
if (!apiKey) throw new Error("EXA_API_KEY is required for the live benchmark");
if (queries.length !== 40 || queries.some((query) => !query.category || !query.query || !query.expected.length)) throw new Error("Expected 40 valid labeled benchmark queries");

function id(value: string | null): string | null { return value?.replace(/^arxiv:/i, "").toLowerCase().replace(/v\d+$/, "") ?? null; }
function year(value: string | null): number | null { return value ? new Date(value).getUTCFullYear() : null; }
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function metrics(runs: Run[]): Metrics {
  const recalls = runs.map((run, index) => {
    const expected = queries[index]!.expected;
    const ids = run.candidates.slice(0, 10).map((paper) => id(paper.arxivId));
    return expected.filter((paper) => ids.includes(paper.arxivId)).length / expected.length;
  });
  const ndcgs = runs.map((run, index) => {
    const expected = new Set(queries[index]!.expected.map((paper) => paper.arxivId));
    const dcg = run.candidates.slice(0, 10).reduce((sum, paper, rank) => sum + (paper.arxivId && expected.has(id(paper.arxivId) ?? "") ? 1 / Math.log2(rank + 2) : 0), 0);
    const ideal = [...expected].slice(0, 10).reduce((sum, _, rank) => sum + 1 / Math.log2(rank + 2), 0);
    return ideal ? dcg / ideal : 0;
  });
  const idIndices = queries.flatMap((query, index) => query.category === "identifier" ? [index] : []);
  const categories = Object.fromEntries([...new Set(queries.map((query) => query.category))].map((category) => {
    const indices = queries.flatMap((query, index) => query.category === category ? [index] : []);
    return [category, {
      queries: indices.length,
      recallAt10: Number((indices.reduce((sum, index) => sum + recalls[index]!, 0) / indices.length).toFixed(4)),
      nDCGAt10: Number((indices.reduce((sum, index) => sum + ndcgs[index]!, 0) / indices.length).toFixed(4)),
    }];
  }));
  return {
    queries: runs.length,
    recallAt10: Number((recalls.reduce((sum, value) => sum + value, 0) / recalls.length).toFixed(4)),
    nDCGAt10: Number((ndcgs.reduce((sum, value) => sum + value, 0) / ndcgs.length).toFixed(4)),
    identifierResolution: Number((idIndices.filter((index) => recalls[index]! > 0).length / idIndices.length).toFixed(4)),
    latencyMs: { p50: percentile(runs.map((run) => run.latencyMs), 0.5), p95: percentile(runs.map((run) => run.latencyMs), 0.95) },
    failedQueries: runs.filter((run) => run.candidates.length === 0 && run.failures.length > 0).length,
    categories,
  };
}

async function legacy(query: Query): Promise<Run> {
  const started = performance.now();
  const result = await instantDiscovery({ query_text: query.query, source_kind: "paper", ranking_intent: query.category === "foundational" || query.category === "recent" ? query.category : "best_match", limit: 30 }, { exaApiKey: apiKey, timeoutMs: 4_000 });
  return { candidates: result.arxiv.map((paper) => ({ arxivId: id(paper.arxiv_id), title: paper.title, year: year(paper.published_at) })), failures: result.failures, latencyMs: Math.round(performance.now() - started) };
}

async function exaOnly(query: Query): Promise<Run> {
  const started = performance.now();
  const result = await retrieveResearchPapers(query.query, { exaApiKey: apiKey, timeoutMs: 4_000, rankingIntent: query.category === "foundational" || query.category === "recent" ? query.category : "best_match" });
  return { candidates: result.papers.map((paper) => ({ arxivId: id(paper.arxivId), title: paper.title, year: year(paper.publishedAt) })), failures: result.partialFailures, latencyMs: Math.round(performance.now() - started) };
}

const legacyRuns: Run[] = [];
const exaOnlyRuns: Run[] = [];
for (const [index, query] of queries.entries()) {
  const legacyRun = await legacy(query);
  const exaRun = await exaOnly(query);
  legacyRuns.push(legacyRun);
  exaOnlyRuns.push(exaRun);
  process.stdout.write(`${String(index + 1).padStart(2, "0")}/40 ${query.category}: legacy=${legacyRun.candidates.length} Exa-only=${exaRun.candidates.length} Exa latency=${exaRun.latencyMs}ms failures=${exaRun.failures.length}\n`);
}

const legacyMetrics = metrics(legacyRuns);
const exaOnlyMetrics = metrics(exaOnlyRuns);
const perQuery = queries.map((query, index) => {
  const legacyIds = legacyRuns[index]!.candidates.slice(0, 10).map((paper) => id(paper.arxivId));
  const exaIds = exaOnlyRuns[index]!.candidates.slice(0, 10).map((paper) => id(paper.arxivId));
  return {
    query: query.query,
    category: query.category,
    expected: query.expected,
    legacy: legacyRuns[index],
    exaOnly: exaOnlyRuns[index],
    lostLegacyGold: query.expected.filter((paper) => legacyIds.includes(paper.arxivId) && !exaIds.includes(paper.arxivId)).map((paper) => ({ arxivId: paper.arxivId, title: paper.title, legacyRank: legacyIds.indexOf(paper.arxivId) + 1 })),
  };
});
const report = {
  measuredAt: new Date().toISOString(),
  mode: "live",
  queries: queries.length,
  baseline: "legacy interactive Exa paper search with the original query and ranking intent",
  implementation: "Exa-only retrieval with query planning, identifier normalization, and stable Exa ranking",
  metricDefinitions: {
    recallAt10: "macro-average fraction of hand-labeled relevant arXiv IDs found in the first 10",
    nDCGAt10: "macro-average binary relevance nDCG over hand-labeled arXiv IDs",
    identifierResolution: "fraction of four identifier queries with at least one labeled arXiv ID in the first 10",
    latencyMs: "wall-clock retrieval time per query, p50 and p95; both paths were called live in alternating pairs",
  },
  metrics: { legacy: legacyMetrics, exaOnly: exaOnlyMetrics },
  historicalHybridReference: {
    recallAt10: 0.5563,
    nDCGAt10: 0.5141,
    latencyMs: null,
    note: "Quality values from the prior run brief; comparable latency was not included there.",
  },
  archivedHybridMeasurement: {
    recallAt10: 0.5313,
    nDCGAt10: 0.4899,
    latencyMs: { p50: 2_566, p95: 4_005 },
    note: "Earlier live hybrid snapshot retained in the pre-change results file; separate from the quality values above.",
  },
  providerHealth: { exaConfigured: true, legacyFailures: legacyRuns.reduce((sum, run) => sum + run.failures.length, 0), exaOnlyFailures: exaOnlyRuns.reduce((sum, run) => sum + run.failures.length, 0) },
  losses: perQuery.flatMap((row) => row.lostLegacyGold.map((paper) => ({ query: row.query, category: row.category, ...paper }))),
  perQuery,
};
await writeFile(resolve(benchmarkDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report.metrics, null, 2)}\n`);

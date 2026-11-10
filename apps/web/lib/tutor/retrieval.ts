import { createHash } from "node:crypto";
import type { Transaction } from "@learnspace/db";
import { retrievalRuns, retrievedChunks } from "@learnspace/db/schema";
import { MAX_EVIDENCE, TRANSCRIPT_EMBEDDING_PROFILE } from "@learnspace/shared/tutor";
import { sql } from "drizzle-orm";
import type { Evidence } from "./grounding";
import type { TutorScope } from "./scope";

export const RETRIEVAL_STRATEGY = "transcript-hybrid-rrf-v1";
// Roughly what a lecture's relevant part needs; a summary of a scope gets more room so it can cover it.
const ANSWER_BUDGET_TOKENS = 6_000;
const SUMMARY_BUDGET_TOKENS = 14_000;
const RRF_K = 60;
const MIN_VECTOR_SIMILARITY = 0.2;

type Candidate = { chunkId: string; ordinal: number; startMs: number | null; endMs: number | null; tokenCount: number; lexical: number; vector: number | null };
type Scored = Candidate & { score: number; inScope: boolean };
export type Retrieval = { runId: string; evidence: Evidence[]; coverage: "full" | "partial"; timed: boolean; latencyMs: number; vectorUsed: boolean };

const fullyEmbedded = (candidates: Candidate[]) => candidates.length > 0 && candidates.every((candidate) => candidate.vector !== null);

/** Ranks candidates by reciprocal rank fusion of lexical match, embedding similarity, closeness to the asked-about moment and what the last answer cited. */
export function rankCandidates(candidates: Candidate[], scope: TutorScope, recentChunkIds: string[] = []): Scored[] {
  const timed = candidates.some((candidate) => candidate.startMs !== null);
  const inScope = (candidate: Candidate) => {
    if (!timed || scope.kind === "out_of_range" || scope.fromMs === null) return true;
    const start = candidate.startMs ?? 0;
    return (candidate.endMs ?? start) >= scope.fromMs && start <= scope.toMs;
  };
  const fused = new Map<string, number>();
  const add = (list: Candidate[], weight: number) => {
    for (const [rank, candidate] of list.entries()) fused.set(candidate.chunkId, (fused.get(candidate.chunkId) ?? 0) + weight / (RRF_K + rank + 1));
  };
  add(candidates.filter((candidate) => candidate.lexical > 0).sort((a, b) => b.lexical - a.lexical), 1);
  // A transcript still being embedded would rank its embedded chunks above the rest, so meaning counts only once all are.
  if (fullyEmbedded(candidates)) add(candidates.filter((candidate) => candidate.vector! >= MIN_VECTOR_SIMILARITY).sort((a, b) => b.vector! - a.vector!), 1);
  // A follow-up rarely names its topic; a question on a new topic still outranks these with its own matches.
  const byId = new Map(candidates.map((candidate) => [candidate.chunkId, candidate]));
  add(recentChunkIds.flatMap((id) => byId.get(id) ?? []), 1);
  const focus = scope.kind === "out_of_range" ? null : scope.focusMs;
  if (timed && focus !== null) {
    const distance = (candidate: Candidate) => Math.abs(((candidate.startMs ?? 0) + (candidate.endMs ?? candidate.startMs ?? 0)) / 2 - focus);
    // Asking about a moment makes closeness the strongest signal; otherwise it only breaks ties toward where the learner is.
    add([...candidates].sort((a, b) => distance(a) - distance(b)), scope.kind === "near" || scope.kind === "at" ? 2 : 0.3);
  }
  return candidates.map((candidate) => ({ ...candidate, score: fused.get(candidate.chunkId) ?? 0, inScope: inScope(candidate) }));
}

/** Picks evidence inside the token budget: everything in scope when it fits, else the best chunks with their neighbours. */
export function selectEvidence(ranked: Scored[], scope: TutorScope): { chosen: Scored[]; coverage: "full" | "partial" } {
  const pool = ranked.filter((candidate) => candidate.inScope);
  const summary = scope.kind === "whole" || scope.kind === "watched";
  const budget = summary ? SUMMARY_BUDGET_TOKENS : ANSWER_BUDGET_TOKENS;
  const total = pool.reduce((sum, candidate) => sum + candidate.tokenCount, 0);
  if (total <= budget && pool.length <= MAX_EVIDENCE && (summary || scope.kind === "near" || scope.kind === "at")) return { chosen: pool, coverage: "full" };
  const chosen = new Map<string, Scored>();
  let used = 0;
  const take = (candidate: Scored | undefined) => {
    if (!candidate || chosen.has(candidate.chunkId) || chosen.size >= MAX_EVIDENCE || used + candidate.tokenCount > budget) return;
    chosen.set(candidate.chunkId, candidate);
    used += candidate.tokenCount;
  };
  const byOrdinal = new Map(pool.map((candidate) => [candidate.ordinal, candidate]));
  if (summary) {
    // A summary needs the whole arc, so spread picks evenly across the scope before filling with the best matches.
    const ordered = [...pool].sort((a, b) => a.ordinal - b.ordinal);
    const slots = Math.min(ordered.length, Math.floor(MAX_EVIDENCE * 0.75));
    for (let index = 0; index < slots; index += 1) take(ordered[Math.floor((index * ordered.length) / slots)]);
  }
  const best = [...pool].sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);
  for (const candidate of best.slice(0, 3)) {
    take(candidate);
    // A chunk's neighbours carry the sentence it starts or ends mid-way.
    take(byOrdinal.get(candidate.ordinal - 1));
    take(byOrdinal.get(candidate.ordinal + 1));
  }
  for (const candidate of best) if (candidate.score > 0) take(candidate);
  return { chosen: [...chosen.values()], coverage: chosen.size === pool.length ? "full" : "partial" };
}

/** Retrieves evidence from one transcript version only, and records the run with every scored candidate. */
export async function retrieveEvidence(tx: Transaction, input: { userId: string; sessionId: string; agentRunId: string; versionId: string; question: string; tsquery: string; scope: TutorScope; vector: number[] | null; recentChunkIds: string[] }): Promise<Retrieval> {
  const started = performance.now();
  const vectorSql = input.vector ? sql`1 - (e.embedding <=> ${JSON.stringify(input.vector)}::vector)` : sql`NULL::float8`;
  const lexicalSql = input.tsquery ? sql`ts_rank_cd(c.search_tsv, to_tsquery('simple', ${input.tsquery}))` : sql`0::float8`;
  const rows = await tx.execute<{ id: string; ordinal: number; start_ms: number | null; end_ms: number | null; token_count: number; lexical: number; vector: number | null }>(sql`
    SELECT c.id, c.ordinal, c.start_ms, c.end_ms, c.token_count, ${lexicalSql} AS lexical, ${vectorSql} AS vector
    FROM retrieval.resource_chunks c
    LEFT JOIN retrieval.chunk_embeddings e ON e.chunk_id = c.id AND e.embedding_profile_id = ${TRANSCRIPT_EMBEDDING_PROFILE}
    WHERE c.resource_version_id = ${input.versionId}
    ORDER BY c.ordinal`);
  const candidates: Candidate[] = rows.map((row) => ({ chunkId: row.id, ordinal: row.ordinal, startMs: row.start_ms, endMs: row.end_ms, tokenCount: row.token_count, lexical: Number(row.lexical) || 0, vector: row.vector === null ? null : Number(row.vector) }));
  const ranked = rankCandidates(candidates, input.scope, input.recentChunkIds);
  const { chosen, coverage } = selectEvidence(ranked, input.scope);
  const ordered = chosen.sort((a, b) => a.ordinal - b.ordinal);
  const content = ordered.length
    ? await tx.execute<{ id: string; content: string }>(sql`SELECT id, content FROM retrieval.resource_chunks WHERE resource_version_id = ${input.versionId} AND id = ANY(ARRAY[${sql.join(ordered.map((row) => sql`${row.chunkId}`), sql`, `)}]::uuid[])`)
    : [];
  const text = new Map(content.map((row) => [row.id, row.content]));
  const evidence = ordered.map((row) => ({ chunkId: row.chunkId, ordinal: row.ordinal, startMs: row.startMs, endMs: row.endMs, content: text.get(row.chunkId) ?? "" }));
  const latencyMs = Math.round(performance.now() - started);
  const vectorUsed = fullyEmbedded(candidates);
  const [run] = await tx.insert(retrievalRuns).values({
    userId: input.userId, studySessionId: input.sessionId, agentRunId: input.agentRunId, queryText: input.question,
    querySha256: createHash("sha256").update(input.question).digest("hex"), embeddingProfileId: vectorUsed ? TRANSCRIPT_EMBEDDING_PROFILE : null,
    scope: { resourceVersionId: input.versionId, ...input.scope }, strategyVersion: RETRIEVAL_STRATEGY, status: "completed",
    candidateCount: candidates.length, selectedCount: evidence.length, latencyMs, completedAt: new Date(),
  }).returning({ id: retrievalRuns.id });
  // Every selected chunk plus the strongest others, so a citation can always point at a recorded candidate.
  const selected = new Set(ordered.map((row) => row.chunkId));
  const recorded = [...ranked].sort((a, b) => Number(selected.has(b.chunkId)) - Number(selected.has(a.chunkId)) || b.score - a.score).slice(0, Math.max(40, selected.size));
  if (recorded.length) {
    await tx.insert(retrievedChunks).values(recorded.map((row, index) => ({
      retrievalRunId: run!.id, chunkId: row.chunkId, candidateRank: index + 1, finalRank: selected.has(row.chunkId) ? ordered.findIndex((item) => item.chunkId === row.chunkId) + 1 : null,
      lexicalScore: row.lexical, vectorScore: row.vector, rerankScore: row.score, selected: selected.has(row.chunkId), reasonCodes: row.inScope ? [] : ["out_of_scope"],
    })));
  }
  return { runId: run!.id, evidence, coverage, timed: candidates.some((candidate) => candidate.startMs !== null), latencyMs, vectorUsed };
}

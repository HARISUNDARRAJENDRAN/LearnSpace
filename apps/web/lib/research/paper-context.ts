import { createHash } from "node:crypto";
import type { Transaction } from "@learnspace/db";
import { authors, paperAuthors, paperDetails, paperReferences, resourceChunks, retrievalRuns, retrievedChunks, resources } from "@learnspace/db/schema";
import type { PaperCitationAnchor } from "@learnspace/shared/contracts";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { lexicalQuery, questionTerms } from "../tutor/scope";

export type PaperPassage = {
  chunkId: string;
  ordinal: number;
  type: string;
  content: string;
  tokenCount: number;
  headingPath: string[];
  page: number | null;
  sectionId: string | null;
  citations: number[];
  latex: string | null;
};
export type PaperReferenceContext = { ordinal: number; raw: string; title: string | null; authors: string[]; year: string | null; venue: string | null; url: string | null; abstract: string | null };
export type PaperContext = {
  resourceId: string;
  versionId: string;
  title: string;
  authors: string[];
  abstract: string | null;
  venue: string | null;
  publicationDate: string | null;
  outline: Array<{ title: string; page: number | null; sectionId: string | null }>;
  references: PaperReferenceContext[];
};
export type PaperEvidence = { chunkId: string; ordinal: number; content: string; anchor: PaperCitationAnchor; citations: number[]; tokenCount: number };

/** Maps model passage numbers back to unique, persisted paper anchors. Invalid numbers cannot manufacture citations. */
export function paperCitationAnchors(cites: number[], evidence: Array<{ anchor: PaperCitationAnchor }>): PaperCitationAnchor[] {
  return [...new Map(cites.flatMap((cite) => {
    const anchor = evidence[cite - 1]?.anchor;
    return anchor ? [[anchor.chunkId, anchor] as const] : [];
  })).values()];
}

const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const safeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
};
const referenceUrl = (doi: string | null, arxivId: string | null, metadata: Record<string, unknown>): string | null => arxivId ? `https://arxiv.org/abs/${arxivId}` : doi ? `https://doi.org/${doi}` : safeUrl(metadata.url);

/** Loads paper metadata using the same source tables and current version as the paper read model. */
export async function loadPaperContext(tx: Transaction, userId: string, resourceId: string, versionId: string): Promise<PaperContext> {
  const [row] = await tx.select({ resource: resources, paper: paperDetails })
    .from(resources).innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .where(and(eq(resources.id, resourceId), eq(resources.type, "paper"), eq(resources.currentVersionId, versionId), isNull(resources.deletedAt), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])))).limit(1);
  if (!row) throw new AuthError("PAPER_NOT_FOUND", "This paper is not available.", 404);
  const [authorRows, headings, referenceRows] = await Promise.all([
    tx.select({ name: authors.preferredName }).from(paperAuthors).innerJoin(authors, eq(authors.id, paperAuthors.authorId)).where(eq(paperAuthors.paperResourceId, resourceId)).orderBy(asc(paperAuthors.ordinal)),
    tx.select({ content: resourceChunks.content, anchor: resourceChunks.anchor, page: resourceChunks.pageFrom }).from(resourceChunks).where(and(eq(resourceChunks.resourceVersionId, versionId), eq(resourceChunks.chunkType, "heading"))).orderBy(asc(resourceChunks.ordinal)),
    tx.select().from(paperReferences).where(eq(paperReferences.paperResourceId, resourceId)).orderBy(asc(paperReferences.ordinal)),
  ]);
  return {
    resourceId, versionId, title: row.resource.title, authors: authorRows.map(({ name }) => name), abstract: row.paper.abstract,
    venue: row.paper.venue, publicationDate: row.paper.publicationDate ? String(row.paper.publicationDate) : null,
    outline: headings.map(({ content, anchor, page }) => ({ title: content, page, sectionId: string(anchor.sectionId) })),
    references: referenceRows.map((reference) => ({
      ordinal: reference.ordinal, raw: reference.rawReference, title: string(reference.metadata.title),
      authors: Array.isArray(reference.metadata.authors) ? reference.metadata.authors.filter((name): name is string => typeof name === "string") : [],
      year: reference.metadata.year == null ? null : String(reference.metadata.year), venue: string(reference.metadata.venue),
      url: referenceUrl(reference.citedDoi, reference.citedArxivId, reference.metadata), abstract: string(reference.metadata.abstract),
    })),
  };
}

export async function loadPaperPassages(tx: Transaction, versionId: string): Promise<PaperPassage[]> {
  const rows = await tx.select({ id: resourceChunks.id, ordinal: resourceChunks.ordinal, type: resourceChunks.chunkType, content: resourceChunks.content, tokenCount: resourceChunks.tokenCount, headingPath: resourceChunks.headingPath, page: resourceChunks.pageFrom, anchor: resourceChunks.anchor, metadata: resourceChunks.metadata })
    .from(resourceChunks).where(eq(resourceChunks.resourceVersionId, versionId)).orderBy(asc(resourceChunks.ordinal));
  return rows.map((row) => ({
    chunkId: row.id, ordinal: row.ordinal, type: row.type, content: row.content, tokenCount: row.tokenCount, headingPath: row.headingPath,
    page: row.page ?? (typeof row.anchor.page === "number" ? row.anchor.page : null), sectionId: string(row.anchor.sectionId),
    citations: Array.isArray(row.metadata.citations) ? row.metadata.citations.filter((number): number is number => Number.isInteger(number) && number > 0) : [],
    latex: string(row.metadata.latex),
  }));
}

type Candidate = PaperPassage & { lexical: number; score: number };

/** Lexical match leads; the active section and nearby pages break ties and rescue chunks without embeddings. */
export function rankPaperPassages(passages: PaperPassage[], lexical: Map<string, number>, anchor: { page?: number; sectionId?: string }): Candidate[] {
  return passages.map((passage) => {
    const score = lexical.get(passage.chunkId) ?? 0;
    const sameSection = Boolean(anchor.sectionId && anchor.sectionId === passage.sectionId);
    const pageDistance = anchor.page === undefined || passage.page === null ? Infinity : Math.abs(passage.page - anchor.page);
    const proximity = sameSection ? 0.35 : Number.isFinite(pageDistance) ? 0.2 / (pageDistance + 1) : 0;
    return { ...passage, lexical: score, score: score + proximity };
  }).sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);
}

/** Retrieves one paper version with PostgreSQL lexical ranking and reader position proximity, and records the run. */
export async function retrievePaperEvidence(tx: Transaction, input: { userId: string; sessionId: string; agentRunId: string; paper: PaperContext; question: string; anchor: { page?: number; sectionId?: string } }): Promise<{ runId: string; evidence: PaperEvidence[]; latencyMs: number }> {
  const started = performance.now();
  const tsquery = lexicalQuery(questionTerms(input.question));
  const lexical = tsquery
    ? sql`ts_rank_cd(c.search_tsv, to_tsquery('simple', ${tsquery}))`
    : sql`0::float8`;
  const rows = await tx.execute<{ id: string; ordinal: number; chunk_type: string; content: string; token_count: number; heading_path: string[]; page_from: number | null; anchor: Record<string, unknown>; metadata: Record<string, unknown>; lexical: number }>(sql`
    SELECT c.id, c.ordinal, c.chunk_type, c.content, c.token_count, c.heading_path, c.page_from, c.anchor, c.metadata, ${lexical} AS lexical
    FROM retrieval.resource_chunks c
    WHERE c.resource_version_id = ${input.paper.versionId}
    ORDER BY c.ordinal`);
  const passages: PaperPassage[] = rows.map((row) => ({
    chunkId: row.id, ordinal: row.ordinal, type: row.chunk_type, content: row.content, tokenCount: row.token_count,
    headingPath: row.heading_path, page: row.page_from ?? (typeof row.anchor.page === "number" ? row.anchor.page : null),
    sectionId: string(row.anchor.sectionId),
    citations: Array.isArray(row.metadata.citations) ? row.metadata.citations.filter((number): number is number => Number.isInteger(number) && number > 0) : [],
    latex: string(row.metadata.latex),
  }));
  const ranked = rankPaperPassages(passages, new Map(rows.map((row) => [row.id, Number(row.lexical) || 0])), input.anchor);
  let tokens = 0;
  const chosen: Candidate[] = [];
  for (const passage of ranked) {
    if (!passage.content.trim() || chosen.length >= 24 || tokens + passage.tokenCount > 8_000) continue;
    chosen.push(passage); tokens += passage.tokenCount;
  }
  const evidence = chosen.filter((passage) => passage.page !== null).map((passage) => ({
    chunkId: passage.chunkId, ordinal: passage.ordinal, content: passage.content,
    anchor: { kind: "paper" as const, page: passage.page!, sectionId: passage.sectionId ?? passage.headingPath.at(-1) ?? "unsectioned", chunkId: passage.chunkId },
    citations: passage.citations, tokenCount: passage.tokenCount,
  }));
  const latencyMs = Math.round(performance.now() - started);
  const [run] = await tx.insert(retrievalRuns).values({
    userId: input.userId, studySessionId: input.sessionId, agentRunId: input.agentRunId, queryText: input.question,
    querySha256: createHash("sha256").update(input.question).digest("hex"), embeddingProfileId: null,
    scope: { resourceVersionId: input.paper.versionId, kind: "paper", ...input.anchor }, strategyVersion: "paper-lexical-proximity-v1",
    status: "completed", candidateCount: rows.length, selectedCount: evidence.length, latencyMs, completedAt: new Date(),
  }).returning({ id: retrievalRuns.id });
  const selected = new Set(evidence.map((passage) => passage.chunkId));
  const ordered = ranked.filter((passage) => selected.has(passage.chunkId));
  if (ranked.length) await tx.insert(retrievedChunks).values(ranked.slice(0, Math.max(40, selected.size)).map((passage, index) => ({
    retrievalRunId: run!.id, chunkId: passage.chunkId, candidateRank: index + 1,
    finalRank: selected.has(passage.chunkId) ? ordered.findIndex((item) => item.chunkId === passage.chunkId) + 1 : null,
    lexicalScore: passage.lexical, vectorScore: null, rerankScore: passage.score, selected: selected.has(passage.chunkId), reasonCodes: [],
  })));
  return { runId: run!.id, evidence, latencyMs };
}

export function paperReferenceOrdinals(question: string, evidence: PaperEvidence[]): number[] {
  const mentioned = [...question.matchAll(/\[(\d{1,3})\]|\b(?:reference|citation|ref\.?)[ #]*(\d{1,3})\b/gi)].map((match) => Number(match[1] ?? match[2]));
  return [...new Set([...mentioned, ...evidence.flatMap((item) => item.citations)])].filter((ordinal) => ordinal > 0);
}


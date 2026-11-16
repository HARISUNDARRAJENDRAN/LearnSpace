import { createHash } from "node:crypto";
import postgres from "postgres";
import { parsePaperPdf, MAX_PDF_BYTES, type ParseOutput, type PdfSource } from "@learnspace/pdf-parser";
import { TRANSCRIPT_EMBEDDING_PROFILE } from "@learnspace/shared/tutor";
import { instantDiscovery } from "@learnspace/shared/exa-discovery";
import type { EmbeddingProvider } from "./embeddings.js";

type SqlClient = ReturnType<typeof postgres>;
type TransactionClient = postgres.TransactionSql;
type JsonValue = Parameters<SqlClient["json"]>[0];
type Reference = { ordinal: number; raw: string };
type ReferenceCandidate = {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  venue: string | null;
  url: string | null;
  abstract: string | null;
  source?: "exa" | "reference-text";
};
export interface PaperReferenceClient { search(query: string): Promise<ReferenceCandidate[]> }
export type Passage = {
  ordinal: number;
  chunk_type: string;
  heading_path: string[];
  content: string;
  content_sha256: string;
  token_count: number;
  page_from: number;
  page_to: number;
  paragraph_from: number | null;
  paragraph_to: number | null;
  anchor: JsonValue;
  metadata: JsonValue;
};
type DownloadedPdf = { bytes: Uint8Array; url: URL; downloadedAt: string; durationMs: number };
type PaperRow = { id: string; pdf_source_url: string | null; arxiv_id: string | null; title: string; status: string; metadata: Record<string, unknown> };
type VersionRow = { id: string; processing_status: string; processing_attempts: number; lease_expires_at: Date | null; retry_after: Date | null; metadata: Record<string, unknown>; resource_metadata: Record<string, unknown>; refreshReady?: boolean };
type IngestionDeps = {
  fetchPdf?: (url: URL) => Promise<DownloadedPdf>;
  parse?: typeof parsePaperPdf;
  referenceClient?: PaperReferenceClient;
  now?: () => number;
};

const PDF_HOSTS = new Set(["arxiv.org", "export.arxiv.org"]);
const MAX_ATTEMPTS = 4;
const LEASE_SECONDS = 600;
const MAX_PARAGRAPH_CHARS = 1_800;
const CHUNKER_VERSION = 3;
const REFERENCE_RESOLVER_VERSION = 2;
const MAX_EXA_REFERENCE_SEARCHES = 20;
let nextExaRequestAt = 0;

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const tokenCount = (text: string) => Math.max(1, Math.ceil(text.length / 4));
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function trustedPdfUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && PDF_HOSTS.has(url.hostname) ? url : null;
  } catch { return null; }
}

function arxivPdfUrl(arxivId: string): string | null {
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(arxivId)
    ? `https://arxiv.org/pdf/${arxivId}` : null;
}

export async function downloadPaperPdf(start: URL, fetcher: typeof fetch = fetch, now = () => performance.now()): Promise<DownloadedPdf> {
  const started = now();
  let url = start;
  for (let hop = 0; hop <= 3; hop += 1) {
    const safe = trustedPdfUrl(url.href);
    if (!safe) throw new Error("paper PDF URL is not allow-listed");
    const response = await fetcher(safe, {
      redirect: "manual",
      headers: { Accept: "application/pdf", "User-Agent": "LearnSpace/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? trustedPdfUrl(new URL(location, safe).href) : null;
      if (!next) throw new Error("paper PDF redirected outside the allow-list");
      url = next;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`paper PDF returned HTTP ${response.status}`);
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/pdf")) throw new Error("paper source did not return application/pdf");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) throw new Error(`paper PDF exceeds ${MAX_PDF_BYTES} byte limit`);
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new Error(`paper PDF exceeds ${MAX_PDF_BYTES} byte limit`);
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("paper source is missing PDF magic bytes");
    return { bytes, url: safe, downloadedAt: new Date().toISOString(), durationMs: Math.round(now() - started) };
  }
  throw new Error("paper PDF redirected too many times");
}

/** Fast parsing is permitted only after the standard detector confirms clean native text from a born-digital host. */
export function choosePaperPdfSource(url: URL | string, detection: Pick<ParseOutput, "pages" | "classification" | "unrecovered">): PdfSource {
  let host = "";
  try { host = new URL(url).hostname; } catch { return "untrusted"; }
  const cleanNative = PDF_HOSTS.has(host)
    && detection.classification.type.toLowerCase() === "textbased"
    && detection.pages.length > 0
    && detection.pages.some((page) => page.text.trim().length > 0)
    && detection.pages.every((page) => !page.needsOcr)
    && detection.classification.pagesNeedingOcr.length === 0
    && !detection.unrecovered.some((item) => /encoding/i.test(item));
  return cleanNative ? "verified-native" : "untrusted";
}

function sectionSlug(path: string[]): string {
  const slug = path.join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "unsectioned";
}

function matchWords(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

const LOOKAHEAD_WORDS = 8;
type CoordinateWord = { word: string; bbox: ParseOutput["coordinates"][number]["bbox"] };

function matchPreparedBBox(content: string, items: CoordinateWord[], cursor: number, advance: (cursor: number) => void): number[] | null {
  const target = matchWords(content);
  const totalChars = target.reduce((sum, word) => sum + word.length, 0);
  if (!totalChars) return null;
  // Anchor on the first place two consecutive chunk words appear together (one word for a one-word chunk), then follow
  // the chunk with a short lookahead: an unbounded scan lets a common word ("the") match far down the page and stretch the box.
  let start = -1;
  let first = 0;
  for (let k = 0; k < Math.min(target.length, 6) && start < 0; k += 1) {
    for (let i = cursor; i < items.length; i += 1) {
      if (items[i]!.word === target[k] && (k + 1 >= target.length || items[i + 1]?.word === target[k + 1])) { start = i; first = k; break; }
    }
  }
  if (start < 0) return null;
  let next = start;
  let matchedChars = 0;
  const matched: CoordinateWord[] = [];
  for (const word of target.slice(first)) {
    const limit = Math.min(items.length, next + LOOKAHEAD_WORDS);
    let found = next;
    while (found < limit && items[found]!.word !== word) found += 1;
    if (found === limit) continue;
    matchedChars += word.length;
    matched.push(items[found]!);
    next = found + 1;
  }
  advance(next);
  if (matchedChars / totalChars < 0.6 || !matched.length) return null;
  return [
    Math.min(...matched.map(({ bbox }) => bbox.x)),
    Math.min(...matched.map(({ bbox }) => bbox.y)),
    Math.max(...matched.map(({ bbox }) => bbox.x + bbox.width)),
    Math.max(...matched.map(({ bbox }) => bbox.y + bbox.height)),
  ];
}

/** Coordinates are already PDF points with a bottom-left origin. */
export function matchChunkBBox(content: string, page: number, coordinates: ParseOutput["coordinates"], cursors = new Map<number, number>()): number[] | null {
  const items = coordinates.filter((item) => item.page === page).flatMap((item) => matchWords(item.text).map((word) => ({ word, bbox: item.bbox })));
  return matchPreparedBBox(content, items, cursors.get(page) ?? 0, (cursor) => cursors.set(page, cursor));
}

function createBBoxMatcher(coordinates: ParseOutput["coordinates"]): (content: string, page: number) => number[] | null {
  const coordinateWords = new Map<number, CoordinateWord[]>();
  for (const item of coordinates) coordinateWords.set(item.page, [...(coordinateWords.get(item.page) ?? []), ...matchWords(item.text).map((word) => ({ word, bbox: item.bbox }))]);
  const cursors = new Map<number, number>();
  return (content, page) => matchPreparedBBox(content, coordinateWords.get(page) ?? [], cursors.get(page) ?? 0, (cursor) => cursors.set(page, cursor));
}

function referenceOrdinal(raw: string, fallback: number): number {
  const match = /^\s*\[(\d+)\]|^\s*(\d{1,3})[.)]\s+/.exec(raw);
  return Number(match?.[1] ?? match?.[2] ?? fallback);
}

export function paperReferences(parsed: Pick<ParseOutput, "references">): Reference[] {
  const entries = parsed.references.flatMap((entry) => {
    const text = entry.text.trim();
    const markers = [...text.matchAll(/\[\d+\]\s*/g)];
    if (!markers.length || (markers.length === 1 && markers[0]!.index === 0)) return [text];
    return [
      ...(markers[0]!.index ? [text.slice(0, markers[0]!.index).trim()] : []),
      ...markers.map((marker, index) => text.slice(marker.index!, markers[index + 1]?.index ?? text.length).trim()),
    ].filter(Boolean);
  });
  const collected: string[] = [];
  for (const entry of entries) {
    if (/^\s*(?:\[\d+\]|\d{1,3}[.)])\s*/.test(entry)) collected.push(entry);
    else if (collected.length && /^\s*(?:\[\d+\]|\d{1,3}[.)])\s*/.test(collected[collected.length - 1]!)) collected[collected.length - 1] += ` ${entry}`;
    else collected.push(entry);
  }
  const numbered = collected.some((entry) => /^\s*(?:\[\d+\]|\d{1,3}[.)])\s*/.test(entry));
  const output = collected.map((raw, index) => ({ ordinal: referenceOrdinal(raw, index + 1), raw: raw.trim() })).filter((item) => item.raw && item.ordinal > 0 && (!numbered || /^\s*(?:\[\d+\]|\d{1,3}[.)])\s*/.test(item.raw)));
  return [...new Map(output.map((item) => [item.ordinal, item])).values()].sort((a, b) => a.ordinal - b.ordinal);
}

function referenceAuthorYear(raw: string): { author: string | null; year: number | null } {
  const year = Number(raw.match(/\b((?:19|20)\d{2})[a-z]?\b/)?.[1]) || null;
  const prefix = raw.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, "").split(/["“]/)[0]?.replace(/\bet\s+al\.?/i, "").trim() ?? "";
  const authorPart = prefix.split(",")[0] ?? "";
  const author = authorPart.split(/\s+/).at(-1)?.replace(/[^\p{L}]/gu, "") ?? null;
  return { author: author || null, year };
}

function citationOrdinals(text: string, references: Reference[]): number[] {
  const known = new Set(references.map((reference) => reference.ordinal));
  const found = new Set<number>();
  for (const [, inner] of text.matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g)) {
    for (const part of (inner ?? "").split(/[,;]/)) {
      const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part.trim());
      if (range) {
        const from = Number(range[1]); const to = Number(range[2]);
        if (to >= from && to - from <= 50) for (let value = from; value <= to; value += 1) if (known.has(value)) found.add(value);
      } else {
        const value = Number(part.trim());
        if (known.has(value)) found.add(value);
      }
    }
  }
  for (const [, marker] of text.matchAll(/\(([A-Z][^()]{0,100}\b(?:19|20)\d{2}[a-z]?)\)/g)) {
    const markerMatch = /^(.*?)\s*,?\s*((?:19|20)\d{2})/i.exec(marker ?? "");
    if (!markerMatch) continue;
    const author = markerMatch[1]!.replace(/\bet\s+al\.?/i, "").trim().split(/\s+/).at(-1)!.replace(/[^\p{L}]/gu, "").toLowerCase();
    const year = Number(markerMatch[2]);
    for (const reference of references) {
      const parsed = referenceAuthorYear(reference.raw);
      if (parsed.year === year && parsed.author?.toLowerCase() === author) found.add(reference.ordinal);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function splitLongParagraph(text: string): string[] {
  if (text.length <= MAX_PARAGRAPH_CHARS) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const output: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    let remaining = sentence;
    while (remaining.length > MAX_PARAGRAPH_CHARS) {
      const split = remaining.lastIndexOf(" ", MAX_PARAGRAPH_CHARS);
      const cut = split > 0 ? split : MAX_PARAGRAPH_CHARS;
      if (current) { output.push(current); current = ""; }
      output.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (current && current.length + remaining.length + 1 > MAX_PARAGRAPH_CHARS) { output.push(current); current = ""; }
    current = current ? `${current} ${remaining}` : remaining;
  }
  if (current) output.push(current);
  return output;
}

function buildPassage(ordinal: number, type: string, content: string, path: string[], page: number, para: number | null, metadata: Record<string, unknown>, references: Reference[], bboxFor: (content: string, page: number) => number[] | null): Passage {
  const sectionId = path.length ? sectionSlug(path) : "unsectioned";
  const bbox = bboxFor(content, page);
  return {
    ordinal, chunk_type: type, heading_path: path, content, content_sha256: sha256(content), token_count: tokenCount(content),
    page_from: page, page_to: page, paragraph_from: para, paragraph_to: para,
    anchor: { kind: "paper", page, sectionId, ...(bbox ? { bbox } : {}) } as JsonValue, metadata: { ...metadata, citations: citationOrdinals(content, references) } as JsonValue,
  };
}

/** Reading-order chunks are page and section bounded; display equations are kept whole. */
export function chunkPaper(parsed: ParseOutput, references = paperReferences(parsed)): Passage[] {
  const passages: Passage[] = [];
  const bboxFor = createBBoxMatcher(parsed.coordinates);
  const headings = new Map<number, Map<string, Array<(typeof parsed.headings)[number]>>>();
  for (const heading of parsed.headings) {
    const byText = headings.get(heading.page) ?? new Map();
    byText.set(heading.text.trim(), [...(byText.get(heading.text.trim()) ?? []), heading]);
    headings.set(heading.page, byText);
  }
  let headingPath: string[] = [];
  for (const page of parsed.pages) {
    let paragraph = 0;
    const lines = page.text.split(/\r?\n/);
    let block: string[] = [];
    let fenced = false;
    let displayMath = false;
    const flush = () => {
      const content = block.join("\n").trim();
      block = [];
      if (!content) return;
      if (/^```/.test(content)) {
          passages.push(buildPassage(passages.length, "code", content, headingPath, page.page, null, {}, references, bboxFor));
      } else {
        const heading = /^#{1,6}\s+(.+)$/.exec(content);
        const parserHeading = heading ? headings.get(page.page)?.get(heading[1]!.trim())?.shift() : undefined;
        if (heading && parserHeading) {
          headingPath = parserHeading.hierarchy;
          passages.push(buildPassage(passages.length, "heading", heading[1]!.trim(), headingPath, page.page, null, {}, references, bboxFor));
          return;
        }
        if (content.split("\n").every((tableLine) => /^\|.*\|$/.test(tableLine))) {
          passages.push(buildPassage(passages.length, "table", content, headingPath, page.page, null, {}, references, bboxFor));
          return;
        }
        const caption = /^(figure|fig\.?|table)\s*([\d.]+)\s*[:.)-]\s*(.+)$/i.exec(content);
        if (caption) {
          const isTable = /^table/i.test(caption[1]!);
          const label = `${isTable ? "Table" : "Figure"} ${caption[2]}`;
          passages.push(buildPassage(passages.length, isTable ? "table" : "figure", content, headingPath, page.page, null, { label, caption: caption[3] }, references, bboxFor));
          return;
        }
        const equation = parsed.equations.find((item) => item.page === page.page && item.source.trim() === content);
        if (equation || /^\$\$[\s\S]*\$\$$/.test(content) || /^\\\[[\s\S]*\\\]$/.test(content)) {
          const equationLabel = /(?:Eq\.?|Equation)\s*\(?([\d]+)\)?/i.exec(content);
          const label = equationLabel ? `Eq. (${equationLabel[1]})` : undefined;
          passages.push(buildPassage(passages.length, "equation", content, headingPath, page.page, null, { ...(label ? { label } : {}), latex: content }, references, bboxFor));
          return;
        }
        paragraph += 1;
        for (const part of splitLongParagraph(content)) passages.push(buildPassage(passages.length, "paragraph", part, headingPath, page.page, paragraph, {}, references, bboxFor));
      }
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) { block.push(line); fenced = !fenced; if (!fenced) flush(); continue; }
      if (fenced) { block.push(line); continue; }
      if (/^\s*(?:\$\$|\\\[)/.test(line)) { displayMath = true; block.push(line); if (/\$\$\s*$/.test(line) && !/^\s*\$\$\s*$/.test(line)) displayMath = false; continue; }
      if (displayMath) { block.push(line); if (/\$\$\s*$|\\\]\s*$/.test(line)) displayMath = false; continue; }
      if (!line.trim()) { flush(); continue; }
      block.push(line.trim());
    }
    flush();
  }
  return passages;
}

function normalizeTitle(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];
}

export function referenceTitle(raw: string): string {
  const quoted = /["“]([^"”]{8,240})["”]/.exec(raw)?.[1];
  if (quoted) return quoted.replace(/\*/g, "").trim();
  const body = raw.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, "").replace(/\*/g, "");
  const sentences = body.split(/(?<!\b[A-Z])\.\s+/).map((part) => part.trim()).filter(Boolean);
  const titleSentence = sentences.find((part, index) => index > 0 && part.split(/\s+/).length >= 3 && !/^(?:in\b|arxiv\b|proceedings\b|journal\b)/i.test(part));
  return (titleSentence ?? body).replace(/[.,;:]$/, "").slice(0, 240);
}

export function titleSimilarity(left: string, right: string): number {
  const a = new Set(normalizeTitle(left)); const b = new Set(normalizeTitle(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / new Set([...a, ...b]).size;
}

function referenceTextIdentifiers(raw: string): Pick<ReferenceCandidate, "doi" | "arxivId"> {
  const arxiv = /(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/i.exec(raw)?.[1];
  const doi = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)?(10\.\d{4,9}\/[\w.()\-/;:+]+)/i.exec(raw)?.[1]?.replace(/[.,;:]+$/, "") ?? null;
  return { doi, arxivId: arxiv?.replace(/v\d+$/i, "") ?? null };
}

export function exaReferenceClient(exaApiKey: string, fetcher?: typeof fetch): PaperReferenceClient {
  return {
    async search(query) {
      const wait = nextExaRequestAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      nextExaRequestAt = Date.now() + 1_000;
      const batch = await instantDiscovery({ query_text: query, source_kind: "paper", ranking_intent: "best_match", limit: 5 }, { exaApiKey, ...(fetcher ? { fetch: fetcher } : {}) });
      return batch.arxiv.map((paper) => ({
        title: paper.title, authors: paper.authors, year: paper.published_at ? new Date(paper.published_at).getUTCFullYear() : null,
        doi: null, arxivId: paper.arxiv_id, venue: null, url: paper.canonical_url, abstract: paper.abstract, source: "exa" as const,
      }));
    },
  };
}

/** A match is accepted only at >=0.85 title Jaccard with year within one year or matching first-author surname. */
export async function resolvePaperReference(reference: Reference, client?: PaperReferenceClient): Promise<{ status: "resolved" | "ambiguous" | "unresolved"; confidence: number | null; candidate: ReferenceCandidate | null }> {
  const identifiers = referenceTextIdentifiers(reference.raw);
  if (identifiers.doi || identifiers.arxivId) {
    return {
      status: "resolved", confidence: 1,
      candidate: { title: referenceTitle(reference.raw), authors: [], year: referenceAuthorYear(reference.raw).year, ...identifiers, venue: null, url: identifiers.arxivId ? `https://arxiv.org/abs/${identifiers.arxivId}` : `https://doi.org/${identifiers.doi}`, abstract: null, source: "reference-text" },
    };
  }
  const title = referenceTitle(reference.raw);
  if (!client || normalizeTitle(title).length < 3) return { status: "unresolved", confidence: null, candidate: null };
  const candidates = await client.search(title);
  const signals = referenceAuthorYear(reference.raw);
  const accepted = candidates.map((candidate) => {
    const similarity = titleSimilarity(title, candidate.title);
    const yearMatch = Boolean(signals.year && candidate.year && Math.abs(signals.year - candidate.year) <= 1);
    const firstAuthorMatch = Boolean(signals.author && candidate.authors.some((author) => author.toLowerCase().split(/\s+/).at(-1)?.replace(/[^\p{L}]/gu, "") === signals.author!.toLowerCase()));
    return { candidate, similarity, yearMatch, firstAuthorMatch };
  }).filter((match) => match.similarity >= 0.85 && (match.yearMatch || match.firstAuthorMatch)).sort((a, b) => b.similarity - a.similarity);
  if (!accepted.length) return { status: "unresolved", confidence: null, candidate: null };
  const top = accepted[0]!;
  const ambiguous = accepted.length > 1 && Math.abs(top.similarity - accepted[1]!.similarity) < 0.03;
  return ambiguous ? { status: "ambiguous", confidence: null, candidate: null }
    : { status: "resolved", confidence: Math.min(1, top.similarity * (top.yearMatch && top.firstAuthorMatch ? 1 : 0.95)), candidate: top.candidate };
}

function parserMetadata(parsed: ParseOutput, source: PdfSource): Record<string, unknown> {
  return { parser: parsed.metadata.parser, parserVersion: `${parsed.metadata.parserSha}/${source === "verified-native" ? "fast" : "standard"}`, parserPath: parsed.metadata.path, parserDurationMs: parsed.metadata.durationMs, parserProcessingMs: parsed.metadata.parserProcessingMs, parserSource: source, unrecovered: parsed.unrecovered };
}

async function claimVersion(sql: SqlClient, resourceId: string, hash: string, byteSize: number, url: string, downloadedAt: string, downloadMs: number): Promise<VersionRow | null> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${resourceId}))`;
    const [existing] = await tx<VersionRow[]>`
      SELECT v.id, v.processing_status, v.processing_attempts, v.lease_expires_at, v.retry_after, v.metadata, r.metadata AS resource_metadata
      FROM catalog.resource_versions v JOIN catalog.resources r ON r.id = v.resource_id WHERE v.resource_id = ${resourceId} AND v.source_sha256 = ${hash}`;
    if (existing?.processing_status === "ready") {
      const refreshState = record(existing.resource_metadata.paperIngestionRefresh);
      const refreshIsCurrent = refreshState.versionId === existing.id
        && Number(refreshState.chunkerVersion) >= CHUNKER_VERSION
        && Number(refreshState.referenceResolverVersion) >= REFERENCE_RESOLVER_VERSION
        && refreshState.exaSearchConfigured === Boolean(process.env.EXA_API_KEY);
      if (!refreshIsCurrent) {
        return { ...existing, refreshReady: true };
      }
      await tx`UPDATE catalog.resources SET current_version_id = ${existing.id}, status = 'ready', updated_at = now() WHERE id = ${resourceId} AND current_version_id IS DISTINCT FROM ${existing.id}`;
      return null;
    }
    let versionId = existing?.id;
    if (!versionId) {
      const [{ next } = { next: 1 }] = await tx<{ next: number }[]>`SELECT coalesce(max(version_no), 0)::int + 1 AS next FROM catalog.resource_versions WHERE resource_id = ${resourceId}`;
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO catalog.resource_versions (resource_id, version_no, source_sha256, raw_object_key, mime_type, byte_size, parser_name, parser_version, processing_status, fetched_at, metadata)
        VALUES (${resourceId}, ${next}, ${hash}, ${`external/${resourceId}/${hash}`}, 'application/pdf', ${byteSize}, 'pdf-inspector-researchpapers', 'pending', 'pending', ${downloadedAt}, ${tx.json({ sourceUrl: url, downloadedAt, timings: { downloadMs } })})
        ON CONFLICT (resource_id, source_sha256) DO NOTHING RETURNING id`;
      versionId = created?.id;
      if (!versionId) {
        const [raced] = await tx<{ id: string }[]>`SELECT id FROM catalog.resource_versions WHERE resource_id = ${resourceId} AND source_sha256 = ${hash}`;
        versionId = raced?.id;
      }
    }
    if (!versionId) throw new Error("could not create paper resource version");
    const [claimed] = await tx<VersionRow[]>`
      UPDATE catalog.resource_versions
      SET processing_status = 'processing', processing_attempts = processing_attempts + 1,
          retry_after = NULL, lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second',
          fetched_at = coalesce(fetched_at, ${downloadedAt}),
          metadata = metadata || ${tx.json({ sourceUrl: url, downloadedAt, timings: { downloadMs } })}
      WHERE id = ${versionId}
        AND processing_status <> 'ready'
        AND processing_attempts < ${MAX_ATTEMPTS}
        AND (processing_status <> 'processing' OR lease_expires_at IS NULL OR lease_expires_at < now())
        AND (retry_after IS NULL OR retry_after <= now())
      RETURNING id, processing_status, processing_attempts, lease_expires_at, retry_after, metadata`;
    return claimed ?? null;
  });
}

async function updateVersionMetadata(sql: SqlClient, versionId: string, metadata: Record<string, unknown>): Promise<void> {
  await sql`UPDATE catalog.resource_versions SET metadata = metadata || ${sql.json(metadata as JsonValue)}, lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second' WHERE id = ${versionId} AND processing_status = 'processing'`;
}

function referenceCounts(references: Array<{ status: string }>): { resolved: number; ambiguous: number; unresolved: number } {
  return {
    resolved: references.filter((reference) => reference.status === "resolved").length,
    ambiguous: references.filter((reference) => reference.status === "ambiguous").length,
    unresolved: references.filter((reference) => reference.status === "unresolved").length,
  };
}

async function buildParsed(bytes: Uint8Array, url: URL, parse: typeof parsePaperPdf): Promise<{ parsed: ParseOutput; source: PdfSource; durationMs: number }> {
  const started = performance.now();
  const detected = await parse(bytes, { source: "untrusted" });
  const source = choosePaperPdfSource(url, detected);
  const parsed = source === "verified-native" ? await parse(bytes, { source }) : detected;
  return { parsed, source, durationMs: Math.round(performance.now() - started) };
}

function storedReferences(metadata: Record<string, unknown>): Array<{ ordinal: number; raw: string }> {
  return Array.isArray(metadata.rawReferences) ? metadata.rawReferences.flatMap((value) => {
    const item = record(value);
    return Number.isInteger(item.ordinal) && typeof item.raw === "string" ? [{ ordinal: Number(item.ordinal), raw: item.raw }] : [];
  }) : [];
}

async function resolveReferences(references: Reference[], client?: PaperReferenceClient): Promise<Array<{ ordinal: number; raw: string; status: string; confidence: number | null; candidate: ReferenceCandidate | null }>> {
  const resolvedClient = client ?? (process.env.EXA_API_KEY ? exaReferenceClient(process.env.EXA_API_KEY) : undefined);
  const output: Array<{ ordinal: number; raw: string; status: string; confidence: number | null; candidate: ReferenceCandidate | null }> = [];
  let exaSearches = 0;
  for (const reference of references) {
    try {
      const inline = referenceTextIdentifiers(reference.raw);
      const canSearch = !inline.doi && !inline.arxivId && Boolean(resolvedClient) && exaSearches < MAX_EXA_REFERENCE_SEARCHES;
      if (canSearch) exaSearches += 1;
      const resolved = await resolvePaperReference(reference, canSearch ? resolvedClient : undefined);
      output.push({ ...reference, ...resolved });
    } catch {
      output.push({ ...reference, status: "unresolved", confidence: null, candidate: null });
    }
  }
  return output;
}

async function embedPassages(sql: SqlClient, provider: EmbeddingProvider, versionId: string): Promise<number> {
  const rows = await sql<{ id: string; content: string }[]>`
    SELECT c.id, c.content FROM retrieval.resource_chunks c
    WHERE c.resource_version_id = ${versionId}
      AND (c.chunk_type = 'paragraph' OR (c.chunk_type IN ('figure', 'table') AND c.metadata ? 'caption'))
      AND NOT EXISTS (SELECT 1 FROM retrieval.chunk_embeddings e WHERE e.chunk_id = c.id AND e.embedding_profile_id = ${TRANSCRIPT_EMBEDDING_PROFILE})
    ORDER BY c.ordinal`;
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const vectors = await provider.embedDocuments(batch.map((row) => row.content));
    if (vectors.length !== batch.length) throw new Error("embedding response length did not match paper passages");
    await sql`INSERT INTO retrieval.chunk_embeddings ${sql(batch.map((row, index) => ({ chunk_id: row.id, embedding_profile_id: TRANSCRIPT_EMBEDDING_PROFILE, embedding: JSON.stringify(vectors[index]) })))} ON CONFLICT DO NOTHING`;
    embedded += batch.length;
  }
  return embedded;
}

async function commitReady(sql: SqlClient, resourceId: string, versionId: string, references: Array<{ ordinal: number; raw: string; status: string; confidence: number | null; candidate: ReferenceCandidate | null }>, metadata: Record<string, unknown>): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${resourceId}))`;
    await savePaperReferences(tx, resourceId, references);
    await tx`UPDATE catalog.resource_versions SET processing_status = 'ready', failure_code = NULL, failure_detail = NULL, retry_after = NULL, lease_expires_at = NULL, ready_at = now(), metadata = metadata || ${tx.json(metadata as JsonValue)} WHERE id = ${versionId} AND processing_status = 'processing'`;
      await tx`UPDATE catalog.resources SET current_version_id = ${versionId}, status = 'ready', updated_at = now(), metadata = metadata || ${tx.json({ paperIngestionRefresh: { versionId, chunkerVersion: CHUNKER_VERSION, referenceResolverVersion: REFERENCE_RESOLVER_VERSION, exaSearchConfigured: Boolean(process.env.EXA_API_KEY) } })} WHERE id = ${resourceId}`;
  });
}

async function savePaperReferences(tx: TransactionClient, resourceId: string, references: Array<{ ordinal: number; raw: string; status: string; confidence: number | null; candidate: ReferenceCandidate | null }>): Promise<void> {
  await tx`DELETE FROM catalog.paper_references WHERE paper_resource_id = ${resourceId} AND NOT (ordinal = ANY(${references.map((reference) => reference.ordinal)}::int[]))`;
  for (const reference of references) {
    const candidate = reference.candidate;
    const doi = candidate?.doi ?? null;
    const arxivId = candidate?.arxivId ?? null;
    const [catalog] = candidate ? await tx<{ id: string }[]>`
      SELECT r.id FROM catalog.resources r LEFT JOIN catalog.paper_details p ON p.resource_id = r.id
      WHERE (${arxivId}::text IS NOT NULL AND p.arxiv_id = ${arxivId}) OR (${doi}::text IS NOT NULL AND lower(p.doi) = lower(${doi})) LIMIT 1` : [];
    const verifiedMetadata = candidate ? {
      title: candidate.title, authors: candidate.authors, year: candidate.year, venue: candidate.venue,
      url: candidate.url, source: candidate.source ?? "exa", ...(candidate.abstract ? { abstract: candidate.abstract } : {}),
    } : {};
    await tx`
      INSERT INTO catalog.paper_references (paper_resource_id, ordinal, raw_reference, cited_resource_id, cited_doi, cited_arxiv_id, resolution_status, confidence, metadata)
      VALUES (${resourceId}, ${reference.ordinal}, ${reference.raw}, ${catalog?.id ?? null}, ${doi}, ${arxivId}, ${reference.status}, ${reference.confidence}, ${tx.json(verifiedMetadata)})
      ON CONFLICT (paper_resource_id, ordinal) DO UPDATE SET raw_reference = EXCLUDED.raw_reference, cited_resource_id = EXCLUDED.cited_resource_id,
        cited_doi = EXCLUDED.cited_doi, cited_arxiv_id = EXCLUDED.cited_arxiv_id, resolution_status = EXCLUDED.resolution_status,
        confidence = EXCLUDED.confidence, metadata = EXCLUDED.metadata`;
  }
}

async function refreshReadyVersion(sql: SqlClient, paper: PaperRow, version: VersionRow, bytes: Uint8Array, url: URL, downloadMs: number, started: number, deps: IngestionDeps): Promise<{ status: "ready" | "failed"; versionId: string; error?: string }> {
  const parseStarted = performance.now();
  const result = await buildParsed(bytes, url, deps.parse ?? parsePaperPdf);
  const parseMs = result.durationMs || Math.round(performance.now() - parseStarted);
  if (result.parsed.classification.pagesNeedingOcr.length || result.parsed.pages.some((page) => page.needsOcr)) {
    return { status: "failed", versionId: version.id, error: "needs_ocr" };
  }
  const rawReferences = paperReferences(result.parsed);
  const chunkStarted = performance.now();
  const passagesById = await sql<{ id: string; content: string; page_from: number | null; page_to: number | null; anchor: Record<string, unknown> }[]>`
    SELECT id, content, page_from, page_to, anchor FROM retrieval.resource_chunks WHERE resource_version_id = ${version.id} ORDER BY ordinal`;
  const bboxFor = createBBoxMatcher(result.parsed.coordinates);
  const anchorUpdates = passagesById.flatMap((chunk) => {
    if (!chunk.page_from || chunk.page_from !== chunk.page_to) return [];
    const anchor = { ...chunk.anchor };
    delete anchor.bbox;
    const bbox = bboxFor(chunk.content, chunk.page_from);
    if (bbox) anchor.bbox = bbox;
    return [{ id: chunk.id, anchor }];
  });
  const chunkMs = Math.round(performance.now() - chunkStarted);
  const resolutionStarted = performance.now();
  const resolved = await resolveReferences(rawReferences, deps.referenceClient);
  const resolveMs = Math.round(performance.now() - resolutionStarted);
  const timings = { downloadMs, parseMs, chunkMs, resolveMs, embedMs: 0, totalMs: Math.round((deps.now ?? (() => performance.now()))() - started) };
  const metadata: Record<string, unknown> = {
    ...parserMetadata(result.parsed, result.source), parserComplete: true, rawReferences,
    resolvedReferences: resolved, chunkerVersion: CHUNKER_VERSION, referenceResolverVersion: REFERENCE_RESOLVER_VERSION,
    exaSearchConfigured: Boolean(process.env.EXA_API_KEY), timings,
  };
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${paper.id}))`;
    if (anchorUpdates.length) await tx`
      WITH updated AS (SELECT id, anchor FROM jsonb_to_recordset(${tx.json(anchorUpdates as unknown as JsonValue)}::jsonb) AS row(id uuid, anchor jsonb))
      UPDATE retrieval.resource_chunks AS chunk SET anchor = updated.anchor FROM updated WHERE chunk.id = updated.id`;
    await savePaperReferences(tx, paper.id, resolved);
    await tx`UPDATE catalog.resources SET metadata = metadata || ${tx.json({ paperIngestionRefresh: { versionId: version.id, chunkerVersion: CHUNKER_VERSION, referenceResolverVersion: REFERENCE_RESOLVER_VERSION, exaSearchConfigured: Boolean(process.env.EXA_API_KEY) } })} WHERE id = ${paper.id}`;
  });
  const counts = referenceCounts(resolved);
  console.info(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, versionId: version.id, status: "ready", chunks: passagesById.length, refs: rawReferences.length, ...counts, bboxChunks: anchorUpdates.filter((chunk) => Array.isArray(chunk.anchor.bbox)).length, embeddedChunks: 0, ...timings }));
  return { status: "ready", versionId: version.id };
}

async function failVersion(sql: SqlClient, versionId: string, attempts: number, code: string, detail: string, retryable: boolean): Promise<void> {
  const seconds = Math.min(600, 30 * 2 ** Math.max(0, attempts - 1));
  const status = retryable && attempts < MAX_ATTEMPTS ? "pending" : "failed";
  await sql.begin(async (tx) => {
    const [failed] = await tx<{ resource_id: string }[]>`
      UPDATE catalog.resource_versions SET processing_status = ${status}, failure_code = ${code}, failure_detail = ${detail.slice(0, 500)},
        retry_after = ${status === "pending" ? new Date(Date.now() + seconds * 1000) : null}, lease_expires_at = NULL
      WHERE id = ${versionId} AND processing_status = 'processing' RETURNING resource_id`;
    if (status === "failed" && failed) await tx`UPDATE catalog.resources SET status = 'failed' WHERE id = ${failed.resource_id} AND current_version_id IS NULL`;
  });
}

function acquisitionAttempts(paper: PaperRow): number {
  const attempts = Number(record(paper.metadata.paperIngestion).attempts);
  return Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
}

async function failAcquisition(sql: SqlClient, paper: PaperRow, code: string, detail: string, retryable: boolean): Promise<void> {
  const attempts = acquisitionAttempts(paper) + 1;
  const pending = retryable && attempts < MAX_ATTEMPTS;
  const seconds = Math.min(600, 30 * 2 ** Math.max(0, attempts - 1));
  const retryAfter = pending ? new Date(Date.now() + seconds * 1000).toISOString() : null;
  const metadata = { paperIngestion: { attempts, retryAfter, failureCode: code, failureDetail: detail.slice(0, 500) } };
  await sql`
    UPDATE catalog.resources SET
      status = CASE WHEN current_version_id IS NULL THEN ${pending ? "pending" : "failed"}::catalog.resource_status ELSE status END,
      metadata = metadata || ${sql.json(metadata)}
    WHERE id = ${paper.id}`;
}

async function attemptPaper(sql: SqlClient, paper: PaperRow, provider: EmbeddingProvider | null, deps: IngestionDeps): Promise<{ status: "ready" | "busy" | "skipped" | "failed"; versionId?: string; error?: string }> {
  const start = (deps.now ?? (() => performance.now()))();
  const acquisition = record(paper.metadata.paperIngestion);
  if (acquisitionAttempts(paper) >= MAX_ATTEMPTS || (typeof acquisition.retryAfter === "string" && Date.parse(acquisition.retryAfter) > Date.now())) return { status: "skipped" };
  const pdfUrl = paper.arxiv_id ? arxivPdfUrl(paper.arxiv_id) : paper.pdf_source_url;
  const startUrl = pdfUrl ? trustedPdfUrl(pdfUrl) : null;
  if (!startUrl) {
    const error = "paper PDF URL is not allow-listed";
    await failAcquisition(sql, paper, "source_not_allowed", error, false);
    console.warn(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, status: "failed", error }));
    return { status: "failed", error };
  }
  let download: DownloadedPdf;
  try { download = await (deps.fetchPdf ?? ((url) => downloadPaperPdf(url, fetch, deps.now)))(startUrl); }
  catch (error) {
    const detail = error instanceof Error ? error.message : "paper download failed";
    await failAcquisition(sql, paper, "download_failed", detail, true);
    console.warn(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, status: "failed", downloadMs: Math.round((deps.now ?? (() => performance.now()))() - start), error: detail.slice(0, 300) }));
    return { status: "failed", error: detail };
  }
  if (download.bytes.byteLength > MAX_PDF_BYTES) {
    const error = "paper PDF exceeds parser byte limit";
    await failAcquisition(sql, paper, "pdf_too_large", error, false);
    console.warn(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, status: "failed", downloadMs: download.durationMs, error }));
    return { status: "failed", error };
  }
  await sql`UPDATE catalog.resources SET metadata = metadata - 'paperIngestion' WHERE id = ${paper.id}`;
  const hash = sha256(download.bytes);
  const version = await claimVersion(sql, paper.id, hash, download.bytes.byteLength, download.url.href, download.downloadedAt, download.durationMs);
  if (!version) return { status: "skipped" };
  if (version.refreshReady) {
    try { return await refreshReadyVersion(sql, paper, version, download.bytes, download.url, download.durationMs, start, deps); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "paper refresh failed";
      console.warn(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, versionId: version.id, status: "failed", error: detail.slice(0, 300) }));
      return { status: "failed", versionId: version.id, error: detail };
    }
  }
  const versionId = version.id;
  const timings: Record<string, number> = { ...record(version.metadata.timings) as Record<string, number>, downloadMs: download.durationMs };
  let refRows = storedReferences(version.metadata);
  let parserComplete = version.metadata.parserComplete === true;
  try {
    let parsedInfo: Record<string, unknown> = {};
    if (!parserComplete) {
      const parsedStarted = performance.now();
      const result = await buildParsed(download.bytes, download.url, deps.parse ?? parsePaperPdf);
      timings.parseMs = result.durationMs || Math.round(performance.now() - parsedStarted);
      if (result.parsed.classification.pagesNeedingOcr.length || result.parsed.pages.some((page) => page.needsOcr)) {
        await failVersion(sql, versionId, version.processing_attempts, "needs_ocr", "PDF pages require OCR; OCR is not available in this pipeline.", false);
        console.warn(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, versionId, status: "failed", failureCode: "needs_ocr", ...timings }));
        return { status: "failed", versionId, error: "needs_ocr" };
      }
      const chunkStarted = performance.now();
      refRows = paperReferences(result.parsed);
      const passages = chunkPaper(result.parsed, refRows);
      timings.chunkMs = Math.round(performance.now() - chunkStarted);
      parsedInfo = { ...parserMetadata(result.parsed, result.source), parserComplete: true, rawReferences: refRows, chunkerVersion: CHUNKER_VERSION };
      await sql.begin(async (tx) => {
        if (passages.length) await tx`INSERT INTO retrieval.resource_chunks ${tx(passages.map((passage) => ({ resource_version_id: versionId, ...passage })))}`;
        await tx`UPDATE catalog.resource_versions SET parser_name = 'pdf-inspector-researchpapers', parser_version = ${parsedInfo.parserVersion as string}, metadata = metadata || ${tx.json({ ...parsedInfo, timings })}, lease_expires_at = now() + ${LEASE_SECONDS} * interval '1 second' WHERE id = ${versionId} AND processing_status = 'processing'`;
      });
      parserComplete = true;
    }
    const referenceStart = performance.now();
    const resolverCurrent = Number(version.metadata.referenceResolverVersion) >= REFERENCE_RESOLVER_VERSION && version.metadata.exaSearchConfigured === Boolean(process.env.EXA_API_KEY);
    let resolved = resolverCurrent && Array.isArray(version.metadata.resolvedReferences)
      ? version.metadata.resolvedReferences as Awaited<ReturnType<typeof resolveReferences>>
      : await resolveReferences(refRows, deps.referenceClient);
    timings.resolveMs = Math.round(performance.now() - referenceStart);
    await updateVersionMetadata(sql, versionId, { resolvedReferences: resolved, referenceResolverVersion: REFERENCE_RESOLVER_VERSION, exaSearchConfigured: Boolean(process.env.EXA_API_KEY), timings });
    if (!provider) throw new Error("embedding provider is unavailable");
    const embeddingStart = performance.now();
    const embedded = await embedPassages(sql, provider, versionId);
    timings.embedMs = Math.round(performance.now() - embeddingStart);
    timings.totalMs = Math.round((deps.now ?? (() => performance.now()))() - start);
    await commitReady(sql, paper.id, versionId, resolved, { timings, embeddedChunks: embedded, downloadUrl: download.url.href, chunkerVersion: CHUNKER_VERSION, referenceResolverVersion: REFERENCE_RESOLVER_VERSION, exaSearchConfigured: Boolean(process.env.EXA_API_KEY) });
    console.info(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, versionId, status: "ready", chunks: await countPassages(sql, versionId), refs: refRows.length, ...referenceCounts(resolved), bboxChunks: await countBBoxPassages(sql, versionId), ...timings }));
    return { status: "ready", versionId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "paper ingestion failed";
    const parserFailure = !parserComplete || /PDF parsing|parser|needs_ocr|invalid PDF/i.test(detail);
    await failVersion(sql, versionId, version.processing_attempts, parserFailure ? "parse_failed" : "ingestion_failed", detail, !parserFailure);
    console.warn(JSON.stringify({ metric: "paper_ingestion", resourceId: paper.id, versionId, status: "failed", error: detail.slice(0, 300) }));
    return { status: "failed", versionId, error: detail };
  }
}

async function countPassages(sql: SqlClient, versionId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
  return row?.count ?? 0;
}

async function countBBoxPassages(sql: SqlClient, versionId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId} AND chunk_type = 'paragraph' AND anchor ? 'bbox'`;
  return row?.count ?? 0;
}

async function nextPaper(sql: SqlClient): Promise<PaperRow | null> {
  const [row] = await sql<PaperRow[]>`
    SELECT r.id, p.pdf_source_url, p.arxiv_id, r.title, r.status, r.metadata
    FROM catalog.resources r JOIN catalog.paper_details p ON p.resource_id = r.id
    LEFT JOIN catalog.resource_versions current ON current.id = r.current_version_id
    WHERE r.type = 'paper' AND r.deleted_at IS NULL AND r.status = 'pending'
      AND coalesce((r.metadata->'paperIngestion'->>'attempts')::int, 0) < ${MAX_ATTEMPTS}
      AND (r.metadata->'paperIngestion'->>'retryAfter' IS NULL OR (r.metadata->'paperIngestion'->>'retryAfter')::timestamptz <= now())
      AND (
        (current.processing_status = 'pending' AND (current.retry_after IS NULL OR current.retry_after <= now()))
        OR (current.processing_status = 'processing' AND current.processing_attempts < ${MAX_ATTEMPTS} AND (current.lease_expires_at IS NULL OR current.lease_expires_at < now()))
        OR (r.current_version_id IS NULL AND NOT EXISTS (SELECT 1 FROM catalog.resource_versions v WHERE v.resource_id = r.id))
        OR (r.current_version_id IS NULL AND EXISTS (
          SELECT 1 FROM catalog.resource_versions v WHERE v.resource_id = r.id AND v.processing_attempts < ${MAX_ATTEMPTS}
            AND ((v.processing_status = 'pending' AND (v.retry_after IS NULL OR v.retry_after <= now()))
              OR (v.processing_status = 'processing' AND (v.lease_expires_at IS NULL OR v.lease_expires_at < now())))
        ))
      )
    ORDER BY r.updated_at, r.id LIMIT 1`;
  return row ?? null;
}

export async function ingestPaperById(sql: SqlClient, resourceId: string, provider: EmbeddingProvider | null, deps: IngestionDeps = {}) {
  const [paper] = await sql<PaperRow[]>`
    SELECT r.id, p.pdf_source_url, p.arxiv_id, r.title, r.status, r.metadata FROM catalog.resources r
    JOIN catalog.paper_details p ON p.resource_id = r.id WHERE r.id = ${resourceId} AND r.type = 'paper'`;
  return paper ? attemptPaper(sql, paper, provider, deps) : { status: "skipped" as const };
}

/** Claims and ingests one paper per worker tick so PDF parsing and API calls cannot monopolize discovery lanes. */
export async function paperIngestionUpkeep(sql: SqlClient, provider: EmbeddingProvider | null, limit = 1, deps: IngestionDeps = {}): Promise<{ ready: number; failed: number; busy: number }> {
  const result = { ready: 0, failed: 0, busy: 0 };
  for (let index = 0; index < limit; index += 1) {
    const paper = await nextPaper(sql);
    if (!paper) break;
    const outcome = await attemptPaper(sql, paper, provider, deps);
    if (outcome.status === "ready") result.ready += 1;
    if (outcome.status === "failed") result.failed += 1;
    if (outcome.status === "busy") result.busy += 1;
    if (outcome.status === "skipped") break;
  }
  return result;
}

export async function runPaperIngestionWorker(options: { loop?: boolean; intervalMs?: number; signal?: AbortSignal } = {}) {
  const databaseUrl = process.env.DATABASE_WORKER_URL;
  if (!databaseUrl) throw new Error("DATABASE_WORKER_URL is required");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const provider = (await import("./embeddings.js")).embeddingProvider();
  try {
    if (!options.loop) return await paperIngestionUpkeep(sql, provider);
    let ready = 0; let failed = 0;
    while (!options.signal?.aborted) {
      const result = await paperIngestionUpkeep(sql, provider);
      ready += result.ready; failed += result.failed;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, options.intervalMs ?? 30_000);
        const signal = options.signal;
        function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
        if (signal?.aborted) done(); else signal?.addEventListener("abort", done, { once: true });
      });
    }
    return { ready, failed };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

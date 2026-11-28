import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { ParseOutput } from "@learnspace/pdf-parser";
import {
  chunkPaper,
  choosePaperPdfSource,
  downloadPaperPdf,
  exaReferenceClient,
  ingestPaperById,
  markdownToParseOutput,
  matchChunkBBox,
  paperReferences,
  paperIngestionUpkeep,
  referenceTitle,
  resolvePaperReference,
  titleSimilarity,
  type PaperReferenceClient,
} from "./paper-ingestion.js";

const parsed = (text = "# Method\n\nWe propose a robust model [1] and compare with [3–5].\n\n$$x = y + z$$\n\n| A | B |\n|---|---|\n| 1 | 2 |", references = ["[1] Smith, J. et al. \"Robust Retrieval Models\". Journal, 2021.", "[3] Unrelated entry.", "[4] Another unrelated entry.", "[5] Yet another entry."]): ParseOutput => ({
  text, markdown: text,
  pages: [{ page: 1, text, needsOcr: false, ocrReason: null }],
  headings: [{ level: 1, text: "Method", page: 1, hierarchy: ["Method"] }],
  tables: [{ page: 1, markdown: "| A | B |\n|---|---|\n| 1 | 2 |" }], captions: [], equations: [{ page: 1, source: "$$x = y + z$$" }],
  references: references.map((text) => ({ page: 1, text })), citationMarkers: [], coordinates: [],
  classification: { type: "TextBased", confidence: 1, pagesNeedingOcr: [], reasonsByPage: [] },
  metadata: { path: "standard-detection", parser: "pdf-inspector", version: "1", parserSha: "sha", durationMs: 2, parserProcessingMs: 1 },
  taggedStructure: [], unrecovered: [],
});

test("parser routing trusts only clean native detection from an allow-listed scholarly host", () => {
  const document = parsed();
  assert.equal(choosePaperPdfSource("https://arxiv.org/pdf/2401.12345", document), "verified-native");
  assert.equal(choosePaperPdfSource("https://example.org/paper.pdf", document), "untrusted");
  assert.equal(choosePaperPdfSource("https://arxiv.org/pdf/2401.12345", { ...document, pages: [{ ...document.pages[0]!, needsOcr: true }] }), "untrusted");
  assert.equal(choosePaperPdfSource("https://arxiv.org/pdf/2401.12345", { ...document, unrecovered: ["encoding issues detected"] }), "untrusted");
});

test("download rejects off-list redirects, wrong content types, oversized bodies and missing PDF magic", async () => {
  const redirect = new Response(null, { status: 302, headers: { location: "https://example.org/paper.pdf" } });
  await assert.rejects(downloadPaperPdf(new URL("https://arxiv.org/pdf/2401.12345"), async () => redirect), /redirected outside/);
  await assert.rejects(downloadPaperPdf(new URL("https://arxiv.org/pdf/2401.12345"), async () => new Response("not pdf", { headers: { "content-type": "text/plain" } })), /application\/pdf/);
  await assert.rejects(downloadPaperPdf(new URL("https://arxiv.org/pdf/2401.12345"), async () => new Response("not pdf", { headers: { "content-type": "application/pdf" } })), /magic bytes/);
});

test("paper passages keep section ids stable, equations whole and ordinals gap-free", () => {
  const output = chunkPaper(parsed());
  assert.deepEqual(output.map((item) => item.ordinal), output.map((_, index) => index));
  assert.equal(output[0]?.chunk_type, "heading");
  assert.equal((output[0]?.anchor as Record<string, unknown>)?.sectionId, "method");
  assert.equal(output[2]?.chunk_type, "equation");
  assert.equal(output[2]?.content, "$$x = y + z$$");
  assert.equal(output[3]?.chunk_type, "table");
  assert.deepEqual((output[1]?.metadata as Record<string, unknown>)?.citations, [1, 3, 4, 5]);
  assert.deepEqual(paperReferences(parsed("", ["[1] Smith. First source, 2021.", "[2] Jones. Second source, 2022.", "2018. 4, 6", "2025. URL only"])).map((reference) => reference.ordinal), [1, 2]);
  assert.equal(chunkPaper(parsed("# Method\n\nFigure 1: A result.", [])).filter((passage) => passage.chunk_type === "figure").length, 1);
  assert.deepEqual(chunkPaper(parsed())[0]?.anchor, output[0]?.anchor);
  const unmatched = chunkPaper(parsed("# Method\n\nNot in this bibliography [99].", ["[1] Known entry."]));
  assert.deepEqual((unmatched[1]?.metadata as Record<string, unknown>)?.citations, []);
  const authorYear = chunkPaper(parsed("# Method\n\nA prior result (Smith et al., 2021).", ["[1] Smith, J. et al. \"Robust Retrieval Models\". Journal, 2021."]));
  assert.deepEqual((authorYear[1]?.metadata as Record<string, unknown>)?.citations, [1]);
});

test("reference parsing splits merged entries and appends wrapped continuations", () => {
  const merged = paperReferences(parsed("", ["[2] A. First, First title. [3] B. Second, Second title."]));
  assert.deepEqual(merged, [
    { ordinal: 2, raw: "[2] A. First, First title." },
    { ordinal: 3, raw: "[3] B. Second, Second title." },
  ]);
  assert.deepEqual(paperReferences(parsed("", ["A. Unnumbered first reference.", "B. Unnumbered second reference."])).map((reference) => reference.ordinal), [1, 2]);
  const wrapped = paperReferences(parsed("", ["[1] M. Abadi, A. Agarwal, P. Barham, E. Brevdo,", "A. Davis, S. Ghemawat, and I. Goodfellow. TensorFlow: Large-scale machine learning on heterogeneous systems."]));
  assert.equal(wrapped.length, 1);
  assert.match(wrapped[0]!.raw, /A\. Davis, S\. Ghemawat/);
  assert.equal(referenceTitle("Quoc V. Le, Ed H. Chi, Aaron Courville. Attention Is All You Need. NeurIPS, 2023."), "Attention Is All You Need");
  assert.equal(referenceTitle('[1] Vaswani et al. "*Attention Is All You Need*". NeurIPS, 2017.'), "Attention Is All You Need");
});

test("bbox matching stays in reading order, unions item boxes and omits weak matches", () => {
  const coordinates = [
    { text: "Repeated phrase", page: 1, bbox: { x: 10, y: 20, width: 25, height: 5 }, font: "F", fontSize: 10 },
    { text: "Repeated phrase", page: 1, bbox: { x: 50, y: 20, width: 25, height: 5 }, font: "F", fontSize: 10 },
    { text: "short", page: 1, bbox: { x: 80, y: 20, width: 10, height: 5 }, font: "F", fontSize: 10 },
  ];
  const cursors = new Map<number, number>();
  assert.deepEqual(matchChunkBBox("Repeated phrase", 1, coordinates, cursors), [10, 20, 35, 25]);
  assert.deepEqual(matchChunkBBox("Repeated phrase", 1, coordinates, cursors), [50, 20, 75, 25]);
  assert.equal(matchChunkBBox("missing words with only short", 1, coordinates), null);
});

test("bbox matching ignores the same common words far down the page", () => {
  const line = (text: string, y: number) => ({ text, page: 1, bbox: { x: 100, y, width: 300, height: 10 }, font: "F", fontSize: 10 });
  const coordinates = [
    line("We introduce energy based reasoners", 700), line("that refine the latent state", 688),
    ...Array.from({ length: 30 }, (_, index) => line(`unrelated filler words number ${index}`, 600 - index * 12)),
    line("the state is refined by the model", 100),
  ];
  // Only the two lines of the passage: "the", "state" and "refined" also appear at y=100 and must not stretch the box.
  assert.deepEqual(matchChunkBBox("We introduce energy based reasoners that refine the latent state, refined by the model", 1, coordinates), [100, 688, 400, 710]);
});

test("reference resolution requires title and year or author agreement", async () => {
  const references = paperReferences(parsed());
  const reference = references[0]!;
  const match = { title: "Robust Retrieval Models", authors: ["Jordan Smith"], year: 2021, doi: "10.1234/rrm", arxivId: null, venue: "Journal", url: "https://doi.org/10.1234/rrm", abstract: null };
  assert.equal(titleSimilarity("Robust Retrieval Models", match.title), 1);
  const verified = await resolvePaperReference(reference, { async search() { return [match]; } });
  assert.equal(verified.status, "resolved");
  assert.equal(verified.candidate?.doi, match.doi);
  const ambiguous = await resolvePaperReference(reference, { async search() { return [match, { ...match, doi: "10.5678/rrm" }]; } });
  assert.equal(ambiguous.status, "ambiguous");
  const unresolved = await resolvePaperReference(reference, { async search() { return [{ ...match, title: "Completely Different", year: 1980, authors: ["Other Author"] }]; } });
  assert.equal(unresolved.status, "unresolved");
});

test("inline identifiers resolve before Exa and scholarly search uses Exa only", async () => {
  const client = exaReferenceClient("test-key", (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.exa.ai/search");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "test-key");
    return Response.json({ results: [{ title: "Robust Retrieval Models", url: "https://arxiv.org/abs/2401.12345v2", publishedDate: "2021-01-01", authors: ["Jordan Smith"], abstract: "abstract" }] });
  }) as typeof fetch);
  const inlineArxiv = await resolvePaperReference({ ordinal: 1, raw: "[1] Related work, arXiv:2502.17416v3." }, client);
  assert.equal(inlineArxiv.status, "resolved");
  assert.equal(inlineArxiv.confidence, 1);
  assert.equal(inlineArxiv.candidate?.arxivId, "2502.17416");
  assert.equal(inlineArxiv.candidate?.source, "reference-text");
  assert.equal((await resolvePaperReference({ ordinal: 2, raw: "[2] See https://arxiv.org/abs/2401.12345v2." }, client)).candidate?.arxivId, "2401.12345");
  const inlineDoi = await resolvePaperReference({ ordinal: 1, raw: "[1] Related work https://doi.org/10.1234/rrm." }, client);
  assert.equal(inlineDoi.candidate?.doi, "10.1234/rrm");
  const result = await resolvePaperReference(paperReferences(parsed())[0]!, client);
  assert.equal(result.status, "resolved");
  assert.equal(result.candidate?.source, "exa");
});

test("markdownToParseOutput converts Firecrawl article Markdown into chunkable paper passages", () => {
  const md = "# Grandmaster level in StarCraft II\n\nWe train AlphaStar with multi-agent reinforcement learning [1].\n\n## Methods\n\nLeague play prevents strategy cycling.\n\n## References\n\n[1] Silver et al. Mastering the game of Go. Nature, 2016.";
  const output = markdownToParseOutput(md, 42);
  const refs = paperReferences(output);
  const passages = chunkPaper(output, refs);
  assert.equal(output.metadata.parser, "firecrawl-markdown");
  assert.equal(refs.length, 1);
  assert.ok(passages.some((passage) => passage.chunk_type === "heading" && passage.content === "Methods"));
  assert.ok(passages.some((passage) => passage.chunk_type === "paragraph" && passage.content.includes("League play")));
});

const dbAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_WORKER_URL);
test("paper ingestion does not repeat parse or embedding for a hash and only publishes ready versions", { skip: dbAvailable ? false : "local worker database URLs are required" }, async () => {
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false });
  const worker = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false });
  const resourceId = randomUUID();
  const queueInvalidId = randomUUID();
  const queueValidId = randomUUID();
  const arxivId = `9999.${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
  const queueArxivId = `9998.${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
  const baseBytes = new TextEncoder().encode("%PDF-1.7 first version");
  const changedBytes = new TextEncoder().encode("%PDF-1.7 second version");
  let parseCalls = 0;
  let embedCalls = 0;
  const parse = async (bytes: Uint8Array, _options: { source: "verified-native" | "untrusted" }): Promise<ParseOutput> => {
    parseCalls += 1;
    const result = parsed("# Method\n\nA grounded paragraph.", []);
    if (bytes === changedBytes) {
      result.pages.push({ page: 2, text: "Unreliable text", needsOcr: true, ocrReason: "scanned" });
      result.classification.pagesNeedingOcr = [2];
    }
    return result;
  };
  const referenceClient: PaperReferenceClient = { async search() { return []; } };
  const provider = {
    async embedDocuments(texts: string[]) {
      embedCalls += 1;
      if (failEmbedding) throw new Error("temporary embedding failure");
      return texts.map(() => Array.from({ length: 1536 }, () => 0.01));
    },
    async embedQuery() { return Array.from({ length: 1536 }, () => 0.01); },
  };
  let failEmbedding = false;
  try {
    await migrator`INSERT INTO catalog.resources (id, type, provider, external_id, title, visibility, status) VALUES (${resourceId}, 'paper', 'arxiv', ${arxivId}, 'Paper ingestion integration', 'private', 'pending')`;
    let failedDownloads = 0;
    const failedDownload = () => ingestPaperById(worker, resourceId, provider, {
      fetchPdf: async () => { failedDownloads += 1; throw new Error("temporary download failure"); },
    });
    assert.equal((await failedDownload()).status, "failed");
    assert.equal((await failedDownload()).status, "skipped");
    assert.equal(failedDownloads, 1);
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await migrator`UPDATE catalog.resources SET metadata = jsonb_set(metadata, '{paperIngestion,retryAfter}', to_jsonb((now() - interval '1 second')::text)) WHERE id = ${resourceId}`;
      assert.equal((await failedDownload()).status, "failed");
    }
    const acquisitionFailure = (await worker<{ status: string; attempts: number }[]>`
      SELECT r.status, (r.metadata->'paperIngestion'->>'attempts')::int AS attempts FROM catalog.resources r WHERE r.id = ${resourceId}
    `)[0]!;
    assert.equal(acquisitionFailure.status, "failed");
    assert.equal(acquisitionFailure.attempts, 4);
    assert.equal((await failedDownload()).status, "skipped");
    await migrator`UPDATE catalog.resources SET status = 'pending', metadata = metadata - 'paperIngestion' WHERE id = ${resourceId}`;
    const run = (bytes: Uint8Array) => ingestPaperById(worker, resourceId, provider, {
      fetchPdf: async (url) => ({ bytes, url, downloadedAt: new Date().toISOString(), durationMs: 1 }),
      parse, referenceClient,
    });
    const first = await run(baseBytes);
    assert.equal(first.status, "ready");
    const firstPointer = (await worker<{ current_version_id: string }[]>`SELECT current_version_id FROM catalog.resources WHERE id = ${resourceId}`)[0]!.current_version_id;
    const firstParseCalls = parseCalls;
    const firstEmbedCalls = embedCalls;
    assert.equal((await run(baseBytes)).status, "skipped");
    assert.equal(parseCalls, firstParseCalls);
    assert.equal(embedCalls, firstEmbedCalls);
    await migrator`UPDATE catalog.resources SET metadata = metadata - 'paperIngestionRefresh' WHERE id = ${resourceId}`;
    assert.equal((await run(baseBytes)).status, "ready");
    assert.equal(parseCalls, firstParseCalls + 2);
    assert.equal(embedCalls, firstEmbedCalls);
    assert.equal((await run(baseBytes)).status, "skipped");

    failEmbedding = true;
    const failedNew = await run(changedBytes);
    assert.equal(failedNew.status, "failed");
    const changedHash = createHash("sha256").update(changedBytes).digest("hex");
    const pending = (await worker<{ processing_status: string; processing_attempts: number }[]>`SELECT processing_status, processing_attempts FROM catalog.resource_versions WHERE resource_id = ${resourceId} AND source_sha256 = ${changedHash}`)[0]!;
    assert.equal(pending.processing_status, "pending");
    assert.equal((await worker<{ current_version_id: string }[]>`SELECT current_version_id FROM catalog.resources WHERE id = ${resourceId}`)[0]!.current_version_id, firstPointer);
    const parseCallsAfterNew = parseCalls;
    await migrator`UPDATE catalog.resource_versions SET retry_after = now() - interval '1 second' WHERE resource_id = ${resourceId} AND source_sha256 = ${changedHash}`;
    failEmbedding = false;
    assert.equal((await run(changedBytes)).status, "ready");
    assert.equal(parseCalls, parseCallsAfterNew);
    const [coverage] = await worker<{ unreadable: number }[]>`SELECT count(*)::int AS unreadable
      FROM retrieval.resource_chunks c JOIN catalog.resource_versions v ON v.id = c.resource_version_id
      WHERE v.resource_id = ${resourceId} AND v.source_sha256 = ${changedHash} AND c.page_from = 2`;
    assert.equal(coverage?.unreadable, 0);
    assert.notEqual((await worker<{ current_version_id: string }[]>`SELECT current_version_id FROM catalog.resources WHERE id = ${resourceId}`)[0]!.current_version_id, firstPointer);

    const failedBytes = new TextEncoder().encode("%PDF-1.7 third version");
    failEmbedding = true;
    await run(failedBytes);
    const failedHash = createHash("sha256").update(failedBytes).digest("hex");
    await migrator`UPDATE catalog.resource_versions SET processing_attempts = 3, retry_after = now() - interval '1 second' WHERE resource_id = ${resourceId} AND source_sha256 = ${failedHash}`;
    await run(failedBytes);
    const exhausted = (await worker<{ processing_status: string; processing_attempts: number }[]>`SELECT processing_status, processing_attempts FROM catalog.resource_versions WHERE resource_id = ${resourceId} AND source_sha256 = ${failedHash}`)[0]!;
    assert.equal(exhausted.processing_status, "failed");
    assert.equal(exhausted.processing_attempts, 4);

    failEmbedding = false;
    await migrator`INSERT INTO catalog.resources (id, type, provider, external_id, title, visibility, status) VALUES
      (${queueInvalidId}, 'paper', 'ingestion-test', ${queueInvalidId}, 'Unsupported paper source', 'private', 'pending'),
      (${queueValidId}, 'paper', 'arxiv', ${queueArxivId}, 'Next paper after a bad source', 'private', 'pending')`;
    await migrator`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, pdf_source_url) VALUES
      (${queueInvalidId}, NULL, 'test abstract', 'https://example.org/paper.pdf')`;
    await migrator`UPDATE catalog.resources SET updated_at = '1970-01-01' WHERE id = ${queueInvalidId}`;
    await migrator`UPDATE catalog.resources SET updated_at = '1970-01-02' WHERE id = ${queueValidId}`;
    const upkeep = await paperIngestionUpkeep(worker, provider, 2, {
      fetchPdf: async (url) => ({ bytes: baseBytes, url, downloadedAt: new Date().toISOString(), durationMs: 1 }),
      parse, referenceClient,
    });
    assert.deepEqual(upkeep, { ready: 1, failed: 1, busy: 0 });
    const queueStatuses = await worker<{ id: string; status: string; processing_status: string | null }[]>`
      SELECT r.id, r.status, v.processing_status FROM catalog.resources r
      LEFT JOIN catalog.resource_versions v ON v.resource_id = r.id AND v.id = r.current_version_id
      WHERE r.id IN (${queueInvalidId}, ${queueValidId}) ORDER BY r.id`;
    assert.equal(queueStatuses.find((row) => row.id === queueInvalidId)?.status, "failed");
    assert.equal(queueStatuses.find((row) => row.id === queueValidId)?.processing_status, "ready");
  } finally {
    const resourceIds = [resourceId, queueInvalidId, queueValidId];
    const versions = await migrator<{ id: string }[]>`SELECT id FROM catalog.resource_versions WHERE resource_id = ANY(${resourceIds}::uuid[])`;
    const ids = versions.map((version) => version.id);
    await migrator`UPDATE catalog.resources SET current_version_id = NULL, status = 'pending' WHERE id = ANY(${resourceIds}::uuid[])`;
    if (ids.length) {
      await migrator`DELETE FROM retrieval.chunk_embeddings WHERE chunk_id IN (SELECT id FROM retrieval.resource_chunks WHERE resource_version_id = ANY(${ids}::uuid[]))`;
      await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ANY(${ids}::uuid[])`;
      await migrator`DELETE FROM catalog.resource_versions WHERE resource_id = ANY(${resourceIds}::uuid[])`;
    }
    await migrator`DELETE FROM catalog.paper_references WHERE paper_resource_id = ANY(${resourceIds}::uuid[])`;
    await migrator`DELETE FROM catalog.paper_details WHERE resource_id = ANY(${resourceIds}::uuid[])`;
    await migrator`DELETE FROM catalog.resources WHERE id = ANY(${resourceIds}::uuid[])`;
    await worker.end();
    await migrator.end();
  }
});

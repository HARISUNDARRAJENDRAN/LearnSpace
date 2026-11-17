import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_TIMEOUT_MS, MAX_PDF_BYTES, MAX_PDF_PAGES, parsePaperPdf } from "./index.js";

test("routing metadata reflects the explicit trust decision", async () => {
  const path = fileURLToPath(new URL("../../../vendor/pdf-inspector-researchpapers/tests/fixtures/firecrawl_docs_tagged.pdf", import.meta.url));
  const pdf = new Uint8Array(readFileSync(path));
  const fast = await parsePaperPdf(pdf, { source: "verified-native" });
  const standard = await parsePaperPdf(pdf, { source: "untrusted" });
  assert.equal(fast.metadata.path, "research-fast-path");
  assert.equal(standard.metadata.path, "standard-detection");
  assert.equal(fast.metadata.parserSha, "6845225193200a7779e69b2021e15fb1293b0adc");
  assert.equal(fast.markdown, standard.markdown);
  assert.equal(MAX_PDF_PAGES, 300);
});

test("untrusted image-only scans report pages requiring OCR", async () => {
  const path = fileURLToPath(new URL("../../../vendor/pdf-inspector-researchpapers/tests/fixtures/scan_with_native_header_text.pdf", import.meta.url));
  const result = await parsePaperPdf(new Uint8Array(readFileSync(path)), { source: "untrusted" });
  assert.notEqual(result.classification.type, "TextBased");
  assert.ok(result.classification.pagesNeedingOcr.length > 0);
  assert.ok(result.pages.some((page) => page.needsOcr));
});

test("rejects byte limits and aborted requests before spawning a parser", async () => {
  await assert.rejects(parsePaperPdf(new Uint8Array(MAX_PDF_BYTES + 1), { source: "untrusted" }), /byte limit/);
  await assert.rejects(parsePaperPdf(new Uint8Array([1]), { source: "untrusted", timeoutMs: DEFAULT_TIMEOUT_MS + 1 }), /timeoutMs/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(parsePaperPdf(new Uint8Array([1]), { source: "untrusted", signal: controller.signal }), { name: "AbortError" });
});

test("aborting an active parse kills its child process", async () => {
  const path = fileURLToPath(new URL("../../../vendor/pdf-inspector-researchpapers/tests/fixtures/firecrawl_docs_tagged.pdf", import.meta.url));
  const controller = new AbortController();
  const parsing = parsePaperPdf(new Uint8Array(readFileSync(path)), { source: "untrusted", signal: controller.signal });
  controller.abort();
  await assert.rejects(parsing, { name: "AbortError" });
});

test("kills a parser child that exceeds its timeout", async () => {
  const path = fileURLToPath(new URL("../../../vendor/pdf-inspector-researchpapers/tests/fixtures/firecrawl_docs_tagged.pdf", import.meta.url));
  await assert.rejects(parsePaperPdf(new Uint8Array(readFileSync(path)), { source: "untrusted", timeoutMs: 1 }), /timeout/);
});

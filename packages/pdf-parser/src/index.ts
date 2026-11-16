import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export type PdfSource = "verified-native" | "untrusted";
export interface ParseOptions {
  source: PdfSource;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface ParsedPage {
  page: number;
  text: string;
  needsOcr: boolean;
  ocrReason: string | null;
}
export interface Heading {
  level: number;
  text: string;
  page: number;
  hierarchy: string[];
}
export interface TextCoordinate {
  text: string;
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  font: string;
  fontSize: number;
}
export interface ParseOutput {
  text: string;
  markdown: string;
  pages: ParsedPage[];
  headings: Heading[];
  tables: { page: number; markdown: string }[];
  captions: { page: number; text: string }[];
  equations: { page: number; source: string }[];
  references: { page: number; text: string }[];
  citationMarkers: { page: number; marker: string }[];
  coordinates: TextCoordinate[];
  classification: { type: string; confidence: number; pagesNeedingOcr: number[]; reasonsByPage: { page: number; reasons: string[] }[] };
  metadata: { path: "research-fast-path" | "standard-detection"; parser: string; version: string; parserSha: string; durationMs: number; parserProcessingMs: number };
  taggedStructure: { page: number; mcid: number; role: string }[];
  unrecovered: string[];
}

export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 30_000;
const SOURCE_SHA = "6845225193200a7779e69b2021e15fb1293b0adc";

interface NativeResult {
  markdown: string | null;
  pages: { page: number; markdown: string; needsOcr: boolean; ocrReason?: string | null }[];
  textItems: { text: string; page: number; x: number; y: number; width: number; height: number; font: string; fontSize: number; bold: boolean; italic: boolean }[];
  structure: { page: number; mcid: number; role: string }[];
  pdfType: string;
  pageCount: number;
  confidence: number;
  pagesNeedingOcr: number[];
  ocrReasonsByPage: { page: number; reasons: string[] }[];
  title?: string | null;
  hasEncodingIssues: boolean;
  isComplexLayout: boolean;
  processingTimeMs: number;
}

export async function parsePaperPdf(bytes: Uint8Array, opts: ParseOptions): Promise<ParseOutput> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TypeError("PDF bytes must be a non-empty Uint8Array");
  if (bytes.byteLength > MAX_PDF_BYTES) throw new RangeError(`PDF exceeds ${MAX_PDF_BYTES} byte limit`);
  if (opts.source !== "verified-native" && opts.source !== "untrusted") throw new TypeError("source must be verified-native or untrusted");
  if (opts.signal?.aborted) throw new DOMException("Parsing aborted", "AbortError");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
  }

  const started = performance.now();
  const result = await runIsolated(bytes, opts.source === "verified-native", timeoutMs, opts.signal);
  return shapeResult(result, opts.source, performance.now() - started);
}

function runIsolated(bytes: Uint8Array, trustedResearch: boolean, timeoutMs: number, signal?: AbortSignal): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    // shortcut: the child shares container memory; the function limit is the hard OOM boundary.
    const child: ChildProcess = fork(fileURLToPath(new URL("./child.js", import.meta.url)), [], {
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
    });
    let settled = false;
    const finish = (error?: Error, value?: NativeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child.kill("SIGKILL");
      error ? reject(error) : resolve(value!);
    };
    const abort = () => finish(new DOMException("Parsing aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error(`PDF parsing exceeded ${timeoutMs}ms timeout`)), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.once("message", (message: { result?: NativeResult; error?: string }) => {
      if (message.error) finish(new Error(message.error));
      else if (message.result) finish(undefined, message.result);
      else finish(new Error("PDF parser returned an invalid response"));
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (!settled) finish(new Error(`PDF parser child exited with code ${code}`));
    });
    child.send({ bytes: Buffer.from(bytes), trustedResearch, maxPages: MAX_PDF_PAGES }, (error) => {
      if (error) finish(error);
    });
  });
}

function shapeResult(result: NativeResult, source: PdfSource, durationMs: number): ParseOutput {
  const markdown = result.markdown ?? result.pages.map((page) => page.markdown).join("\n\n");
  const headings: Heading[] = [];
  const tables: ParseOutput["tables"] = [];
  const captions: ParseOutput["captions"] = [];
  const equations: ParseOutput["equations"] = [];
  const references: ParseOutput["references"] = [];
  const citationMarkers: ParseOutput["citationMarkers"] = [];
  const stack: string[] = [];
  let inReferences = false;
  // shortcut: only common Markdown forms are recognized; use typed parser spans when available.
  for (const page of result.pages) {
    const lines = page.markdown.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (line === undefined) continue;
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        const [, hashes, headingText] = heading;
        if (hashes === undefined || headingText === undefined) continue;
        const level = hashes.length;
        const title = headingText.trim();
        stack.length = level - 1;
        stack[level - 1] = title;
        headings.push({ level, text: title, page: page.page, hierarchy: stack.filter(Boolean) });
        inReferences = /^(references|bibliography|works cited)$/i.test(title);
      } else if (/^\|.*\|$/.test(line)) {
        const block = [line];
        while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1] ?? "")) {
          i++;
          block.push(lines[i]?.trim() ?? "");
        }
        tables.push({ page: page.page, markdown: block.join("\n") });
      } else {
        if (/^(?:figure|fig\.?|table)\s*[\d.]+\s*[:.)-]/i.test(line)) captions.push({ page: page.page, text: line });
        if (/^\$\$.*\$\$$/.test(line) || /^\\\[.*\\\]$/.test(line)) equations.push({ page: page.page, source: line });
        if (inReferences && /^(?:\[\d+\]|\d+[.)])\s+/.test(line)) references.push({ page: page.page, text: line });
        for (const match of line.matchAll(/\[(?:\d+(?:\s*[,–-]\s*\d+)*)\]|\([A-Z][^)]*\b(?:19|20)\d{2}[a-z]?\)/g)) citationMarkers.push({ page: page.page, marker: match[0] });
      }
    }
  }
  const unrecovered = [
    "OCR is not performed; pages marked needsOcr are returned for an OCR pipeline.",
    "Figures and raster content are not interpreted; only text-layer captions are surfaced.",
    "References, equations, tables, and in-text citations are returned only when present in extracted Markdown and matched by lightweight formatting rules.",
    "Text coordinates are parser-emitted PDF points with a bottom-left origin; they do not describe image-only content.",
  ];
  if (result.structure.length === 0) unrecovered.push("No tagged-PDF semantic structure tree was available.");
  if (result.hasEncodingIssues) unrecovered.push("The parser reported text encoding issues; affected text may be incomplete or garbled.");
  return {
    text: result.pages.map((page) => page.markdown).join("\n\n"),
    markdown,
    pages: result.pages.map((page) => ({ page: page.page, text: page.markdown, needsOcr: page.needsOcr, ocrReason: page.ocrReason ?? null })),
    headings,
    tables,
    captions,
    equations,
    references,
    citationMarkers,
    coordinates: result.textItems.map((item) => ({ text: item.text, page: item.page, bbox: { x: item.x, y: item.y, width: item.width, height: item.height }, font: item.font, fontSize: item.fontSize })),
    classification: { type: result.pdfType, confidence: result.confidence, pagesNeedingOcr: result.pagesNeedingOcr, reasonsByPage: result.ocrReasonsByPage },
    metadata: { path: source === "verified-native" ? "research-fast-path" : "standard-detection", parser: "pdf-inspector", version: "1.14.2", parserSha: SOURCE_SHA, durationMs, parserProcessingMs: result.processingTimeMs },
    taggedStructure: result.structure,
    unrecovered,
  };
}

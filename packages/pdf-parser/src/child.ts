import { createRequire } from "node:module";
import process from "node:process";

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

const require = createRequire(import.meta.url);
const native = require("../native/learnspace_pdf_parser.linux-x64-gnu.node") as {
  parse(buffer: Buffer, trustedResearch: boolean, maxPages: number): NativeResult;
};

process.on("message", (message: { bytes: Buffer; trustedResearch: boolean; maxPages: number }) => {
  try {
    const result = native.parse(Buffer.from(message.bytes), message.trustedResearch, message.maxPages);
    process.send?.({ result });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) });
  }
});

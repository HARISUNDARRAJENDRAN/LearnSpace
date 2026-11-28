import { withUserTransaction } from "@learnspace/db";
import { paperDetails, resources } from "@learnspace/db/schema";
import { trustedPdfUrl } from "@learnspace/shared";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { discoverOpenAccessPdfForDoi } from "../source-discovery/paper-resolver";

export { trustedPdfUrl };
export const MAX_PAPER_PDF_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?$/i;

export function arxivPdfUrl(arxivId: string): string | null {
  return ARXIV_ID.test(arxivId) ? `https://arxiv.org/pdf/${arxivId}` : null;
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The PDF a learner may read for a catalogue paper they can see: arXiv first (stable, verified), else an allow-listed OA source URL. */
export async function paperPdfUrl(userId: string, resourceId: string): Promise<URL> {
  const [row] = await withUserTransaction(userId, (tx) => tx
    .select({
      provider: resources.provider,
      externalId: resources.externalId,
      metadata: resources.metadata,
      arxivId: paperDetails.arxivId,
      doi: paperDetails.doi,
      pdfSourceUrl: paperDetails.pdfSourceUrl,
    })
    .from(resources)
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .where(and(eq(resources.id, resourceId), eq(resources.type, "paper"), isNull(resources.deletedAt), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"]))))
    .limit(1));
  if (!row) throw new AuthError("PAPER_NOT_FOUND", "This paper is not available.", 404);
  // Discovery stores the arXiv ID or OA PDF URL before the ingestion worker writes paper details.
  const arxivId = row.arxivId ?? (row.provider === "arxiv" ? row.externalId : null) ?? metadataString(row.metadata, "arxivId");
  const candidate = (arxivId ? arxivPdfUrl(arxivId) : null) ?? row.pdfSourceUrl ?? metadataString(row.metadata, "pdfSourceUrl");
  let url = candidate ? trustedPdfUrl(candidate) : null;

  // Lazily discover open-access PDFs for already-imported DOI papers (e.g. JAIR, OpenReview, PMLR, PMC).
  if (!url) {
    const doi = row.doi ?? (row.provider === "doi" ? row.externalId : null);
    if (doi) {
      const discovered = await discoverOpenAccessPdfForDoi(doi);
      const discoveredCandidate = (discovered.arxivId ? arxivPdfUrl(discovered.arxivId) : null) ?? discovered.pdfUrl;
      url = discoveredCandidate ? trustedPdfUrl(discoveredCandidate) : null;
      if (url) {
        const discoveredHref = url.href;
        await withUserTransaction(userId, async (tx) => {
          await tx.update(paperDetails).set({ pdfSourceUrl: discoveredHref }).where(and(eq(paperDetails.resourceId, resourceId), isNull(paperDetails.pdfSourceUrl)));
        }).catch(() => undefined);
      }
    }
  }

  if (!url) throw new AuthError("PAPER_PDF_UNAVAILABLE", "This paper's PDF can only be opened at its source.", 404);
  return url;
}

/**
 * Fetches a trusted PDF, following redirects only within the allow-list and refusing anything that is not a PDF or exceeds
 * the size cap. Returns the body as a stream that errors once the cap is crossed (Content-Length can be absent or wrong).
 */
export async function fetchTrustedPdf(start: URL, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; length: number | null }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, { redirect: "manual", signal: signal ?? AbortSignal.timeout(30_000), headers: { "User-Agent": "LearnSpace/1.0 (paper reader)", Accept: "application/pdf" } });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      const target = next ? trustedPdfUrl(new URL(next, url).toString()) : null;
      if (!target) throw new AuthError("PAPER_PDF_REDIRECT", "The paper source redirected somewhere LearnSpace does not fetch from.", 502);
      url = target;
      continue;
    }
    if (!response.ok || !response.body) throw new AuthError("PAPER_PDF_FETCH", "The paper source could not be reached.", 502);
    const type = response.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/pdf")) throw new AuthError("PAPER_PDF_TYPE", "The paper source did not return a PDF.", 502);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PAPER_PDF_BYTES) throw new AuthError("PAPER_PDF_TOO_LARGE", "This PDF is too large to open here.", 413);
    let seen = 0;
    const capped = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_PAPER_PDF_BYTES) controller.error(new Error("PDF exceeds the size cap"));
        else controller.enqueue(chunk);
      },
    }));
    return { body: capped, length: Number.isFinite(declared) && declared > 0 ? declared : null };
  }
  throw new AuthError("PAPER_PDF_REDIRECT", "The paper source redirected too many times.", 502);
}

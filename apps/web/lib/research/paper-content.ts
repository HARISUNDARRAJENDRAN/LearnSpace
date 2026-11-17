import { withUserTransaction } from "@learnspace/db";
import { authors, paperAuthors, paperDetails, paperReferences, resourceChunks, resourceVersions, resources } from "@learnspace/db/schema";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { AuthError } from "../auth/errors";

/** One passage of a parsed paper, in reading order (docs/research/paper-contract.md). */
export type PaperBlock = {
  id: string;
  type: "heading" | "paragraph" | "equation" | "figure" | "table" | "code";
  headingPath: string[];
  sectionId: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  content: string;
  label: string | null;
  caption: string | null;
  latex: string | null;
  citations: number[];
};

export type PaperReference = { ordinal: number; raw: string; title: string | null; year: string | null; url: string | null; citedResourceId: string | null };

export type PaperContent = {
  resourceId: string;
  title: string;
  authors: string[];
  venue: string | null;
  publicationDate: string | null;
  doi: string | null;
  arxivId: string | null;
  abstract: string | null;
  status: "ready" | "preparing" | "failed";
  blocks: PaperBlock[];
  references: PaperReference[];
};

const BLOCK_TYPES = new Set<PaperBlock["type"]>(["heading", "paragraph", "equation", "figure", "table", "code"]);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function bbox(value: unknown): PaperBlock["bbox"] {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n)) ? value as PaperBlock["bbox"] : null;
}

function referenceUrl(doi: string | null, arxivId: string | null, metadata: Record<string, unknown>): string | null {
  if (arxivId) return `https://arxiv.org/abs/${arxivId}`;
  if (doi) return `https://doi.org/${doi}`;
  const url = text(metadata.url);
  return url?.startsWith("https://") ? url : null;
}

/** The parsed paper a learner may read: its current version's passages and its verified bibliography. */
export async function getPaperContent(userId: string, resourceId: string): Promise<PaperContent> {
  return withUserTransaction(userId, async (tx) => {
    const [row] = await tx.select({ resource: resources, paper: paperDetails, version: resourceVersions })
      .from(resources)
      .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
      .leftJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
      .where(and(eq(resources.id, resourceId), eq(resources.type, "paper"), isNull(resources.deletedAt), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"]))))
      .limit(1);
    if (!row) throw new AuthError("PAPER_NOT_FOUND", "This paper is not available.", 404);
    const ready = row.version?.processingStatus === "ready";
    const [authorRows, chunkRows, referenceRows] = await Promise.all([
      tx.select({ name: authors.preferredName }).from(paperAuthors).innerJoin(authors, eq(authors.id, paperAuthors.authorId)).where(eq(paperAuthors.paperResourceId, resourceId)).orderBy(asc(paperAuthors.ordinal)),
      ready && row.version ? tx.select().from(resourceChunks).where(eq(resourceChunks.resourceVersionId, row.version.id)).orderBy(asc(resourceChunks.ordinal)) : Promise.resolve([]),
      tx.select().from(paperReferences).where(eq(paperReferences.paperResourceId, resourceId)).orderBy(asc(paperReferences.ordinal)),
    ]);
    const blocks = chunkRows.flatMap((chunk): PaperBlock[] => {
      const type = chunk.chunkType as PaperBlock["type"];
      if (!BLOCK_TYPES.has(type)) return [];
      const { anchor, metadata } = chunk;
      const citations = Array.isArray(metadata.citations) ? metadata.citations.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
      return [{ id: chunk.id, type, headingPath: chunk.headingPath, sectionId: text(anchor.sectionId), page: chunk.pageFrom, bbox: bbox(anchor.bbox), content: chunk.content, label: text(metadata.label), caption: text(metadata.caption), latex: text(metadata.latex), citations }];
    });
    return {
      resourceId,
      title: row.resource.title,
      authors: authorRows.map(({ name }) => name),
      venue: row.paper.venue,
      publicationDate: row.paper.publicationDate ? String(row.paper.publicationDate) : null,
      doi: row.paper.doi,
      arxivId: row.paper.arxivId,
      abstract: row.paper.abstract,
      status: ready ? "ready" : row.version?.processingStatus === "failed" || row.resource.status === "failed" ? "failed" : "preparing",
      blocks,
      references: referenceRows.map((reference) => ({
        ordinal: reference.ordinal,
        raw: reference.rawReference,
        title: text(reference.metadata.title),
        year: reference.metadata.year == null ? null : String(reference.metadata.year),
        url: referenceUrl(reference.citedDoi, reference.citedArxivId, reference.metadata),
        citedResourceId: reference.citedResourceId,
      })),
    };
  });
}

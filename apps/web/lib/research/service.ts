import { withUserTransaction } from "@learnspace/db";
import { authors, libraryItems, paperAuthors, paperDetails, resourceConcepts, resources, concepts } from "@learnspace/db/schema";
import type { ResearchPaperSummary } from "@learnspace/shared";
import { studyResourceReadinessSchema } from "@learnspace/shared";
import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { rankPaperResourcesForUser } from "../discovery/service";

export type ResearchPageData = {
  query: string;
  recommended: ResearchPaperSummary[];
  foundational: ResearchPaperSummary[];
  recent: ResearchPaperSummary[];
  saved: ResearchPaperSummary[];
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function metadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

export async function getResearchPage(userId: string, query = ""): Promise<ResearchPageData> {
  return withUserTransaction(userId, async (tx) => {
    const normalizedQuery = query.trim().slice(0, 160);
    const queryFilter = normalizedQuery.length > 0
      ? or(ilike(resources.title, `%${normalizedQuery}%`), ilike(resources.description, `%${normalizedQuery}%`), ilike(paperDetails.abstract, `%${normalizedQuery}%`))
      : undefined;
    const paperRows = await tx
      .select({ resource: resources, paper: paperDetails })
      .from(resources)
      .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
      .where(and(
        eq(resources.type, "paper"),
        or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])),
        inArray(resources.status, ["pending", "processing", "ready"]),
        isNull(resources.deletedAt),
        queryFilter,
      ))
      .orderBy(desc(resources.qualityScore), desc(paperDetails.publicationDate), desc(resources.updatedAt))
      .limit(100);
    const ids = paperRows.map((row) => row.resource.id);
    if (ids.length === 0) return { query: normalizedQuery, recommended: [], foundational: [], recent: [], saved: [] };
    const [authorRows, conceptRows, savedRows] = await Promise.all([
      tx.select({ resourceId: paperAuthors.paperResourceId, name: authors.preferredName }).from(paperAuthors).innerJoin(authors, eq(authors.id, paperAuthors.authorId)).where(inArray(paperAuthors.paperResourceId, ids)).orderBy(asc(paperAuthors.ordinal)),
      tx.select({ resourceId: resourceConcepts.resourceId, name: concepts.name }).from(resourceConcepts).innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId)).where(inArray(resourceConcepts.resourceId, ids)),
      tx.select({ resourceId: libraryItems.resourceId }).from(libraryItems).where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"), inArray(libraryItems.resourceId, ids))),
    ]);
    const authorsByResource = new Map<string, string[]>();
    for (const row of authorRows) authorsByResource.set(row.resourceId, [...(authorsByResource.get(row.resourceId) ?? []), row.name]);
    const conceptsByResource = new Map<string, string[]>();
    for (const row of conceptRows) conceptsByResource.set(row.resourceId, [...(conceptsByResource.get(row.resourceId) ?? []), row.name]);
    const savedIds = new Set(savedRows.map((row) => row.resourceId));
    const summaries = paperRows.map(({ resource, paper }) => ({
      resourceId: resource.id,
      title: resource.title,
      abstract: paper.abstract,
      authors: authorsByResource.get(resource.id) ?? [],
      venue: paper.venue,
      publicationDate: paper.publicationDate ? String(paper.publicationDate) : null,
      arxivId: paper.arxivId,
      doi: paper.doi,
      pdfSourceUrl: paper.pdfSourceUrl,
      conceptNames: conceptsByResource.get(resource.id) ?? [],
      saved: savedIds.has(resource.id),
      readiness: resource.status === "failed" || resource.status === "archived" ? "unavailable" : resource.currentVersionId ? studyResourceReadinessSchema.parse("ready") : "preparing",
    } satisfies ResearchPaperSummary));
    const byRecent = [...summaries].sort((left, right) => (right.publicationDate ?? "").localeCompare(left.publicationDate ?? ""));
    const byFoundational = summaries.filter((paper) => {
      const row = paperRows.find((candidate) => candidate.resource.id === paper.resourceId);
      const paperClass = row ? metadataValue(row.paper.metadata, "paperClass") : null;
      return paperClass === "foundational";
    });
    const recommendedIds = normalizedQuery.length === 0 ? await rankPaperResourcesForUser(tx, userId, ids) : [];
    const recommendedIdSet = new Set(recommendedIds);
    const recommended = normalizedQuery.length === 0
      ? [...recommendedIds.map((id) => summaries.find((paper) => paper.resourceId === id)).filter((paper): paper is ResearchPaperSummary => Boolean(paper)), ...summaries.filter((paper) => !recommendedIdSet.has(paper.resourceId))].slice(0, 12)
      : summaries.slice(0, 12);
    return {
      query: normalizedQuery,
      recommended,
      foundational: byFoundational.slice(0, 12),
      recent: byRecent.slice(0, 12),
      saved: summaries.filter((paper) => paper.saved).slice(0, 12),
    };
  });
}

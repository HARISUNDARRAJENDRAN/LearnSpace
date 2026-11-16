import { withUserTransaction } from "@learnspace/db";
import { authors, collections, concepts, libraryItems, paperAuthors, paperDetails, researchTopics, resourceConcepts, resources, studySessions } from "@learnspace/db/schema";
import type { ResourceType } from "@learnspace/shared";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { SearchMode } from "./contract";
import { isSearchResultAllowed } from "./contract";
import { searchCurriculum } from "./curriculum";

export type GlobalSearchResult = {
  id: string;
  kind: "collection" | "lesson" | "resource" | "session" | "library" | "concept" | "author";
  title: string;
  subtitle: string;
  href: string | null;
  resourceId: string | null;
  resourceType: ResourceType | null;
  thumbnailUrl?: string | null;
};

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function resourceLabel(type: ResourceType): string {
  return type === "video" ? "Video" : type === "paper" ? "Paper" : type.replaceAll("_", " ");
}

function sessionHref(type: ResourceType | null, sessionId: string): string {
  return type === "paper" ? `/app/study/paper/${sessionId}` : type === "video" ? `/app/study/video/${sessionId}` : "/app";
}

export async function searchWorkspace(userId: string, rawQuery: string, mode: SearchMode): Promise<GlobalSearchResult[]> {
  const query = rawQuery.trim().slice(0, 120);
  if (query.length < 2) return [];
  const pattern = likePattern(query);
  const textMatch = or(ilike(resources.title, pattern), ilike(resources.description, pattern));

  if (mode === "learn") {
    const curriculum = await searchCurriculum(query);
    const workspace = await withUserTransaction(userId, async (tx) => {
      const [resourceRows, sessionRows, libraryRows, collectionRows, conceptRows] = await Promise.all([
        tx.select({ id: resources.id, title: resources.title, description: resources.description, type: resources.type, provider: resources.provider })
          .from(resources)
          .where(and(or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])), eq(resources.type, "video"), eq(resources.status, "ready"), isNull(resources.deletedAt), sql`NOT (${resources.metadata} ? 'curriculumHash')`, textMatch))
          .orderBy(desc(resources.qualityScore), desc(resources.updatedAt))
          .limit(6),
        tx.select({ id: studySessions.id, title: studySessions.title, activeResourceId: studySessions.activeResourceId, resourceTitle: resources.title, resourceType: resources.type })
          .from(studySessions)
          .innerJoin(resources, eq(resources.id, studySessions.activeResourceId))
          .where(and(eq(studySessions.userId, userId), ne(studySessions.status, "abandoned"), eq(resources.type, "video"), or(ilike(studySessions.title, pattern), ilike(resources.title, pattern))))
          .orderBy(desc(studySessions.lastActiveAt))
          .limit(6),
        tx.select({ id: libraryItems.resourceId, title: resources.title, description: resources.description, type: resources.type })
          .from(libraryItems)
          .innerJoin(resources, eq(resources.id, libraryItems.resourceId))
          .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"), eq(resources.type, "video"), isNull(resources.deletedAt), textMatch))
          .orderBy(desc(libraryItems.updatedAt))
          .limit(6),
        tx.select({ id: collections.id, title: collections.title, description: collections.description })
          .from(collections)
          .where(and(or(eq(collections.ownerUserId, userId), eq(collections.visibility, "public")), or(ilike(collections.title, pattern), ilike(collections.description, pattern))))
          .orderBy(desc(collections.updatedAt))
          .limit(5),
        tx.select({ id: concepts.id, name: concepts.name, summary: concepts.summary })
          .from(resourceConcepts)
          .innerJoin(resources, eq(resources.id, resourceConcepts.resourceId))
          .innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId))
          .where(and(eq(resources.type, "video"), eq(concepts.status, "active"), or(ilike(concepts.name, pattern), ilike(concepts.summary, pattern))))
          .orderBy(asc(concepts.name))
          .limit(5),
      ]);

      return [
        ...resourceRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "resource", title: row.title, subtitle: row.description ?? `${resourceLabel(row.type)} · ${row.provider}`, href: null, resourceId: row.id, resourceType: row.type })),
        ...sessionRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "session", title: row.title ?? row.resourceTitle ?? "Untitled session", subtitle: row.resourceTitle ? `Learn session · ${row.resourceTitle}` : "Learn session", href: sessionHref(row.resourceType, row.id), resourceId: row.activeResourceId, resourceType: row.resourceType })),
        ...libraryRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "library", title: row.title, subtitle: row.description ?? `${resourceLabel(row.type)} · Saved`, href: "/app/library", resourceId: row.id, resourceType: row.type })),
        ...collectionRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "collection", title: row.title, subtitle: row.description ?? "Course", href: `/app/library/collections/${row.id}`, resourceId: null, resourceType: null })),
        ...conceptRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "concept", title: row.name, subtitle: row.summary ?? "Learning concept", href: "/app/second-brain", resourceId: null, resourceType: null })),
      ];
    });
    return [...curriculum, ...workspace].filter((result) => isSearchResultAllowed(mode, result));
  }

  const workspace = await withUserTransaction(userId, async (tx) => {
    const paperMatch = or(textMatch, ilike(paperDetails.abstract, pattern));
    const paperWhere = and(
      eq(resources.type, "paper"),
      or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])),
      inArray(resources.status, ["ready", "processing", "pending"]),
      isNull(resources.deletedAt),
      paperMatch,
    );
    const [paperRows, sessionRows, libraryRows, authorRows, conceptRows, selectedTopicRows] = await Promise.all([
      tx.select({ id: resources.id, title: resources.title, description: resources.description, abstract: paperDetails.abstract, type: resources.type })
        .from(resources)
        .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
        .where(paperWhere)
        .orderBy(desc(resources.qualityScore), desc(paperDetails.publicationDate), desc(resources.updatedAt))
        .limit(8),
      tx.select({ id: studySessions.id, title: studySessions.title, activeResourceId: studySessions.activeResourceId, resourceTitle: resources.title, resourceType: resources.type })
        .from(studySessions)
        .innerJoin(resources, eq(resources.id, studySessions.activeResourceId))
        .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
        .where(and(eq(studySessions.userId, userId), ne(studySessions.status, "abandoned"), eq(resources.type, "paper"), or(ilike(studySessions.title, pattern), ilike(resources.title, pattern), ilike(paperDetails.abstract, pattern))))
        .orderBy(desc(studySessions.lastActiveAt))
        .limit(6),
      tx.select({ id: libraryItems.resourceId, title: resources.title, description: resources.description, type: resources.type })
        .from(libraryItems)
        .innerJoin(resources, eq(resources.id, libraryItems.resourceId))
        .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
        .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"), eq(resources.type, "paper"), isNull(resources.deletedAt), textMatch))
        .orderBy(desc(libraryItems.updatedAt))
        .limit(6),
      tx.select({ id: authors.id, name: authors.preferredName, paperTitle: resources.title })
        .from(authors)
        .innerJoin(paperAuthors, eq(paperAuthors.authorId, authors.id))
        .innerJoin(paperDetails, eq(paperDetails.resourceId, paperAuthors.paperResourceId))
        .innerJoin(resources, eq(resources.id, paperDetails.resourceId))
        .where(and(eq(resources.type, "paper"), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])), isNull(resources.deletedAt), or(ilike(authors.preferredName, pattern), ilike(authors.normalizedName, pattern))))
        .orderBy(asc(authors.preferredName))
        .limit(8),
      tx.select({ id: concepts.id, name: concepts.name, summary: concepts.summary })
        .from(concepts)
        .innerJoin(resourceConcepts, eq(resourceConcepts.conceptId, concepts.id))
        .innerJoin(resources, eq(resources.id, resourceConcepts.resourceId))
        .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
        .where(and(eq(resources.type, "paper"), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])), isNull(resources.deletedAt), eq(concepts.status, "active"), or(ilike(concepts.name, pattern), ilike(concepts.summary, pattern))))
        .orderBy(asc(concepts.name))
        .limit(8),
      tx.select({ id: concepts.id, name: concepts.name, summary: concepts.summary })
        .from(researchTopics)
        .innerJoin(concepts, eq(concepts.id, researchTopics.conceptId))
        .where(and(eq(researchTopics.userId, userId), eq(concepts.status, "active"), or(ilike(concepts.name, pattern), ilike(concepts.summary, pattern))))
        .orderBy(asc(concepts.name))
        .limit(8),
    ]);

    const uniqueBy = <T,>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((row) => [key(row), row])).values()];
    return [
      ...paperRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "resource", title: row.title, subtitle: row.description ?? row.abstract ?? "Research paper", href: null, resourceId: row.id, resourceType: row.type })),
      ...sessionRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "session", title: row.title ?? row.resourceTitle ?? "Untitled session", subtitle: row.resourceTitle ? `Research session · ${row.resourceTitle}` : "Research session", href: sessionHref(row.resourceType, row.id), resourceId: row.activeResourceId, resourceType: row.resourceType })),
      ...libraryRows.map((row): GlobalSearchResult => ({ id: row.id, kind: "library", title: row.title, subtitle: row.description ?? "Saved paper", href: null, resourceId: row.id, resourceType: row.type })),
      ...uniqueBy(authorRows, (row) => row.id).map((row): GlobalSearchResult => ({ id: row.id, kind: "author", title: row.name, subtitle: `Author · ${row.paperTitle}`, href: `/app/research/authors/${row.id}`, resourceId: null, resourceType: null })),
      ...uniqueBy([...conceptRows, ...selectedTopicRows], (row) => row.id).map((row): GlobalSearchResult => ({ id: row.id, kind: "concept", title: row.name, subtitle: row.summary ?? "Research topic", href: `/app/research?topicId=${encodeURIComponent(row.id)}`, resourceId: null, resourceType: null })),
    ];
  });
  return workspace.filter((result) => isSearchResultAllowed(mode, result));
}

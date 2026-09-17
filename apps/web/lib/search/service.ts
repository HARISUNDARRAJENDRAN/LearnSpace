import { withUserTransaction } from "@learnspace/db";
import { collections, concepts, libraryItems, resources, studySessions } from "@learnspace/db/schema";
import type { ResourceType } from "@learnspace/shared";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";

export type GlobalSearchResult = {
  id: string;
  kind: "resource" | "session" | "library" | "concept";
  title: string;
  subtitle: string;
  href: string | null;
  resourceId: string | null;
  resourceType: ResourceType | null;
};

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function resourceLabel(type: ResourceType): string {
  return type === "video" ? "Video" : type === "paper" || type === "pdf" ? "Paper" : type.replaceAll("_", " ");
}

function sessionHref(type: ResourceType | null, sessionId: string): string {
  return type === "video" ? `/app/study/video/${sessionId}` : type === "paper" || type === "pdf" ? `/app/study/paper/${sessionId}` : "/app/sessions";
}

export async function searchWorkspace(userId: string, rawQuery: string): Promise<GlobalSearchResult[]> {
  const query = rawQuery.trim().slice(0, 120);
  if (query.length < 2) return [];
  const pattern = likePattern(query);

  return withUserTransaction(userId, async (tx) => {
    const textMatch = or(ilike(resources.title, pattern), ilike(resources.description, pattern));
    const [resourceRows, sessionRows, libraryRows, collectionRows, conceptRows] = await Promise.all([
      tx.select({ id: resources.id, title: resources.title, description: resources.description, type: resources.type, provider: resources.provider })
        .from(resources)
        .where(and(or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])), inArray(resources.type, ["video", "paper", "pdf"]), eq(resources.status, "ready"), isNull(resources.deletedAt), textMatch))
        .orderBy(desc(resources.qualityScore), desc(resources.updatedAt))
        .limit(6),
      tx.select({ id: studySessions.id, title: studySessions.title, activeResourceId: studySessions.activeResourceId, resourceTitle: resources.title, resourceType: resources.type })
        .from(studySessions)
        .leftJoin(resources, eq(resources.id, studySessions.activeResourceId))
        .where(and(eq(studySessions.userId, userId), ne(studySessions.status, "abandoned"), or(ilike(studySessions.title, pattern), ilike(resources.title, pattern))))
        .orderBy(desc(studySessions.lastActiveAt))
        .limit(6),
      tx.select({ id: libraryItems.resourceId, title: resources.title, description: resources.description, type: resources.type })
        .from(libraryItems)
        .innerJoin(resources, eq(resources.id, libraryItems.resourceId))
        .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"), isNull(resources.deletedAt), textMatch))
        .orderBy(desc(libraryItems.updatedAt))
        .limit(6),
      tx.select({ id: collections.id, title: collections.title, description: collections.description })
        .from(collections)
        .where(and(or(eq(collections.ownerUserId, userId), eq(collections.visibility, "public")), or(ilike(collections.title, pattern), ilike(collections.description, pattern))))
        .orderBy(desc(collections.updatedAt))
        .limit(5),
      tx.select({ id: concepts.id, name: concepts.name, summary: concepts.summary })
        .from(concepts)
        .where(and(eq(concepts.status, "active"), or(ilike(concepts.name, pattern), ilike(concepts.summary, pattern))))
        .orderBy(asc(concepts.name))
        .limit(5),
    ]);

    return [
      ...resourceRows.map((row) => ({ id: row.id, kind: "resource" as const, title: row.title, subtitle: row.description ?? `${resourceLabel(row.type)} · ${row.provider}`, href: null, resourceId: row.id, resourceType: row.type })),
      ...sessionRows.map((row) => ({ id: row.id, kind: "session" as const, title: row.title ?? row.resourceTitle ?? "Untitled session", subtitle: row.resourceTitle ? `Session · ${row.resourceTitle}` : "Session", href: sessionHref(row.resourceType, row.id), resourceId: row.activeResourceId, resourceType: row.resourceType })),
      ...libraryRows.map((row) => ({ id: row.id, kind: "library" as const, title: row.title, subtitle: row.description ?? `${resourceLabel(row.type)} · Saved`, href: "/app/library", resourceId: row.id, resourceType: row.type })),
      ...collectionRows.map((row) => ({ id: row.id, kind: "library" as const, title: row.title, subtitle: row.description ?? "Collection", href: `/app/library/collections/${row.id}`, resourceId: null, resourceType: null })),
      ...conceptRows.map((row) => ({ id: row.id, kind: "concept" as const, title: row.name, subtitle: row.summary ?? "Concept", href: "/app/second-brain", resourceId: null, resourceType: null })),
    ];
  });
}

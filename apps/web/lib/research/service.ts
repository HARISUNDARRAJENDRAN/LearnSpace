import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  artifactDetails,
  artifactSources,
  authors,
  favoriteAuthors,
  libraryItems,
  paperAuthors,
  paperDetails,
  resourceConcepts,
  resources,
  concepts,
  sessionTranscript,
  userResourceProgress,
  userSettings,
} from "@learnspace/db/schema";
import type { ResearchAuthorSummary, ResearchPaper, StudySessionSummary } from "@learnspace/shared";
import { onboardingDraftSchema, studyResourceReadinessSchema } from "@learnspace/shared";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { rankPaperResourcesForUser } from "../discovery/service";
import { listStudySessions } from "../study/service";
import { scoreResearchAffinity, type ResearchAffinitySignal } from "./affinity";

// A save alone (6) or a save plus one open (~7.8) is not a favourite; a save plus real reading, or repeated engagement, is.
const IMPLICIT_FAVORITE_SCORE = 8;

type PaperRow = { resource: typeof resources.$inferSelect; paper: typeof paperDetails.$inferSelect };
export type ResearchPageData = {
  query: string;
  tab: "for-you" | "following" | "foundational";
  topicId: string | null;
  topics: { id: string; name: string }[];
  recommended: ResearchPaper[];
  foundational: ResearchPaper[];
  recent: ResearchPaper[];
  saved: ResearchPaper[];
  favoriteAuthors: ResearchAuthorSummary[];
  suggestedAuthors: ResearchAuthorSummary[];
};

function metadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function pushSignal(target: Map<string, ResearchAffinitySignal[]>, authorIds: string[], signal: ResearchAffinitySignal) {
  for (const authorId of authorIds) target.set(authorId, [...(target.get(authorId) ?? []), signal]);
}

async function paperSummaries(tx: Transaction, userId: string, paperRows: PaperRow[]) {
  const ids = paperRows.map(({ resource }) => resource.id);
  if (!ids.length) return { papers: [] as ResearchPaper[], authorIdsByPaper: new Map<string, string[]>(), authorNamesById: new Map<string, string>(), conceptsByPaper: new Map<string, { id: string; name: string }[]>(), savedAt: new Map<string, Date>(), signalsByAuthor: new Map<string, ResearchAffinitySignal[]>(), now: new Date() };
  const [authorRows, conceptRows, savedRows, progressRows, noteRows, transcriptRows] = await Promise.all([
    tx.select({ resourceId: paperAuthors.paperResourceId, id: authors.id, name: authors.preferredName }).from(paperAuthors).innerJoin(authors, eq(authors.id, paperAuthors.authorId)).where(inArray(paperAuthors.paperResourceId, ids)).orderBy(asc(paperAuthors.ordinal)),
    tx.select({ resourceId: resourceConcepts.resourceId, id: concepts.id, name: concepts.name }).from(resourceConcepts).innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId)).where(inArray(resourceConcepts.resourceId, ids)),
    tx.select({ resourceId: libraryItems.resourceId, addedAt: libraryItems.addedAt }).from(libraryItems).where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"), inArray(libraryItems.resourceId, ids))),
    tx.select({ resourceId: userResourceProgress.resourceId, lastOpenedAt: userResourceProgress.lastOpenedAt, updatedAt: userResourceProgress.updatedAt, status: userResourceProgress.status, progressPct: userResourceProgress.progressPct }).from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, ids))),
    tx.select({ resourceId: artifactSources.sourceResourceId, occurredAt: artifactDetails.updatedAt }).from(artifactSources).innerJoin(artifactDetails, eq(artifactDetails.resourceId, artifactSources.artifactResourceId)).where(and(eq(artifactDetails.userId, userId), eq(artifactDetails.artifactType, "note"), inArray(artifactSources.sourceResourceId, ids))),
    tx.select({ resourceId: sessionTranscript.resourceId, occurredAt: sessionTranscript.createdAt }).from(sessionTranscript).where(and(eq(sessionTranscript.userId, userId), eq(sessionTranscript.speaker, "you"), inArray(sessionTranscript.resourceId, ids))),
  ]);
  const authorsByPaper = new Map<string, string[]>();
  const authorIdsByPaper = new Map<string, string[]>();
  const authorNamesById = new Map<string, string>();
  for (const row of authorRows) {
    authorsByPaper.set(row.resourceId, [...(authorsByPaper.get(row.resourceId) ?? []), row.name]);
    authorIdsByPaper.set(row.resourceId, [...(authorIdsByPaper.get(row.resourceId) ?? []), row.id]);
    authorNamesById.set(row.id, row.name);
  }
  const conceptsByPaper = new Map<string, { id: string; name: string }[]>();
  for (const row of conceptRows) conceptsByPaper.set(row.resourceId, [...(conceptsByPaper.get(row.resourceId) ?? []), { id: row.id, name: row.name }]);
  const savedAt = new Map(savedRows.map(({ resourceId, addedAt }) => [resourceId, addedAt]));
  const signalsByAuthor = new Map<string, ResearchAffinitySignal[]>();
  const now = new Date();
  for (const row of savedRows) pushSignal(signalsByAuthor, authorIdsByPaper.get(row.resourceId) ?? [], { kind: "saved", occurredAt: row.addedAt });
  for (const row of progressRows) {
    const authorIds = authorIdsByPaper.get(row.resourceId) ?? [];
    if (row.lastOpenedAt) pushSignal(signalsByAuthor, authorIds, { kind: "opened", occurredAt: row.lastOpenedAt });
    if ((row.progressPct ?? 0) > 0) pushSignal(signalsByAuthor, authorIds, { kind: "reading", occurredAt: row.updatedAt });
    if (row.status === "completed") pushSignal(signalsByAuthor, authorIds, { kind: "completed", occurredAt: row.updatedAt });
  }
  for (const row of noteRows) pushSignal(signalsByAuthor, authorIdsByPaper.get(row.resourceId) ?? [], { kind: "note", occurredAt: row.occurredAt });
  const engagementCounts = new Map<string, { count: number; occurredAt: Date }>();
  for (const row of transcriptRows) {
    const current = engagementCounts.get(row.resourceId);
    engagementCounts.set(row.resourceId, { count: (current?.count ?? 0) + 1, occurredAt: !current || row.occurredAt > current.occurredAt ? row.occurredAt : current.occurredAt });
  }
  for (const [resourceId, engagement] of engagementCounts) pushSignal(signalsByAuthor, authorIdsByPaper.get(resourceId) ?? [], { kind: "engaged", occurredAt: engagement.occurredAt, count: engagement.count });
  const papers = paperRows.map(({ resource, paper }) => ({
    resourceId: resource.id,
    title: resource.title,
    abstract: paper.abstract,
    authors: authorsByPaper.get(resource.id) ?? [],
    authorIds: authorIdsByPaper.get(resource.id) ?? [],
    venue: paper.venue,
    publicationDate: paper.publicationDate ? String(paper.publicationDate) : null,
    arxivId: paper.arxivId,
    doi: paper.doi,
    pdfSourceUrl: paper.pdfSourceUrl,
    conceptNames: (conceptsByPaper.get(resource.id) ?? []).map(({ name }) => name),
    saved: savedAt.has(resource.id),
    readiness: resource.status === "failed" || resource.status === "archived" ? "unavailable" : resource.currentVersionId ? studyResourceReadinessSchema.parse("ready") : "preparing",
  } satisfies ResearchPaper));
  return { papers, authorIdsByPaper, authorNamesById, conceptsByPaper, savedAt, signalsByAuthor, now };
}

export async function getResearchPage(userId: string, query = "", options: { tab?: string | undefined; topicId?: string | undefined } = {}): Promise<ResearchPageData> {
  return withUserTransaction(userId, async (tx) => {
    const normalizedQuery = query.trim().slice(0, 160);
    const tab = options.tab === "following" || options.tab === "foundational" ? options.tab : "for-you";
    const [settings, follows] = await Promise.all([
      tx.select({ learningPreferences: userSettings.learningPreferences }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
      tx.select({ authorId: favoriteAuthors.authorId, followedAt: favoriteAuthors.followedAt }).from(favoriteAuthors).where(eq(favoriteAuthors.userId, userId)).orderBy(desc(favoriteAuthors.followedAt)),
    ]);
    const draft = onboardingDraftSchema.safeParse(settings[0]?.learningPreferences ?? {});
    const topicIds = draft.success ? draft.data.conceptIds ?? [] : [];
    const selectedTopics = topicIds.length ? await tx.select({ id: concepts.id, name: concepts.name }).from(concepts).where(inArray(concepts.id, topicIds)).orderBy(asc(concepts.name)) : [];
    const topicId = selectedTopics.some((topic) => topic.id === options.topicId) ? options.topicId! : null;
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
    const summary = await paperSummaries(tx, userId, paperRows);
    const ids = paperRows.map(({ resource }) => resource.id);
    const catalogCounts = ids.length ? await tx.select({
      authorId: paperAuthors.authorId,
      paperCount: count(),
      unreadCount: count(sql`CASE WHEN ${userResourceProgress.lastOpenedAt} IS NULL THEN 1 END`),
    }).from(paperAuthors)
      .innerJoin(resources, eq(resources.id, paperAuthors.paperResourceId))
      .leftJoin(userResourceProgress, and(eq(userResourceProgress.resourceId, resources.id), eq(userResourceProgress.userId, userId)))
      .where(and(eq(resources.type, "paper"), inArray(resources.status, ["pending", "processing", "ready"]), isNull(resources.deletedAt), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"]))))
      .groupBy(paperAuthors.authorId) : [];
    const countsByAuthor = new Map(catalogCounts.map(({ authorId, paperCount, unreadCount }) => [authorId, { paperCount, unreadCount }]));
    const affinity = new Map([...summary.signalsByAuthor].map(([authorId, signals]) => [authorId, scoreResearchAffinity(signals, summary.now)]));
    const followedIds = new Set(follows.map(({ authorId }) => authorId));
    const candidateAuthorIds = new Set([...countsByAuthor.keys(), ...summary.authorNamesById.keys()]);
    const authorRows = candidateAuthorIds.size ? await tx.select({ id: authors.id, name: authors.preferredName }).from(authors).where(inArray(authors.id, [...candidateAuthorIds])) : [];
    const authorNameMap = new Map([...authorRows.map(({ id, name }) => [id, name] as const), ...summary.authorNamesById]);
    const makeAuthor = (authorId: string): ResearchAuthorSummary => ({
      authorId,
      name: authorNameMap.get(authorId) ?? "Unknown author",
      paperCount: countsByAuthor.get(authorId)?.paperCount ?? 0,
      unreadCount: countsByAuthor.get(authorId)?.unreadCount ?? 0,
      followed: followedIds.has(authorId),
      affinityScore: affinity.get(authorId) ?? 0,
      source: followedIds.has(authorId) ? "followed" : (affinity.get(authorId) ?? 0) >= IMPLICIT_FAVORITE_SCORE ? "engaged" : "suggested",
    });
    const authorsByAffinity = [...candidateAuthorIds].map(makeAuthor).sort((a, b) => Number(b.followed) - Number(a.followed) || b.affinityScore - a.affinityScore || a.name.localeCompare(b.name));
    const followedAuthorsSummary = follows.map(({ authorId }) => authorRows.find((author) => author.id === authorId) ? makeAuthor(authorId) : null).filter((author): author is ResearchAuthorSummary => author !== null);
    const foundational = summary.papers.filter((paper) => {
      const row = paperRows.find((candidate) => candidate.resource.id === paper.resourceId);
      return row && metadataValue(row.paper.metadata, "paperClass") === "foundational";
    });
    const selectedTopic = selectedTopics.find((topic) => topic.id === topicId);
    const rankedIds = normalizedQuery.length ? [] : await rankPaperResourcesForUser(tx, userId, ids);
    const rankedSet = new Set(rankedIds);
    const ordered = [...rankedIds.map((id) => summary.papers.find((paper) => paper.resourceId === id)).filter((paper): paper is ResearchPaper => Boolean(paper)), ...summary.papers.filter((paper) => !rankedSet.has(paper.resourceId))];
    const affinityScore = (paper: ResearchPaper) => Math.max(0, ...paper.authorIds.map((authorId) => affinity.get(authorId) ?? 0));
    ordered.sort((a, b) => Number(b.authorIds.some((id) => followedIds.has(id))) - Number(a.authorIds.some((id) => followedIds.has(id))) || affinityScore(b) - affinityScore(a));
    let feed = normalizedQuery ? summary.papers : ordered;
    if (tab === "foundational") feed = foundational;
    if (tab === "following") feed = feed.filter((paper) => paper.authorIds.some((authorId) => followedIds.has(authorId))).sort((a, b) => affinityScore(b) - affinityScore(a));
    if (selectedTopic) feed = feed.filter((paper) => (summary.conceptsByPaper.get(paper.resourceId) ?? []).some((concept) => concept.id === selectedTopic.id));
    const recent = [...summary.papers].sort((a, b) => (b.publicationDate ?? "").localeCompare(a.publicationDate ?? ""));
    const recentSaved = [...summary.papers].filter((paper) => paper.saved).sort((a, b) => (summary.savedAt.get(b.resourceId)?.getTime() ?? 0) - (summary.savedAt.get(a.resourceId)?.getTime() ?? 0));
    const interestFoundational = topicIds.length ? foundational.filter((paper) => (summary.conceptsByPaper.get(paper.resourceId) ?? []).some(({ id }) => topicIds.includes(id))) : foundational;
    // Explicit follows lead; authors the learner keeps reading (several real signals, recency-weighted) follow them.
    const engagedAuthors = authorsByAffinity.filter((author) => author.source === "engaged");
    const favoriteAuthorsList = [...followedAuthorsSummary, ...engagedAuthors].slice(0, 16);
    const favoriteIds = new Set(favoriteAuthorsList.map(({ authorId }) => authorId));
    const suggestions = [...new Set(interestFoundational.flatMap((paper) => paper.authorIds))].filter((authorId) => !favoriteIds.has(authorId));
    const suggestedAuthors = (suggestions.length ? suggestions.map(makeAuthor) : authorsByAffinity.filter((author) => !favoriteIds.has(author.authorId) && author.paperCount > 0)).slice(0, 12);
    return {
      query: normalizedQuery,
      tab,
      topicId,
      topics: selectedTopics,
      recommended: feed.slice(0, 30),
      foundational: foundational.slice(0, 12),
      recent: recent.slice(0, 12),
      saved: recentSaved.slice(0, 12),
      favoriteAuthors: favoriteAuthorsList,
      suggestedAuthors,
    };
  });
}

export async function followResearchAuthor(userId: string, authorId: string) {
  return withUserTransaction(userId, async (tx) => {
    const [author] = await tx.select({ id: authors.id }).from(authors).where(eq(authors.id, authorId)).limit(1);
    if (!author) throw new AuthError("RESEARCH_AUTHOR_NOT_FOUND", "This author is not in the catalogue.", 404);
    await tx.insert(favoriteAuthors).values({ userId, authorId }).onConflictDoNothing();
    return { followed: true };
  });
}

export async function unfollowResearchAuthor(userId: string, authorId: string) {
  await withUserTransaction(userId, (tx) => tx.delete(favoriteAuthors).where(and(eq(favoriteAuthors.userId, userId), eq(favoriteAuthors.authorId, authorId))));
  return { followed: false };
}

export async function getResearchAuthorPage(userId: string, authorId: string) {
  return withUserTransaction(userId, async (tx) => {
    const [author] = await tx.select().from(authors).where(eq(authors.id, authorId)).limit(1);
    if (!author) throw new AuthError("RESEARCH_AUTHOR_NOT_FOUND", "This author is not in the catalogue.", 404);
    const paperRows = await tx.select({ resource: resources, paper: paperDetails })
      .from(paperAuthors).innerJoin(resources, eq(resources.id, paperAuthors.paperResourceId)).innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
      .where(and(eq(paperAuthors.authorId, authorId), eq(resources.type, "paper"), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])), inArray(resources.status, ["pending", "processing", "ready"]), isNull(resources.deletedAt)))
      .orderBy(desc(paperDetails.publicationDate), desc(resources.qualityScore)).limit(100);
    const summary = await paperSummaries(tx, userId, paperRows);
    const follows = await tx.select({ authorId: favoriteAuthors.authorId }).from(favoriteAuthors).where(and(eq(favoriteAuthors.userId, userId), eq(favoriteAuthors.authorId, authorId))).limit(1);
    return { author: { authorId: author.id, name: author.preferredName, followed: follows.length > 0 }, papers: summary.papers };
  });
}

export type ResearchLibraryPaper = ResearchPaper & { savedAt: string; progressPct: number; page: number | null; completed: boolean };
export type ResearchLibraryData = { reading: StudySessionSummary[]; finished: StudySessionSummary[]; saved: ResearchLibraryPaper[] };

const isPaperSession = (session: StudySessionSummary) => session.activeResource?.type === "paper";

/** The Research side of the Library: papers being read (resumable), saved papers with their reading position, and finished paper sessions. */
export async function getResearchLibrary(userId: string): Promise<ResearchLibraryData> {
  const [open, finished, saved] = await Promise.all([
    listStudySessions(userId, "open"),
    listStudySessions(userId, "library"),
    withUserTransaction(userId, async (tx) => {
      const rows = await tx.select({ resource: resources, paper: paperDetails, addedAt: libraryItems.addedAt, progressPct: userResourceProgress.progressPct, status: userResourceProgress.status, lastAnchor: userResourceProgress.lastAnchor })
        .from(libraryItems)
        .innerJoin(resources, eq(resources.id, libraryItems.resourceId))
        .innerJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
        .leftJoin(userResourceProgress, and(eq(userResourceProgress.resourceId, resources.id), eq(userResourceProgress.userId, userId)))
        .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "saved"), eq(resources.type, "paper"), isNull(resources.deletedAt)))
        .orderBy(desc(libraryItems.addedAt))
        .limit(200);
      const { papers } = await paperSummaries(tx, userId, rows);
      return papers.map((paper, index): ResearchLibraryPaper => {
        const row = rows[index]!;
        const page = Number(row.lastAnchor?.page);
        return { ...paper, savedAt: row.addedAt.toISOString(), progressPct: Number(row.progressPct ?? 0), page: Number.isInteger(page) && page > 0 ? page : null, completed: row.status === "completed" };
      });
    }),
  ]);
  return { reading: open.filter(isPaperSession), finished: finished.filter(isPaperSession), saved };
}

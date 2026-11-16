import type { Transaction } from "@learnspace/db";
import { collectionItems, collections, collectionSections, resources, studySessions, videoDetails, videoNotes } from "@learnspace/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

/** The course or playlist a session's video belongs to: what a learner asking about "this playlist" means. */
export type CourseOutline = {
  title: string;
  description: string | null;
  lessons: Array<{ section: string; title: string; durationMs: number | null; description: string | null; current: boolean }>;
};

const MAX_COURSE_LESSONS = 120;
const LESSON_DESCRIPTION_CHARS = 240;
const MAX_OUTLINE_HEADINGS = 160;

/** The session's course in study order, or null when the session is a single video. */
export async function courseOutline(tx: Transaction, userId: string, sessionId: string): Promise<CourseOutline | null> {
  const [session] = await tx.select({ metadata: studySessions.metadata, activeResourceId: studySessions.activeResourceId }).from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId))).limit(1);
  const course = session?.metadata.course;
  const collectionId = course && typeof course === "object" && !Array.isArray(course) ? (course as Record<string, unknown>).collectionId : null;
  if (typeof collectionId !== "string") return null;
  const [collection] = await tx.select({ title: collections.title, description: collections.description }).from(collections).where(eq(collections.id, collectionId)).limit(1);
  if (!collection) return null;
  const rows = await tx
    .select({ resourceId: resources.id, section: collectionSections.title, title: resources.title, description: resources.description, durationMs: videoDetails.durationMs })
    .from(collectionItems)
    .innerJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
    .innerJoin(resources, eq(resources.id, collectionItems.resourceId))
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .where(and(eq(collectionSections.collectionId, collectionId), eq(collectionItems.required, true), eq(resources.type, "video"), isNull(resources.deletedAt)))
    .orderBy(asc(collectionSections.position), asc(collectionItems.position))
    .limit(MAX_COURSE_LESSONS * 2);
  const seen = new Set<string>();
  const lessons = rows.filter((row) => !seen.has(row.resourceId) && Boolean(seen.add(row.resourceId))).slice(0, MAX_COURSE_LESSONS).map((row) => ({
    section: row.section, title: row.title, durationMs: row.durationMs,
    description: row.description ? row.description.replace(/\s+/g, " ").trim().slice(0, LESSON_DESCRIPTION_CHARS) || null : null,
    current: row.resourceId === session!.activeResourceId,
  }));
  return lessons.length ? { title: collection.title, description: collection.description, lessons } : null;
}

/**
 * The headings of the learner's study guide for this video, each with the moment it starts: an outline of the whole
 * lecture however long it is, which a handful of transcript passages can't give for a 20-hour course.
 */
export async function lessonOutline(tx: Transaction, userId: string, resourceId: string): Promise<string[]> {
  const [row] = await tx.select({ blocks: videoNotes.blocks, status: videoNotes.guideStatus }).from(videoNotes)
    .where(and(eq(videoNotes.userId, userId), eq(videoNotes.resourceId, resourceId))).limit(1);
  if (!row || row.status !== "ready") return [];
  const headings = row.blocks.flatMap((block) => {
    const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown };
    return (type === "heading" || type === "subheading") && typeof text === "string" && text.trim() ? [`${type === "subheading" ? "  - " : "- "}${text.trim().slice(0, 160)}`] : [];
  });
  // A very long guide keeps its major topics and drops subheadings first.
  return headings.length <= MAX_OUTLINE_HEADINGS ? headings : headings.filter((line) => line.startsWith("- ")).slice(0, MAX_OUTLINE_HEADINGS);
}

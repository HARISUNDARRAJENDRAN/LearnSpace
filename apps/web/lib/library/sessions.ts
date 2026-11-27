import { type Transaction, withUserTransaction } from "@learnspace/db";
import { codingAttempts, codingProblems, paperCodingProfiles, resources, sessionResources, sessionTranscript, studySessions, tutorMessages, tutorThreads, videoNotes } from "@learnspace/db/schema";
import { type ResearchGuide, researchGuideSchema, studyWorkspaceSchema } from "@learnspace/shared";
import type { NoteBlock } from "@learnspace/shared/notes";
import type { TutorSource } from "@learnspace/shared/tutor";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { messageView } from "../tutor/service";

export type LibraryChatMessage = { id: string; role: "you" | "luna"; text: string; createdAt: string; sources?: TutorSource[] };

/** Saved artifacts for a session in the Library or Sessions. */
export type LibrarySessionContents = {
  sessionId: string;
  lessons: Array<{
    resourceId: string;
    title: string;
    type: "video" | "paper" | "other";
    notes: NoteBlock[];
    guide: ResearchGuide | null;
    exercises: Array<{ id: string; title: string; solved: boolean; drafts: Record<string, string> }>;
    /** The spoken conversation that built the notes. */
    voice: LibraryChatMessage[];
    /** Typed conversations with the tutor, oldest first. */
    chats: Array<{ id: string; startedAt: string; messages: LibraryChatMessage[] }>;
  }>;
  code: { language: string; code: string } | null;
};

const iso = (value: Date) => value.toISOString();

export async function getLibrarySessionContents(userId: string, sessionId: string): Promise<LibrarySessionContents> {
  return withUserTransaction(userId, (tx) => readSessionContents(tx, userId, sessionId, "completed"));
}

export function getEndedSessionContents(userId: string, sessionId: string) {
  return withUserTransaction(userId, (tx) => readSessionContents(tx, userId, sessionId, "abandoned"));
}

async function readSessionContents(tx: Transaction, userId: string, sessionId: string, status: "abandoned" | "completed"): Promise<LibrarySessionContents> {
  const [session] = await tx.select({ id: studySessions.id, workspace: studySessions.workspace }).from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId), eq(studySessions.status, status))).limit(1);
  if (!session) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That session history is unavailable.", 404);
  const lessonRows = await tx.select({ id: sessionResources.resourceId, title: resources.title, type: resources.type, guide: paperCodingProfiles.guide }).from(sessionResources)
    .leftJoin(resources, and(eq(resources.id, sessionResources.resourceId), isNull(resources.deletedAt)))
    .leftJoin(paperCodingProfiles, and(eq(paperCodingProfiles.resourceId, resources.id), eq(paperCodingProfiles.resourceVersionId, sessionResources.resourceVersionId), eq(paperCodingProfiles.guideStatus, "ready")))
    .where(eq(sessionResources.studySessionId, sessionId)).orderBy(asc(sessionResources.position));
  const ids = lessonRows.map((row) => row.id);
  const [noteRows, voiceRows, exerciseRows, threadRows] = ids.length === 0 ? [[], [], [], []] : await Promise.all([
    tx.select({ resourceId: videoNotes.resourceId, blocks: videoNotes.blocks }).from(videoNotes).where(and(eq(videoNotes.userId, userId), inArray(videoNotes.resourceId, ids))),
    tx.select().from(sessionTranscript).where(and(eq(sessionTranscript.studySessionId, sessionId), eq(sessionTranscript.userId, userId))).orderBy(asc(sessionTranscript.seq)),
    tx.select({ id: codingAttempts.id, resourceId: codingAttempts.resourceId, title: codingProblems.title, solved: codingAttempts.correctSolved, drafts: codingAttempts.drafts })
      .from(codingAttempts).leftJoin(codingProblems, eq(codingProblems.id, codingAttempts.problemId))
      .where(and(eq(codingAttempts.userId, userId), eq(codingAttempts.studySessionId, sessionId), inArray(codingAttempts.resourceId, ids)))
      .orderBy(asc(codingAttempts.startedAt), asc(codingAttempts.id)),
    tx.select().from(tutorThreads).where(and(eq(tutorThreads.studySessionId, sessionId), eq(tutorThreads.userId, userId))).orderBy(asc(tutorThreads.startedAt), asc(tutorThreads.id)),
  ]);
  const messageRows = threadRows.length > 0
    ? await tx.select().from(tutorMessages).where(and(inArray(tutorMessages.threadId, threadRows.map((thread) => thread.id)), eq(tutorMessages.status, "completed"))).orderBy(asc(tutorMessages.createdAt), asc(tutorMessages.id))
    : [];
  const messagesByThread = Map.groupBy(messageRows, (row) => row.threadId);
  const code = studyWorkspaceSchema.shape.code.safeParse(session.workspace.code);
  return {
    sessionId,
    lessons: lessonRows.map((lesson) => ({
      resourceId: lesson.id,
      title: lesson.title ?? "Unavailable material",
      type: lesson.type === "video" ? "video" : lesson.type === "paper" || lesson.type === "pdf" ? "paper" : "other",
      notes: (noteRows.find((row) => row.resourceId === lesson.id)?.blocks ?? []) as NoteBlock[],
      guide: researchGuideSchema.safeParse(lesson.guide).data ?? null,
      exercises: exerciseRows.filter((row) => row.resourceId === lesson.id).map(({ id, title, solved, drafts }) => ({ id, title: title ?? "Code exercise", solved, drafts })),
      voice: voiceRows.filter((row) => row.resourceId === lesson.id).map((row) => ({ id: row.id, role: row.speaker === "you" ? "you" : "luna", text: row.text, createdAt: iso(row.createdAt) })),
      chats: threadRows.filter((thread) => thread.resourceId === lesson.id).flatMap((thread) => {
        const messages = (messagesByThread.get(thread.id) ?? []).map((row) => {
          const view = messageView(row, null, lesson.type === "paper" || lesson.type === "pdf" ? "paper" : "video");
          return { id: row.id, role: view.role === "user" ? "you" : "luna", text: view.text, createdAt: view.createdAt, sources: view.sources } satisfies LibraryChatMessage;
        }).filter((message) => message.text.trim());
        return messages.length > 0 ? [{ id: thread.id, startedAt: iso(thread.startedAt), messages }] : [];
      }),
    })),
    code: code.success && code.data?.code.trim() ? code.data : null,
  };
}

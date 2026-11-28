import { createHash } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { resources, sessionFolderMemberships as memberships, sessionFolderResources as savedResources, sessionFolders as folders, studySessions } from "@learnspace/db/schema";
import type { ChangeSessionFolder, CreateSessionFolder, StartStudySessionResponse } from "@learnspace/shared";
import { and, asc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { invalidateHomeFeedCache } from "../discovery/cache";
import { startOrResumeInTransaction } from "../study/service";

function folderNotFound() {
  return new AuthError("FOLDER_NOT_FOUND", "This folder is no longer available.", 404);
}

export async function ownedFolder(tx: Transaction, userId: string, folderId: string) {
  const [folder] = await tx.select().from(folders).where(and(eq(folders.userId, userId), eq(folders.id, folderId)));
  if (!folder) throw folderNotFound();
  return folder;
}

function writeFolders<T>(userId: string, write: (tx: Transaction) => Promise<T>) {
  return withUserTransaction(userId, async (tx) => {
    // Serialize append, moves, and swaps across the learner's folders.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.folders:${userId}`}, 0))`);
    return write(tx);
  });
}

export function listSessionFolders(userId: string) {
  return withUserTransaction(userId, async (tx) => {
    const [folderRows, memberRows] = await Promise.all([
      tx.select({ id: folders.id, title: folders.title, description: folders.description }).from(folders).where(eq(folders.userId, userId))
        .orderBy(asc(folders.position), asc(folders.id)),
      tx.select({ folderId: memberships.folderId, sessionId: memberships.studySessionId }).from(memberships)
        .where(eq(memberships.userId, userId)).orderBy(asc(memberships.position), asc(memberships.studySessionId)),
    ]);
    const byFolder = Map.groupBy(memberRows, (row) => row.folderId);
    return folderRows.map((folder) => ({ ...folder, sessionIds: (byFolder.get(folder.id) ?? []).map((row) => row.sessionId) }));
  });
}

export function folderIdForSession(userId: string, sessionId: string): Promise<string | null> {
  return withUserTransaction(userId, async (tx) => {
    const [row] = await tx
      .select({ folderId: memberships.folderId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.studySessionId, sessionId)))
      .limit(1);
    return row?.folderId ?? null;
  });
}

async function touch(tx: Transaction, userId: string, folderIds: string[]) {
  await tx.update(folders).set({ updatedAt: new Date() }).where(and(eq(folders.userId, userId), inArray(folders.id, folderIds)));
}

async function moveSession(tx: Transaction, userId: string, folderId: string, sessionId: string, fromFolderId: string | null) {
  const [session] = await tx.select({ id: studySessions.id }).from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.id, sessionId), sql`${studySessions.metadata}->>'folderWorkspace' IS DISTINCT FROM 'true'`));
  if (!session) throw new AuthError("STUDY_SESSION_NOT_FOUND", "This session is no longer available.", 404);
  const [existing] = await tx.select({ folderId: memberships.folderId }).from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.studySessionId, sessionId)));
  const current = existing?.folderId ?? null;
  if (current === folderId) return;
  if (current !== fromFolderId) {
    const source = current ? await ownedFolder(tx, userId, current) : null;
    throw new AuthError("FOLDER_MEMBERSHIP_CHANGED", source ? `This session is in “${source.title}”.` : "This session is now unfiled.", 409, undefined,
      { folderId: current, sessionId });
  }
  const [last] = await tx.select({ position: max(memberships.position) }).from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.folderId, folderId)));
  const position = (last?.position ?? -1) + 1;
  await tx.insert(memberships).values({ userId, folderId, studySessionId: sessionId, position })
    .onConflictDoUpdate({ target: memberships.studySessionId, set: { folderId, position, addedAt: new Date() } });
  await touch(tx, userId, current ? [folderId, current] : [folderId]);
}

export function createSessionFolder(userId: string, input: CreateSessionFolder) {
  return writeFolders(userId, async (tx) => {
    const [last] = await tx.select({ position: max(folders.position) }).from(folders).where(eq(folders.userId, userId));
    const [folder] = await tx.insert(folders).values({ userId, title: input.title, description: input.description || null, position: (last?.position ?? -1) + 1 }).returning({ id: folders.id });
    if (!folder) throw new Error("Folder could not be created");
    if (input.sessionId) await moveSession(tx, userId, folder.id, input.sessionId, input.fromFolderId ?? null);
    return folder;
  });
}

export function deleteSessionFolder(userId: string, folderId: string) {
  return writeFolders(userId, (tx) => tx.delete(folders).where(and(eq(folders.userId, userId), eq(folders.id, folderId))));
}

function adjacent<T extends { id: string; position: number }>(rows: T[], id: string, direction: "up" | "down") {
  const index = rows.findIndex((row) => row.id === id);
  const moving = rows[index];
  const neighbor = rows[index + (direction === "up" ? -1 : 1)];
  return moving && neighbor ? [moving, neighbor] as const : null;
}

export async function changeSessionFolder(userId: string, folderId: string, input: ChangeSessionFolder) {
  const result = await writeFolders<StartStudySessionResponse | null>(userId, async (tx) => {
    await ownedFolder(tx, userId, folderId);
    const owned = and(eq(folders.userId, userId), eq(folders.id, folderId));
    const members = and(eq(memberships.userId, userId), eq(memberships.folderId, folderId));
    const saved = and(eq(savedResources.userId, userId), eq(savedResources.folderId, folderId));
    switch (input.action) {
      case "edit":
        await tx.update(folders).set({ title: input.title, description: input.description || null, updatedAt: new Date() }).where(owned);
        break;
      case "move-session":
        await moveSession(tx, userId, folderId, input.sessionId, input.fromFolderId);
        break;
      case "unfile-session": {
        const removed = await tx.delete(memberships).where(and(members, eq(memberships.studySessionId, input.sessionId))).returning({ id: memberships.studySessionId });
        if (removed.length) await touch(tx, userId, [folderId]);
        break;
      }
      case "save-resource": {
        const [resource] = await tx.select({ id: resources.id }).from(resources).where(and(
          eq(resources.id, input.resourceId),
          or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])),
          inArray(resources.type, ["paper", "pdf", "video"]), isNull(resources.deletedAt),
        ));
        if (!resource) throw new AuthError("RESOURCE_NOT_AVAILABLE", "This material is no longer available.", 404);
        const [last] = await tx.select({ position: max(savedResources.position) }).from(savedResources).where(saved);
        const added = await tx.insert(savedResources).values({ userId, folderId, resourceId: input.resourceId, position: (last?.position ?? -1) + 1 })
          .onConflictDoNothing().returning({ id: savedResources.resourceId });
        if (added.length) await touch(tx, userId, [folderId]);
        break;
      }
      case "remove-resource": {
        const removed = await tx.delete(savedResources).where(and(saved, eq(savedResources.resourceId, input.resourceId))).returning({ id: savedResources.resourceId });
        if (removed.length) await touch(tx, userId, [folderId]);
        break;
      }
      case "start-resource": {
        const [link] = await tx.select({ type: resources.type }).from(savedResources).innerJoin(resources, eq(resources.id, savedResources.resourceId))
          .where(and(saved, eq(savedResources.resourceId, input.resourceId), isNull(resources.deletedAt)));
        if (!link) throw new AuthError("RESOURCE_NOT_AVAILABLE", "This material is no longer available in the folder.", 404);
        const key = createHash("sha256").update(`folder:${folderId}:${input.idempotencyKey}`).digest("hex");
        return startOrResumeInTransaction(tx, userId, {
          resourceId: input.resourceId, origin: "session", idempotencyKey: key,
          mode: link.type === "video" ? "guided_learning" : "research",
        }, async ({ sessionId }) => {
          if (input.moveFrom && input.moveFrom.sessionId !== sessionId) {
            throw new AuthError("FOLDER_SESSION_CHANGED", "The session to resume changed. Open the material again to review it.", 409);
          }
          await moveSession(tx, userId, folderId, sessionId, input.moveFrom?.folderId ?? null);
        }, { folderId: input.moveFrom ? input.moveFrom.folderId : folderId });
      }
      case "reorder-folder": {
        const rows = await tx.select({ id: folders.id, position: folders.position }).from(folders)
          .where(eq(folders.userId, userId)).orderBy(asc(folders.position), asc(folders.id));
        const pair = adjacent(rows, folderId, input.direction);
        if (pair) {
          const [moving, neighbor] = pair;
          await tx.update(folders).set({ position: neighbor.position }).where(owned);
          await tx.update(folders).set({ position: moving.position }).where(and(eq(folders.userId, userId), eq(folders.id, neighbor.id)));
        }
        break;
      }
      case "reorder-session": {
        const rows = await tx.select({ id: memberships.studySessionId, position: memberships.position }).from(memberships)
          .where(members).orderBy(asc(memberships.position), asc(memberships.studySessionId));
        const pair = adjacent(rows, input.sessionId, input.direction);
        if (pair) {
          const [moving, neighbor] = pair;
          await tx.update(memberships).set({ position: neighbor.position }).where(and(members, eq(memberships.studySessionId, moving.id)));
          await tx.update(memberships).set({ position: moving.position }).where(and(members, eq(memberships.studySessionId, neighbor.id)));
          await touch(tx, userId, [folderId]);
        }
        break;
      }
      case "reorder-resource": {
        const rows = await tx.select({ id: savedResources.resourceId, position: savedResources.position }).from(savedResources)
          .where(saved).orderBy(asc(savedResources.position), asc(savedResources.resourceId));
        const pair = adjacent(rows, input.resourceId, input.direction);
        if (pair) {
          const [moving, neighbor] = pair;
          await tx.update(savedResources).set({ position: neighbor.position }).where(and(saved, eq(savedResources.resourceId, moving.id)));
          await tx.update(savedResources).set({ position: moving.position }).where(and(saved, eq(savedResources.resourceId, neighbor.id)));
          await touch(tx, userId, [folderId]);
        }
        break;
      }
    }
    return null;
  });
  if (result) await invalidateHomeFeedCache(userId);
  return result;
}

export function folderSessionCandidates(userId: string, folderId: string, query: string) {
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return withUserTransaction(userId, async (tx) => {
    await ownedFolder(tx, userId, folderId);
    return Array.from(await tx.execute<{ id: string; title: string; type: "paper" | "video" | null; status: string; folderId: string | null; folderTitle: string | null }>(sql`
      SELECT s.id, coalesce(s.title, r.title, 'Study session') AS title,
        CASE WHEN r.type IN ('paper', 'pdf') THEN 'paper' WHEN r.type = 'video' THEN 'video' END AS type,
        s.status, f.id AS "folderId", f.title AS "folderTitle"
      FROM study.study_sessions s
      LEFT JOIN catalog.resources r ON r.id = s.active_resource_id AND r.deleted_at IS NULL
      LEFT JOIN study.session_folder_memberships m ON m.study_session_id = s.id AND m.user_id = s.user_id
      LEFT JOIN study.session_folders f ON f.id = m.folder_id AND f.user_id = m.user_id
      WHERE s.user_id = ${userId} AND s.metadata->>'folderWorkspace' IS DISTINCT FROM 'true' AND m.folder_id IS DISTINCT FROM ${folderId}::uuid
        AND (s.title ILIKE ${pattern} OR r.title ILIKE ${pattern} OR ${query} = '')
      ORDER BY s.last_active_at DESC, s.id LIMIT 25
    `));
  });
}

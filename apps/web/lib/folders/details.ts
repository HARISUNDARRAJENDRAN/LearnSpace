import { type Transaction, withUserTransaction } from "@learnspace/db";
import { studySessions } from "@learnspace/db/schema";
import { sql } from "drizzle-orm";
import { ownedFolder } from "./service";

export type FolderMaterial = {
  id: string;
  title: string;
  type: "paper" | "video";
  versionId: string | null;
  parser: string | null;
  state: "ready" | "preparing" | "unavailable";
  durationMs: number | null;
  thumbnailUrl: string | null;
  sessionId: string | null;
  active: boolean;
  saved: boolean;
  progress: number;
};

/** The ordered union of saved material and material from sessions filed in the folder. */
export function folderMaterials(tx: Transaction, userId: string, folderId: string) {
  return tx.execute<FolderMaterial>(sql`
    WITH members AS (
      SELECT sr.resource_id, m.study_session_id, s.active_resource_id = sr.resource_id AS active,
        m.position AS session_position, sr.position AS resource_position
      FROM study.session_folder_memberships m
      JOIN study.study_sessions s ON s.id = m.study_session_id
      JOIN study.session_resources sr ON sr.study_session_id = s.id
      WHERE m.user_id = ${userId} AND m.folder_id = ${folderId} AND s.status <> 'abandoned'
    ), links AS (
      SELECT DISTINCT ON (resource_id) resource_id, study_session_id, active, session_position, resource_position
      FROM members ORDER BY resource_id, active DESC NULLS LAST, session_position, resource_position, study_session_id
    ), saved AS (
      SELECT resource_id, position FROM study.session_folder_resources WHERE user_id = ${userId} AND folder_id = ${folderId}
    )
    SELECT r.id, r.title, CASE WHEN r.type = 'video' THEN 'video' ELSE 'paper' END AS type,
      CASE WHEN v.processing_status = 'ready' THEN v.id END AS "versionId",
      v.parser_name AS parser, vd.duration_ms AS "durationMs", CASE WHEN vd.youtube_id ~ '^[A-Za-z0-9_-]{11}$' THEN 'https://i.ytimg.com/vi/' || vd.youtube_id || '/hqdefault.jpg' END AS "thumbnailUrl",
      CASE WHEN v.processing_status = 'ready' THEN 'ready'
        WHEN r.status IN ('failed', 'archived') OR tr.status IN ('unavailable', 'failed') THEN 'unavailable'
        ELSE 'preparing' END AS state,
      links.study_session_id AS "sessionId", coalesce(links.active, false) AS active,
      saved.resource_id IS NOT NULL AS saved, coalesce(p.progress_pct, 0)::float AS progress
    FROM links FULL JOIN saved USING (resource_id)
    JOIN catalog.resources r ON r.id = coalesce(links.resource_id, saved.resource_id)
    LEFT JOIN catalog.resource_versions v ON v.id = r.current_version_id
    LEFT JOIN catalog.video_details vd ON vd.resource_id = r.id
    LEFT JOIN ops.transcript_requests tr ON tr.resource_id = r.id
    LEFT JOIN study.user_resource_progress p ON p.resource_id = r.id AND p.user_id = ${userId}
    WHERE r.deleted_at IS NULL AND r.type IN ('paper', 'pdf', 'video')
    ORDER BY links.session_position NULLS LAST, links.resource_position NULLS LAST, saved.position NULLS LAST, r.id
  `);
}

export async function folderStudySession(tx: Transaction, userId: string, folderId: string) {
  const folder = await ownedFolder(tx, userId, folderId);
  await tx.insert(studySessions).values({ id: folder.id, userId, mode: "guided_learning", metadata: { folderWorkspace: true } }).onConflictDoNothing();
  return folder;
}

export function getSessionFolderDetails(userId: string, folderId: string) {
  return withUserTransaction(userId, async (tx) => {
    const [folder, materials] = await Promise.all([ownedFolder(tx, userId, folderId), folderMaterials(tx, userId, folderId)]);
    return { id: folder.id, title: folder.title, description: folder.description, materials: Array.from(materials) };
  });
}

export type SessionFolderDetails = Awaited<ReturnType<typeof getSessionFolderDetails>>;

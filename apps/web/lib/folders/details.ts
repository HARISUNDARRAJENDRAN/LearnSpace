import { withUserTransaction } from "@learnspace/db";
import type { SessionFolderDetailsQuery, StudySessionSummary } from "@learnspace/shared";
import { sql } from "drizzle-orm";
import { ownedFolder } from "./service";

const PAGE_SIZE = 20;

type FolderLesson = {
  id: string;
  type: "paper" | "video" | null;
  title: string;
  available: boolean;
  progressPct: number;
  anchor: { kind: "paper"; page?: number } | { kind: "video"; positionMs: number } | null;
  notePreview: string | null;
  hasNotes: boolean;
  hasGuide: boolean;
  hasExercises: boolean;
  hasVoice: boolean;
  threads: Array<{ id: string; startedAt: string; title: string | null }>;
};

type FolderSessionRow = {
  id: string;
  title: string;
  status: StudySessionSummary["status"];
  lastActiveAt: string;
  activeResourceId: string | null;
  hasCode: boolean;
  lessons: FolderLesson[];
};

type SavedFolderResource = {
  id: string;
  title: string;
  type: FolderLesson["type"];
  available: boolean;
  addedAt: string;
  hasNotes: boolean;
  notePreview: string | null;
};

export function getSessionFolderDetails(userId: string, folderId: string, { section, page }: SessionFolderDetailsQuery) {
  return withUserTransaction(userId, async (tx) => {
    const { id, title, description, updatedAt } = await ownedFolder(tx, userId, folderId);
    const offset = (page - 1) * PAGE_SIZE;
    const type = section === "papers" ? sql`r.type IN ('paper', 'pdf')` : sql`r.type = 'video'`;
    const hasChat = sql`EXISTS (SELECT 1 FROM study.tutor_messages tm WHERE tm.thread_id = t.id AND tm.status = 'completed' AND tm.content_text <> '')`;
    const hasVoice = sql`EXISTS (SELECT 1 FROM study.session_transcript st WHERE st.study_session_id = s.id AND st.resource_id = sr.resource_id AND st.user_id = s.user_id)`;
    const hasThreads = sql`EXISTS (SELECT 1 FROM study.tutor_threads t WHERE t.study_session_id = s.id AND t.resource_id = sr.resource_id AND t.user_id = s.user_id AND ${hasChat})`;
    const workspaceHasCode = sql`coalesce(btrim(s.workspace->'code'->>'code') <> '', false)`;
    const typeLabel = sql`CASE WHEN r.type IN ('paper', 'pdf') THEN 'paper' WHEN r.type = 'video' THEN 'video' END`;
    const hasGuide = sql`coalesce(g.guide_status = 'ready' AND g.guide IS NOT NULL, false)`;
    const hasExercises = sql`EXISTS (SELECT 1 FROM practice.coding_attempts ca WHERE ca.user_id = s.user_id AND ca.resource_id = sr.resource_id AND ca.study_session_id = s.id)`;
    const hasNotes = sql`coalesce(jsonb_array_length(n.blocks) > 0, false)`;
    const available = sql`coalesce(r.status IN ('pending', 'processing', 'ready'), false)`;
    const lessonFilter = section === "papers" || section === "videos" ? type
      : section === "threads" ? sql`(${hasThreads} OR ${hasVoice})`
      : section === "notes" ? sql`(${hasNotes} OR ${hasGuide})`
      : section === "artifacts" ? sql`${hasGuide} OR ${hasExercises} OR ${hasVoice}`
      : null;
    const lessonJoins = sql`
      FROM study.session_resources sr
      LEFT JOIN catalog.resources r ON r.id = sr.resource_id AND r.deleted_at IS NULL
      LEFT JOIN study.video_notes n ON n.resource_id = sr.resource_id AND n.user_id = s.user_id
      LEFT JOIN practice.paper_coding_profiles g ON g.resource_version_id = sr.resource_version_id AND g.resource_id = r.id
      WHERE sr.study_session_id = s.id`;
    const [counts, sessionRows, resourceRows] = await Promise.all([
      tx.execute<{ sessions: number; papers: number; videos: number }>(sql`
        WITH members AS (
          SELECT study_session_id FROM study.session_folder_memberships WHERE user_id = ${userId} AND folder_id = ${folderId}
        ), folder_resources AS (
          SELECT resource_id FROM study.session_resources JOIN members USING (study_session_id)
          UNION
          SELECT resource_id FROM study.session_folder_resources WHERE user_id = ${userId} AND folder_id = ${folderId}
        )
        SELECT (SELECT count(*)::int FROM members) AS sessions,
          count(*) FILTER (WHERE r.type IN ('paper', 'pdf'))::int AS papers,
          count(*) FILTER (WHERE r.type = 'video')::int AS videos
        FROM folder_resources fr JOIN catalog.resources r ON r.id = fr.resource_id AND r.deleted_at IS NULL
      `),
      tx.execute<FolderSessionRow>(sql`
        SELECT s.id, coalesce(s.title, active.title, 'Study session') AS title, s.status,
          s.last_active_at::text AS "lastActiveAt", s.active_resource_id AS "activeResourceId", ${workspaceHasCode} AS "hasCode",
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', sr.resource_id, 'type', ${typeLabel}, 'title', coalesce(r.title, 'Unavailable material'),
              'available', ${available}, 'anchor', sr.last_anchor,
              'progressPct', coalesce((SELECT p.progress_pct FROM study.user_resource_progress p
                WHERE p.user_id = s.user_id AND p.resource_id = sr.resource_id), 0),
              'hasNotes', ${hasNotes}, 'hasGuide', ${hasGuide}, 'hasExercises', ${hasExercises}, 'notePreview', left(n.blocks->0->>'text', 220), 'hasVoice', ${hasVoice},
              'threads', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'startedAt', t.started_at,
                'title', (SELECT left(tm.content_text, 120) FROM study.tutor_messages tm WHERE tm.thread_id = t.id AND tm.actor_type = 'user' ORDER BY tm.created_at, tm.id LIMIT 1)) ORDER BY t.started_at, t.id)
                FROM study.tutor_threads t
                WHERE t.study_session_id = s.id AND t.resource_id = sr.resource_id AND t.user_id = s.user_id AND ${hasChat}), '[]'::jsonb)
            ) ORDER BY sr.position)
            ${lessonJoins}
          ), '[]'::jsonb) AS lessons
        FROM study.session_folder_memberships m
        JOIN study.study_sessions s ON s.id = m.study_session_id AND s.user_id = m.user_id
        LEFT JOIN catalog.resources active ON active.id = s.active_resource_id AND active.deleted_at IS NULL
        WHERE m.user_id = ${userId} AND m.folder_id = ${folderId}
        ${lessonFilter ? sql`AND (EXISTS (SELECT 1 ${lessonJoins} AND (${lessonFilter})) ${section === "artifacts" ? sql`OR ${workspaceHasCode}` : sql``})` : sql``}
        ORDER BY m.position, m.study_session_id
        LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
      `),
      section === "threads" || section === "artifacts" ? [] : tx.execute<SavedFolderResource>(sql`
        SELECT fr.resource_id AS id, coalesce(r.title, 'Unavailable material') AS title, ${typeLabel} AS type,
          ${available} AS available, fr.added_at::text AS "addedAt", ${hasNotes} AS "hasNotes", left(n.blocks->0->>'text', 220) AS "notePreview"
        FROM study.session_folder_resources fr
        LEFT JOIN catalog.resources r ON r.id = fr.resource_id AND r.deleted_at IS NULL
        LEFT JOIN study.video_notes n ON n.resource_id = fr.resource_id AND n.user_id = fr.user_id
        WHERE fr.user_id = ${userId} AND fr.folder_id = ${folderId}
          AND NOT EXISTS (
            SELECT 1 FROM study.session_folder_memberships m JOIN study.session_resources sr USING (study_session_id)
            WHERE m.user_id = fr.user_id AND m.folder_id = fr.folder_id AND sr.resource_id = fr.resource_id
          )
          ${section === "papers" || section === "videos" ? sql`AND ${type}` : section === "notes" ? sql`AND ${hasNotes}` : sql``}
        ORDER BY fr.position, fr.resource_id LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
      `),
    ]);
    return {
      id, title, description, updatedAt: updatedAt.toISOString(), counts: counts[0] ?? { sessions: 0, papers: 0, videos: 0 },
      sessions: Array.from(sessionRows).slice(0, PAGE_SIZE), resources: Array.from(resourceRows).slice(0, PAGE_SIZE),
      hasMore: sessionRows.length > PAGE_SIZE || resourceRows.length > PAGE_SIZE,
    };
  });
}

export type SessionFolderDetails = Awaited<ReturnType<typeof getSessionFolderDetails>>;

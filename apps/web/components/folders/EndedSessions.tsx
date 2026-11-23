"use client";

import type { StudySessionSummary } from "@learnspace/shared";
import { FileText, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { sessionMatchesMode } from "../application/SidebarSessions";
import { SessionFolder } from "../library/LibraryPage";
import { MoveSessionDialog } from "./FolderDialogs";
import { folderRequest, useSessionFolders } from "./state";

export function EndedSessions({ mode }: { mode: "learn" | "research" }) {
  const { folderBySession } = useSessionFolders();
  const [rows, setRows] = useState<StudySessionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(12);
  const [history, setHistory] = useState<StudySessionSummary | null>(null);
  const [moving, setMoving] = useState<StudySessionSummary | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter invalidates the same request.
  useEffect(() => {
    const controller = new AbortController();
    void folderRequest<{ sessions: StudySessionSummary[] }>("/api/v1/study-sessions?shelf=ended", { signal: controller.signal }).then(
      (result) => { if (!controller.signal.aborted) { setRows(result.sessions); setFailed(false); } },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [attempt]);

  const ended = rows?.filter((session) => !folderBySession.has(session.id) && (sessionMatchesMode(session, mode) || !session.activeResource));
  if (failed) return <p role="alert">Ended sessions could not be loaded. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></p>;
  if (!ended) return <p role="status">Loading ended sessions…</p>;
  if (!ended.length) return <p>No unfiled ended sessions. Completed sessions are in your Library.</p>;

  return <>
    <ul className="session-folder-list">{ended.slice(0, limit).map((session) => {
      const Icon = session.activeResource?.type === "paper" ? FileText : Video;
      return <li className="session-folder-row" key={session.id}><Icon aria-hidden="true" />
        <div><strong>{session.title}</strong><small>Ended</small></div>
        <div className="session-folder-item-actions">
          <button type="button" aria-label={`View history for ${session.title}`} onClick={() => setHistory(session)}>History</button>
          <button type="button" aria-label={`Move ${session.title} to folder`} onClick={() => setMoving(session)}>Move to folder</button>
        </div>
      </li>;
    })}</ul>
    {ended.length > limit ? <button className="session-folder-button" type="button" onClick={() => setLimit((value) => value + 12)}>Show more</button> : null}
    {history ? <SessionFolder session={{ ...history, route: null }} endpoint={`/api/v1/study-sessions/${history.id}/history`} onClose={() => setHistory(null)} /> : null}
    {moving ? <MoveSessionDialog session={moving} onClose={() => setMoving(null)} /> : null}
  </>;
}

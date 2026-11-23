"use client";

import { ArrowDown, ArrowRight, FileText, FolderClosed, MoreHorizontal, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { lazy, Suspense, useState } from "react";
import type { StudySessionSummary } from "@learnspace/shared";
import { useSessions, lastSeenRoute } from "../application/sessions";
import { sessionMatchesMode } from "../application/SidebarSessions";
import { FolderEditor, FolderOptions, MoveSessionDialog } from "./FolderDialogs";
import { folderHref, folderSessionHref, useSessionFolders } from "./state";

const EndedSessions = lazy(() => import("./EndedSessions").then(({ EndedSessions }) => ({ default: EndedSessions })));

export function SessionsDashboard({ mode }: { mode: "learn" | "research" }) {
  const { sessions } = useSessions();
  const { folders, folderBySession, loading, failed, refresh } = useSessionFolders();
  const router = useRouter();
  const [create, setCreate] = useState(false);
  const [options, setOptions] = useState<(typeof folders)[number] | null>(null);
  const [moving, setMoving] = useState<StudySessionSummary | null>(null);
  const [limit, setLimit] = useState(12);
  const [showEnded, setShowEnded] = useState(false);
  const inMode = sessions.filter((session) => sessionMatchesMode(session, mode));
  const unfiled = inMode.filter((session) => !folderBySession.has(session.id));
  const recent = sessions.filter((session) => session.route).toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)).slice(0, 5);
  const latestRoute = lastSeenRoute(inMode) ?? lastSeenRoute(sessions);
  const latest = sessions.find((session) => session.route === latestRoute);
  const start = mode === "research" ? "/app/research" : "/app/discover";
  const startLabel = mode === "research" ? "Find a paper" : "Find a lesson";
  function href(session: StudySessionSummary) {
    const folder = folderBySession.get(session.id);
    return session.route && folder ? folderSessionHref(session.route, folder, mode) : session.route;
  }

  function renderRow(session: StudySessionSummary) {
    const Icon = session.activeResource?.type === "paper" ? FileText : Video;
    const url = href(session);
    return <li className="session-folder-row" key={session.id}><Icon aria-hidden="true" />
      <div>{url ? <Link href={url} prefetch={false}>{session.title}</Link> : <strong>{session.title}</strong>}
        <small>{session.activeResource?.type === "paper" ? "Paper" : session.isCourse ? "Playlist" : "Video"} · {Math.round(session.progressPct)}% · {session.status}</small></div>
      <button className="session-folder-icon" type="button" aria-label={`Move ${session.title} to folder`} onClick={() => setMoving(session)}><MoreHorizontal aria-hidden="true" /></button>
    </li>;
  }

  return <main className="session-folders-page" aria-labelledby="session-folders-title">
    <header className="session-folder-heading">
      <div><h1 id="session-folders-title">Sessions</h1><p>Keep related papers, lessons, and study history together.</p></div>
      <div className="session-folder-actions">
        {latest && href(latest) ? <Link className="session-folder-button" href={href(latest)!} prefetch={false}>Continue last session <ArrowRight aria-hidden="true" /></Link> : null}
        <button type="button" className="is-primary" onClick={() => setCreate(true)}><Plus aria-hidden="true" />New folder</button>
      </div>
    </header>
    <section className="session-folder-section" aria-labelledby="session-folders-list">
      <h2 id="session-folders-list">Folders</h2>
      {loading ? <p role="status">Loading folders…</p> : failed ? <p role="alert">Folders could not be loaded. <button type="button" onClick={() => void refresh()}>Retry</button></p> : null}
      {folders.length ? <ul className="session-folder-grid">
        {folders.map((folder) => <li key={folder.id}>
          <Link href={folderHref(folder.id, mode)}><FolderClosed aria-hidden="true" /><strong>{folder.title}</strong>
            <small>{folder.sessionIds.length} {folder.sessionIds.length === 1 ? "session" : "sessions"}</small>
            {folder.description ? <p>{folder.description}</p> : null}
          </Link>
          <button className="session-folder-icon" type="button" aria-label={`Folder options for ${folder.title}`} onClick={() => setOptions(folder)}><MoreHorizontal aria-hidden="true" /></button>
        </li>)}
      </ul> : !loading && !failed ? <div className="session-folder-empty"><FolderClosed aria-hidden="true" /><p>Start a folder for your next research or learning project.</p><button type="button" onClick={() => setCreate(true)}>Create your first folder</button></div> : null}
    </section>
    <section className="session-folder-section" aria-labelledby="session-unfiled">
      <h2 id="session-unfiled">Unfiled sessions</h2>
      {unfiled.length ? <><ul className="session-folder-list">{unfiled.slice(0, limit).map(renderRow)}</ul>
        {unfiled.length > limit ? <button className="session-folder-button" type="button" onClick={() => setLimit((size) => size + 12)}>Show more <ArrowDown aria-hidden="true" /></button> : null}
      </> : <div className="session-folder-empty"><p>No unfiled {mode === "research" ? "paper" : "video"} sessions.</p><Link href={start}>{startLabel}</Link></div>}
    </section>
    <details className="session-folder-section session-ended-section" onToggle={(event) => setShowEnded(event.currentTarget.open)}>
      <summary>Ended sessions</summary>
      {showEnded ? <Suspense fallback={<p role="status">Loading ended sessions…</p>}><EndedSessions mode={mode} /></Suspense> : null}
    </details>
    {recent.length ? <section className="session-folder-section" aria-labelledby="session-recent">
      <h2 id="session-recent">Recent sessions</h2>
      <ul className="session-folder-list">{recent.map(renderRow)}</ul>
    </section> : null}
    {create ? <FolderEditor onClose={() => setCreate(false)} onSaved={(id) => router.push(folderHref(id, mode))} /> : null}
    {options ? <FolderOptions folder={options} onClose={() => setOptions(null)} /> : null}
    {moving ? <MoveSessionDialog session={moving} onClose={() => setMoving(null)} /> : null}
  </main>;
}

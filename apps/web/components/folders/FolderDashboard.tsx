"use client";

import type { ChangeSessionFolder, SessionFolderDetailsQuery, StartStudySessionResponse } from "@learnspace/shared";
import { ArrowLeft, ArrowRight, Code2, FileText, FolderClosed, MessageSquare, Mic, MoreHorizontal, NotebookPen, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SessionFolderDetails } from "../../lib/folders/details";
import { sessionsHref, useSessions } from "../application/sessions";
import { SessionFolder, type SessionHistoryTab } from "../library/LibraryPage";
import { AddFolderContent } from "./AddFolderContent";
import { FolderDialog, FolderOptions, MoveSessionDialog, SessionFolderItemOptions } from "./FolderDialogs";
import { folderHref, folderRequest, FolderRequestError, folderSessionHref, useSessionFolders } from "./state";

type Mode = "learn" | "research";
type Session = SessionFolderDetails["sessions"][number];
type Lesson = Session["lessons"][number];
type Saved = SessionFolderDetails["resources"][number];
type History = { session: Session; lesson?: Lesson; tab: SessionHistoryTab; conversation?: string };
type Section = SessionFolderDetailsQuery["section"];
const sections: { id: Section; label: string; empty: string }[] = [
  { id: "overview", label: "Overview", empty: "This folder is empty. Add sessions or save papers and videos to study later." },
  { id: "papers", label: "Papers", empty: "No papers in this folder yet." },
  { id: "videos", label: "Videos", empty: "No videos in this folder yet." },
  { id: "threads", label: "AI threads", empty: "No conversations saved here yet. Open a session to ask the AI tutor or talk through your notes." },
  { id: "notes", label: "Notes & guides", empty: "No saved notes here yet. Open Notes in a session to start writing." },
  { id: "artifacts", label: "Other artifacts", empty: "No code drafts, voice transcripts, or paper guides to show." },
];
const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const statusLabels: Record<Session["status"], string> = { active: "In progress", paused: "Paused", completed: "Completed", abandoned: "Ended" };

function studyRoute(session: Session, lesson = session.lessons.find((item) => item.id === session.activeResourceId)) {
  return session.status !== "abandoned" && lesson?.available && lesson.type ? `/app/study/${lesson.type}/${session.id}` : null;
}

function showLesson(lesson: Lesson, section: Section) {
  if (section === "papers") return lesson.type === "paper";
  if (section === "videos") return lesson.type === "video";
  if (section === "threads") return lesson.threads.length > 0 || lesson.hasVoice;
  if (section === "notes") return lesson.hasNotes || lesson.hasGuide;
  if (section === "artifacts") return lesson.hasGuide || lesson.hasExercises || lesson.hasVoice;
  return true;
}

function position(lesson: Lesson) {
  if (lesson.anchor?.kind === "paper" && lesson.anchor.page) return `Page ${lesson.anchor.page}`;
  if (lesson.anchor?.kind === "video" && lesson.anchor.positionMs > 0) {
    const seconds = Math.floor(lesson.anchor.positionMs / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return null;
}

export function FolderDashboard({ folderId, mode, query }: { folderId: string; mode: Mode; query: SessionFolderDetailsQuery }) {
  const router = useRouter();
  const { refresh: refreshSessions } = useSessions();
  const { change, pending, revision, folders } = useSessionFolders();
  const [view, setView] = useState<{ url: string; data?: SessionFolderDetails; error?: FolderRequestError } | null>(null);
  const [add, setAdd] = useState(false);
  const [options, setOptions] = useState(false);
  const [itemOptions, setItemOptions] = useState<{ id: string; title: string; kind: "session" | "resource" } | null>(null);
  const [move, setMove] = useState<Session | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [conflict, setConflict] = useState<{ item: Saved; message: string; folderId: string; sessionId: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const openGuard = useRef(false);
  const startKeys = useRef(new Map<string, string>());
  const folderUrl = folderHref(folderId, mode);
  const endpoint = `/api/v1/session-folders/${folderId}`;
  const url = `${endpoint}?section=${query.section}&page=${query.page}`;
  const selectedSection = sections.find((section) => section.id === query.section);
  const data = view?.url === url ? view.data : undefined;
  const loadError = view?.url === url ? view.error : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision and retry counter invalidate the same URL.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void folderRequest<SessionFolderDetails>(url, { signal: controller.signal }).then(
        (data) => { if (!controller.signal.aborted) setView({ url, data }); },
        (cause) => {
          if (!controller.signal.aborted) setView({ url, error: cause instanceof FolderRequestError ? cause : new FolderRequestError(500, {}) });
        },
      );
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [url, revision, attempt]);

  function pageHref(section: Section, page = 1) {
    const params = new URLSearchParams(mode === "research" ? { mode } : {});
    if (section !== "overview") params.set("section", section);
    if (page !== 1) params.set("page", String(page));
    return `/app/sessions/folders/${folderId}${params.size ? `?${params}` : ""}`;
  }

  async function run(action: () => Promise<unknown>, onSuccess?: () => void) {
    setError("");
    try { await action(); onSuccess?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The folder could not be updated."); }
  }

  async function start(item: Saved, moveFrom?: { folderId: string; sessionId: string }) {
    if (openGuard.current) return;
    openGuard.current = true;
    setOpening(true);
    setError("");
    const idempotencyKey = startKeys.current.get(item.id) ?? crypto.randomUUID();
    startKeys.current.set(item.id, idempotencyKey);
    try {
      const result = await change(folderId, { action: "start-resource", resourceId: item.id, idempotencyKey, ...(moveFrom ? { moveFrom } : {}) });
      if (!result) throw new Error("The session could not be started.");
      startKeys.current.delete(item.id);
      setConflict(null);
      void refreshSessions();
      router.push(folderSessionHref(result.route, folderId, mode));
    } catch (cause) {
      const info = cause instanceof FolderRequestError && cause.info.code === "FOLDER_MEMBERSHIP_CHANGED" ? cause.info : null;
      if (info?.folderId && info.sessionId) setConflict({ item, message: cause instanceof Error ? cause.message : "", folderId: info.folderId, sessionId: info.sessionId });
      else {
        setConflict(null);
        setError(cause instanceof Error ? cause.message : "The session could not be started.");
      }
    } finally { openGuard.current = false; setOpening(false); }
  }

  async function openTool(session: Session, lesson: Lesson, tool: string, threadId?: string) {
    const route = studyRoute(session, lesson);
    if (!route || openGuard.current) return;
    openGuard.current = true;
    setOpening(true);
    await run(async () => {
      let destination = route;
      if (lesson.id !== session.activeResourceId) {
        const result = await folderRequest<StartStudySessionResponse>(`/api/v1/study-sessions/${session.id}/resources`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceId: lesson.id, idempotencyKey: crypto.randomUUID() }),
        });
        destination = result.route;
      }
      if (threadId) await folderRequest(`/api/v1/study-sessions/${session.id}/tutor`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", threadId }),
      });
      setHistory(null);
      router.push(folderSessionHref(destination, folderId, mode, tool));
    });
    openGuard.current = false;
    setOpening(false);
  }

  function renderSession(session: Session) {
    const active = session.lessons.find((lesson) => lesson.id === session.activeResourceId);
    const Icon = active?.type === "paper" ? FileText : active?.type === "video" ? Video : FolderClosed;
    const route = studyRoute(session);
    const canSwitch = session.status === "active" || session.status === "paused";
    return <li key={session.id} className="session-folder-entry">
      <div className="session-folder-row">
        <Icon aria-hidden="true" />
        <div><strong>{session.title}</strong><small>{statusLabels[session.status]} · {date.format(new Date(session.lastActiveAt))}</small></div>
        <div className="session-folder-item-actions">
          {route ? <Link className="session-folder-button" href={folderSessionHref(route, folderId, mode)} prefetch={false}>{canSwitch ? "Continue" : "Open"}</Link> : null}
          <button type="button" onClick={() => setHistory({ session, tab: "notes" })}>History</button>
          <button className="session-folder-icon" type="button" aria-label={`Options for ${session.title}`} onClick={() => setItemOptions({ id: session.id, title: session.title, kind: "session" })}><MoreHorizontal aria-hidden="true" /></button>
        </div>
      </div>
      <ul className="session-folder-lessons">
        {session.lessons.filter((lesson) => showLesson(lesson, query.section)).map((lesson) => {
          const LessonIcon = lesson.type === "paper" ? FileText : lesson.type === "video" ? Video : FolderClosed;
          const place = position(lesson);
          const materialRoute = studyRoute(session, lesson);
          const showTools = canSwitch || lesson.id === session.activeResourceId;
          return <li key={lesson.id}>
            <div className="session-folder-lesson-name"><LessonIcon aria-hidden="true" />
              {session.lessons.length > 1 || lesson.title !== session.title ? <span>{lesson.title}</span> : null}
              <small>{lesson.type === "paper" ? "Paper" : lesson.type === "video" ? "Video" : "Material"} · {lesson.available ? `${Math.round(lesson.progressPct)}%${place ? ` · ${place}` : ""}` : "Unavailable"}</small>
            </div>
            {query.section === "notes" && lesson.notePreview ? <p className="session-folder-note-preview">{lesson.notePreview}</p> : null}
            <div className="session-folder-links">
              {query.section === "overview" && lesson.id !== session.activeResourceId && canSwitch && materialRoute ?
                <button type="button" disabled={opening} onClick={() => void openTool(session, lesson, "canvas")}>Open material</button> : null}
              {lesson.hasNotes && (query.section === "overview" || query.section === "notes") ?
                <button type="button" onClick={() => setHistory({ session, lesson, tab: "notes" })}><NotebookPen aria-hidden="true" />Preview notes</button> : null}
              {query.section === "notes" && showTools && materialRoute ?
                <button type="button" disabled={opening} onClick={() => void openTool(session, lesson, "notes")}>Open Notes</button> : null}
              {lesson.hasGuide && (query.section === "overview" || query.section === "notes" || query.section === "artifacts") ?
                <button type="button" onClick={() => setHistory({ session, lesson, tab: "guide" })}><FileText aria-hidden="true" />Project guide</button> : null}
              {lesson.hasExercises && (query.section === "overview" || query.section === "artifacts") ?
                <button type="button" onClick={() => setHistory({ session, lesson, tab: "code" })}><Code2 aria-hidden="true" />Code exercises</button> : null}
              {query.section === "threads" ? lesson.threads.map((thread) => <button key={thread.id} type="button" onClick={() => setHistory({ session, lesson, tab: "chats", conversation: thread.id })}><MessageSquare aria-hidden="true" />{thread.title || `AI thread · ${date.format(new Date(thread.startedAt))}`}</button>)
                : query.section === "overview" && lesson.threads.length ? <button type="button" onClick={() => setHistory({ session, lesson, tab: "chats" })}><MessageSquare aria-hidden="true" />{lesson.threads.length} AI {lesson.threads.length === 1 ? "thread" : "threads"}</button> : null}
              {lesson.hasVoice && (query.section === "overview" || query.section === "threads" || query.section === "artifacts") ?
                <button type="button" onClick={() => setHistory({ session, lesson, tab: "chats", conversation: "voice" })}><Mic aria-hidden="true" />Voice transcript</button> : null}
            </div>
          </li>;
        })}
      </ul>
      {session.hasCode && (query.section === "overview" || query.section === "artifacts") ?
        <div className="session-folder-links session-folder-code"><button type="button" onClick={() => setHistory({ session, tab: "code" })}><Code2 aria-hidden="true" />Code draft</button></div> : null}
    </li>;
  }

  const activeHistory = history?.session.lessons.find((item) => item.id === history.session.activeResourceId);
  return <main className="session-folders-page" aria-labelledby="folder-title">
    <Link href={sessionsHref(mode)} className="session-folder-back"><ArrowLeft aria-hidden="true" />Sessions</Link>
    {loadError ? <div className="session-folder-empty">
      <h1 id="folder-title">{loadError.status === 404 ? "Folder unavailable" : "Could not open folder"}</h1>
      <p role="alert">{loadError.message}</p>
      {loadError.status !== 404 ? <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button> : null}
    </div> : !data ? <h1 id="folder-title" role="status">Opening folder…</h1> : <>
      <header className="session-folder-heading">
        <div><h1 id="folder-title">{data.title}</h1>{data.description ? <p>{data.description}</p> : null}
          <p className="session-folder-meta">{data.counts.papers} {data.counts.papers === 1 ? "paper" : "papers"} · {data.counts.videos} {data.counts.videos === 1 ? "video" : "videos"} · {data.counts.sessions} {data.counts.sessions === 1 ? "session" : "sessions"} · Updated {date.format(new Date(data.updatedAt))}</p>
        </div>
        <div className="session-folder-actions">
          <button className="is-primary" type="button" onClick={() => setAdd(true)}><Plus aria-hidden="true" />Add content</button>
          <button className="session-folder-icon" type="button" aria-label="Folder options" onClick={() => setOptions(true)}><MoreHorizontal aria-hidden="true" /></button>
        </div>
      </header>
      <nav className="session-folder-tabs" aria-label="Folder sections">
        {sections.map((section) => <Link key={section.id} aria-current={section.id === query.section ? "page" : undefined} href={pageHref(section.id)} scroll={false}>{section.label}</Link>)}
      </nav>
      {error && !itemOptions && !history ? <p className="session-folder-error" role="alert">{error}</p> : null}
      {data.sessions.length || data.resources.length ? <>
        {data.sessions.length ? <section className="session-folder-section" aria-labelledby="folder-sessions">
          <h2 id="folder-sessions">{query.section === "overview" ? "Study sessions" : selectedSection?.label}</h2>
          <ul className="session-folder-list">{data.sessions.map(renderSession)}</ul>
        </section> : null}
        {data.resources.length ? <section className="session-folder-section" aria-labelledby="folder-saved">
          <h2 id="folder-saved">Saved material</h2>
          <ul className="session-folder-list">{data.resources.map((item) => {
            const Icon = item.type === "paper" ? FileText : item.type === "video" ? Video : FolderClosed;
            return <li className="session-folder-row" key={item.id}><Icon aria-hidden="true" />
              <div><strong>{item.title}</strong><small>{item.type === "paper" ? "Paper" : item.type === "video" ? "Video" : "Material"} · {item.available ? `Saved ${date.format(new Date(item.addedAt))}` : "Unavailable"}</small>
                {query.section === "notes" && item.notePreview ? <p className="session-folder-note-preview">{item.notePreview}</p> : null}
              </div>
              <div className="session-folder-item-actions">
                {item.available ? <button type="button" disabled={pending || opening} onClick={() => void start(item)}>Start or resume</button> : null}
                <button type="button" className="session-folder-icon" aria-label={`Options for ${item.title}`} onClick={() => setItemOptions({ id: item.id, title: item.title, kind: "resource" })}><MoreHorizontal aria-hidden="true" /></button>
              </div>
            </li>;
          })}</ul>
        </section> : null}
      </> : <div className="session-folder-empty">
        <FolderClosed aria-hidden="true" />
        <p>{query.page > 1 ? "No items on this page." : selectedSection?.empty}</p>
        {query.page > 1 ? <Link href={pageHref(query.section)}>Back to first page</Link>
          : query.section === "overview" || query.section === "papers" || query.section === "videos" ? <button type="button" onClick={() => setAdd(true)}>Add content</button>
          : <Link href={folderUrl}>View study sessions</Link>}
      </div>}
      {query.page > 1 || data.hasMore ? <nav className="session-folder-pagination" aria-label="Folder pages">
        {query.page > 1 ? <Link className="session-folder-button" href={pageHref(query.section, query.page - 1)}><ArrowLeft aria-hidden="true" />Previous</Link> : null}
        <span>Page {query.page}</span>
        {data.hasMore ? <Link className="session-folder-button" href={pageHref(query.section, query.page + 1)}>Next<ArrowRight aria-hidden="true" /></Link> : null}
      </nav> : null}
      {options ? <FolderOptions folder={data} onClose={() => setOptions(false)} onDeleted={() => router.push(sessionsHref(mode))} /> : null}
    </>}
    {add ? <AddFolderContent folderId={folderId} onClose={() => setAdd(false)} /> : null}
    {move ? <MoveSessionDialog session={move} onClose={() => setMove(null)} /> : null}
    {itemOptions ? <SessionFolderItemOptions title={itemOptions.title} onClose={() => { setItemOptions(null); setError(""); }}>
      {itemOptions.kind === "session" ? <button type="button" onClick={() => {
        const item = data?.sessions.find((session) => session.id === itemOptions.id);
        if (item) { setItemOptions(null); setMove(item); }
      }}>Move to folder</button> : null}
      {(["up", "down"] as const).map((direction) => {
        const input: ChangeSessionFolder = itemOptions.kind === "session"
          ? { action: "reorder-session", sessionId: itemOptions.id, direction }
          : { action: "reorder-resource", resourceId: itemOptions.id, direction };
        const memberIds = folders.find((folder) => folder.id === folderId)?.sessionIds;
        const memberIndex = memberIds?.indexOf(itemOptions.id) ?? -1;
        const noNeighbor = itemOptions.kind === "session" && memberIndex >= 0 && (direction === "up" ? memberIndex === 0 : memberIndex === (memberIds?.length ?? 0) - 1);
        return <button type="button" key={direction} disabled={pending || noNeighbor} onClick={() => void run(() => change(folderId, input), () => setItemOptions(null))}>Move {direction}</button>;
      })}
      <button type="button" className="is-danger" disabled={pending} onClick={() => void run(() => change(folderId, itemOptions.kind === "session"
        ? { action: "unfile-session", sessionId: itemOptions.id } : { action: "remove-resource", resourceId: itemOptions.id }), () => setItemOptions(null))}>{itemOptions.kind === "session" ? "Unfile session" : "Remove saved material"}</button>
      {error ? <p className="session-folder-error" role="alert">{error}</p> : null}
    </SessionFolderItemOptions> : null}
    {conflict ? <FolderDialog title="Move the existing session?" onClose={() => setConflict(null)}>
      <p>{conflict.message} Move it here to continue from the same place.</p>
      <div className="session-folder-actions"><button type="button" onClick={() => setConflict(null)}>Cancel</button>
        <button className="is-primary" type="button" disabled={pending || opening} onClick={() => void start(conflict.item, { folderId: conflict.folderId, sessionId: conflict.sessionId })}>Move and continue</button></div>
    </FolderDialog> : null}
    {history ? <SessionFolder session={{
      ...history.session,
      isCourse: history.session.lessons.length > 1,
      activeResource: activeHistory?.type ? { id: activeHistory.id, type: activeHistory.type } : null,
      route: null,
    }} endpoint={`${endpoint}/sessions/${history.session.id}`} initialTab={history.tab}
      {...(history.lesson ? { initialLesson: history.lesson.id } : {})}
      {...(history.conversation ? { conversation: history.conversation } : {})}
      onClose={() => { setHistory(null); setError(""); }}
      lessonActions={(resourceId, tab, conversation) => {
        const lesson = history.session.lessons.find((item) => item.id === resourceId);
        const editable = history.session.status === "active" || history.session.status === "paused";
        const isActive = resourceId === history.session.activeResourceId;
        return <>
          {error ? <p className="session-folder-error" role="alert">{error}</p> : null}
          {lesson && studyRoute(history.session, lesson) && (editable || isActive) ?
            <button type="button" className="session-folder-button" disabled={opening} onClick={() => void openTool(history.session, lesson, tab === "chats" ? (conversation === "voice" ? "notes" : "chat") : tab, tab === "chats" && editable && conversation !== "voice" ? conversation : undefined)}>
              {tab === "notes" || conversation === "voice" ? "Open Notes" : tab === "code" ? "Open Code Exercises" : tab === "guide" ? "Open Project Guide" : conversation && editable ? "Continue this thread" : "Open AI Chat"}
            </button> : null}
        </>;
      }}
    /> : null}
  </main>;
}

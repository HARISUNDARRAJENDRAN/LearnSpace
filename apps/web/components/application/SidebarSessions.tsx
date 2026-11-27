"use client";

import type { StudySessionSummary } from "@learnspace/shared";
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, CircleStop, FileText, FolderClosed, Plus, MoreHorizontal, PencilLine, Video } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { useCodingEligibility } from "../coding/useCodingEligibility";
import { FolderEditor, FolderOptions, MoveSessionDialog } from "../folders/FolderDialogs";
import { folderHref, useSessionFolders } from "../folders/state";
import { sessionParts, TOOL_PARAM } from "../study/tools";
import { sessionIdFromPath, sessionsHref, useSessions } from "./sessions";

/** Sessions shown before "Show more"; the open session is always listed. */
const VISIBLE_SESSIONS = 6;
const GROUP_KEY = "learnspace:sidebar-sessions-open";
const EXPANDED_KEY = "learnspace:sidebar-sessions-expanded";

/** Reads the server-provided resource capability; unknown capability stays closed. */
export function sessionPartsFor(session: StudySessionSummary, codingEligible = false) {
  const type = session.activeResource?.type;
  if (type !== "video" && type !== "paper") return [];
  // A project guide is a paper's tool; code appears only where the server says an exercise fits.
  return sessionParts.filter((part) => (part.slug !== "code" || codingEligible) && (part.slug !== "guide" || type === "paper"));
}

export function sessionMatchesMode(session: StudySessionSummary, mode: "learn" | "research"): boolean {
  return session.activeResource?.type === (mode === "research" ? "paper" : "video");
}

export function SessionPartLinks({ session, href, active, activeSlug, open, onPartClick, codingEligible: knownEligibility }: {
  session: StudySessionSummary;
  href: string;
  active: boolean;
  activeSlug: string;
  open: boolean;
  onPartClick: (event: ReactMouseEvent, session: StudySessionSummary, href: string) => void;
  codingEligible?: boolean;
}) {
  const eligibility = useCodingEligibility(session.id, session.activeResource?.id ?? "", open && knownEligibility === undefined);
  const parts = sessionPartsFor(session, knownEligibility ?? eligibility === true);
  if (!parts.length) return null;
  return <div className="application-disclosure" data-open={open || undefined} inert={!open}><ul className="application-session-parts" aria-label={`${session.title} workspace`}>
    {parts.map(({ slug, label, Icon }) => {
      const partHref = `${href}${href.includes("?") ? "&" : "?"}${TOOL_PARAM}=${slug}`;
      const current = active && activeSlug === slug;
      return <li key={slug}><Link className={`application-session-part${current ? " is-active" : ""}`} href={partHref} prefetch={false} aria-current={current ? "page" : undefined} onClick={(event) => onPartClick(event, session, partHref)}><Icon aria-hidden="true" /><span>{label}</span></Link></li>;
    })}
  </ul></div>;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** The disclosure state the learner left, kept in this browser (it is a view preference, not session data). */
function useDisclosure() {
  const [groupOpen, setGroupOpen] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    setGroupOpen(readStored(GROUP_KEY, true));
    const stored = readStored<unknown>(EXPANDED_KEY, []);
    setExpanded(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string").slice(-50) : []);
  }, []);
  const toggleGroup = useCallback(() => setGroupOpen((open) => { writeStored(GROUP_KEY, !open); return !open; }), []);
  const setOpen = useCallback((sessionId: string, open: boolean) => setExpanded((current) => {
    if (current.includes(sessionId) === open) return current;
    const next = open ? [...current, sessionId].slice(-50) : current.filter((id) => id !== sessionId);
    writeStored(EXPANDED_KEY, next);
    return next;
  }), []);
  return { groupOpen, toggleGroup, expanded, setOpen };
}

type Menu = { sessionId: string; confirmEnd: boolean };

export function SidebarSessions({ mode, onClose }: { mode: "learn" | "research"; onClose: () => void }) {
  const { sessions, rename, remove, swap } = useSessions();
  const { folders, folderBySession, pending, failed, refresh } = useSessionFolders();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeId = sessionIdFromPath(pathname);
  const activeSlug = searchParams.get(TOOL_PARAM) ?? "canvas";
  const { groupOpen, toggleGroup, expanded, setOpen } = useDisclosure();
  const [showAll, setShowAll] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState(false);
  const [options, setOptions] = useState<(typeof folders)[number] | null>(null);
  const [moving, setMoving] = useState<StudySessionSummary | null>(null);
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const menuContent = useRef<HTMLDivElement | null>(null);
  const visible = sessions.filter((session) => !folderBySession.has(session.id) && sessionMatchesMode(session, mode));
  const recent = sessions.filter((session) => session.route && sessionMatchesMode(session, mode))
    .toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)).slice(0, 3);
  const activeFolder = activeId ? folderBySession.get(activeId) : null;
  const selectedFolder = options;
  const listed = showAll ? visible : visible.filter((session, index) => index < VISIBLE_SESSIONS || session.id === activeId);
  const hidden = visible.length - listed.length;

  // Entering a session opens it in the tree, so its parts are one click away.
  useEffect(() => { if (activeId) setOpen(activeId, true); }, [activeId, setOpen]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: globalThis.MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".application-session-menu, .application-session-more")) setMenu(null); };
    const items = Array.from(menuContent.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    items[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenu(null); menuAnchor.current?.focus(); }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!items.includes(document.activeElement as HTMLButtonElement)) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 4_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function attempt(action: () => Promise<void>, failure: string) {
    try { await action(); } catch { setError(failure); }
  }

  function submitRename(event: FormEvent<HTMLFormElement>, session: StudySessionSummary) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim().slice(0, 120);
    setRenaming(null);
    if (title && title !== session.title) void attempt(() => rename(session.id, title), "That session couldn't be renamed. Try again.");
  }

  // Leave the ended workspace after its history is saved.
  function endSession(session: StudySessionSummary) {
    setMenu(null);
    void attempt(async () => {
      await remove(session.id);
      if (session.id === activeId) router.push(activeFolder ? folderHref(activeFolder, mode) : sessionsHref(mode));
    }, "That session couldn't be ended. Try again.");
  }

  // Inside the session already, a part opens beside the lesson without reloading it.
  function openPart(event: ReactMouseEvent, session: StudySessionSummary, href: string) {
    onClose();
    if (session.id !== activeId || !session.route || pathname !== session.route) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
  }

  function renderSession(session: StudySessionSummary, index: number, group: StudySessionSummary[]) {
      const open = expanded.includes(session.id);
      const isActive = session.id === activeId;
      const parts = sessionPartsFor(session);
      const Icon = session.activeResource?.type === "paper" ? FileText : Video;
      const href = session.route ?? sessionsHref(mode);
      const menuOpen = menu?.sessionId === session.id;
      return (
        <li key={session.id} className={`application-session${isActive ? " is-active" : ""}`}>
          <div className="application-session-row">
            {parts.length > 0
              ? <button className="application-session-toggle" type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${session.title}`} onClick={() => setOpen(session.id, !open)}><ChevronRight aria-hidden="true" /></button>
              : <span className="application-session-toggle" aria-hidden="true"><Icon /></span>}
            {renaming === session.id ? (
              <form className="application-session-rename" onSubmit={(event) => submitRename(event, session)}>
                <label className="sr-only" htmlFor={`rename-${session.id}`}>Session name</label>
                {/* biome-ignore lint/a11y/noAutofocus: the field appears because the learner chose Rename. */}
                <input id={`rename-${session.id}`} name="title" defaultValue={session.title} maxLength={120} autoFocus onBlur={(event) => event.currentTarget.form?.requestSubmit()} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
              </form>
            ) : (
              <Link className="application-session-link" href={href} prefetch={false} title={session.title} aria-current={isActive && activeSlug === "canvas" ? "page" : undefined} onClick={onClose}>
                <span>{session.title}</span>
              </Link>
            )}
            <button className="application-session-more" type="button" aria-label={`Actions for ${session.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => { menuAnchor.current = event.currentTarget; setMenu(menuOpen ? null : { sessionId: session.id, confirmEnd: false }); }}><MoreHorizontal aria-hidden="true" /></button>
            {menuOpen ? (
              <div ref={menuContent} className="application-session-menu" role="menu" aria-label={`Actions for ${session.title}`}>
                {menu.confirmEnd ? <>
                  <p>End &ldquo;{session.title}&rdquo;? It leaves your sessions. If you&apos;ve finished it, it moves to your Library; your progress and notes stay with each video.</p>
                  <button type="button" role="menuitem" className="is-danger" onClick={() => endSession(session)}><CircleStop aria-hidden="true" /><span>End session</span></button>
                  <button type="button" role="menuitem" onClick={() => setMenu({ sessionId: session.id, confirmEnd: false })}><span>Cancel</span></button>
                </> : <>
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(session.id); }}><PencilLine aria-hidden="true" /><span>Rename</span></button>
                  <button type="button" role="menuitem" onClick={() => { menuAnchor.current?.focus(); setMenu(null); setMoving(session); }}><FolderClosed aria-hidden="true" /><span>Move to folder</span></button>
                  {(["up", "down"] as const).map((direction) => {
                    const neighbor = group[index + (direction === "up" ? -1 : 1)];
                    const Arrow = direction === "up" ? ArrowUp : ArrowDown;
                    return <button key={direction} type="button" role="menuitem" disabled={pending || !neighbor} onClick={() => {
                      setMenu(null);
                      menuAnchor.current?.focus();
                      if (neighbor) void attempt(() => swap(session.id, neighbor.id), "That session couldn't be moved. Try again.");
                    }}><Arrow aria-hidden="true" /><span>Move {direction}</span></button>;
                  })}
                  <button type="button" role="menuitem" className="is-danger" onClick={() => setMenu({ sessionId: session.id, confirmEnd: true })}><CircleStop aria-hidden="true" /><span>End session</span></button>
                </>}
              </div>
            ) : null}
          </div>
          {parts.length > 0 ? <SessionPartLinks session={session} href={href} active={isActive} activeSlug={activeSlug} open={open} onPartClick={openPart} /> : null}
        </li>
      );
  }

  const overviewActive = pathname === "/app/sessions";
  return (
    <div className={`application-sessions${groupOpen ? " is-open" : ""}`}>
      <div className="application-nav-row">
        <Link className={`application-nav-link${overviewActive || (activeId && !groupOpen) ? " is-active" : ""}`} data-nav-tone="sessions" href={sessionsHref(mode)} aria-current={overviewActive ? "page" : undefined} onClick={onClose}>
          <span className="application-nav-icon" aria-hidden="true"><CalendarDays /></span><span>Sessions</span>
        </Link>
        <button className="application-nav-disclosure" type="button" aria-expanded={groupOpen} aria-controls="application-session-tree" aria-label={groupOpen ? "Hide sessions" : "Show sessions"} onClick={toggleGroup}><ChevronRight aria-hidden="true" /></button>
      </div>
      {groupOpen ? <div id="application-session-tree" className="application-folder-tree">
        <section aria-label="Folders">
          <div className="application-folder-heading"><span>Folders</span><button className="application-nav-disclosure" type="button" aria-label="New folder" disabled={pending} onClick={() => setNewFolder(true)}><Plus aria-hidden="true" /></button></div>
          {failed ? <button type="button" className="application-session-more-list" onClick={() => void refresh()}>Retry loading folders</button> : null}
          <ul className="application-session-tree">
            {folders.map((folder) => {
              const href = folderHref(folder.id, mode);
              return <li key={folder.id}>
                <div className="application-session-row">
                  <Link className="application-session-link application-folder-link" href={href} title={folder.title} aria-current={(pathname === href.split("?")[0] || activeFolder === folder.id) ? "page" : undefined} onClick={onClose}><FolderClosed aria-hidden="true" /><span>{folder.title}</span></Link>
                  <button type="button" className="application-session-more" aria-label={`Folder options for ${folder.title}`} onClick={() => setOptions(folder)}><MoreHorizontal aria-hidden="true" /></button>
                </div>
              </li>;
            })}
          </ul>
        </section>
        <details open>
          <summary>Unfiled</summary>
          <ul className="application-session-tree">{listed.map((session, index) => renderSession(session, index, listed))}</ul>
          {listed.length === 0 ? <p className="application-folder-empty">No unfiled sessions</p> : null}
          {hidden > 0 || showAll ? <button className="application-session-more-list" type="button" onClick={() => setShowAll((all) => !all)}>{showAll ? "Show fewer" : `Show ${hidden} more`}</button> : null}
        </details>
        {recent.length ? <details>
          <summary>Recent Sessions</summary>
          <ul className="application-session-tree">{recent.map((session) => <li key={session.id}><Link className="application-session-link" href={session.route ?? sessionsHref(mode)} prefetch={false} onClick={onClose}><span>{session.title}</span></Link></li>)}</ul>
        </details> : null}
        {error ? <p className="application-session-error" role="alert">{error}</p> : null}
      </div> : null}
      {newFolder ? <FolderEditor onClose={() => setNewFolder(false)} onSaved={(id) => { onClose(); router.push(folderHref(id, mode)); }} /> : null}
      {moving ? <MoveSessionDialog session={moving} onClose={() => setMoving(null)} /> : null}
      {selectedFolder ? <FolderOptions folder={selectedFolder} onClose={() => setOptions(null)} onDeleted={() => { if (pathname === folderHref(selectedFolder.id, mode).split("?")[0]) router.push(sessionsHref(mode)); }} /> : null}
    </div>
  );
}

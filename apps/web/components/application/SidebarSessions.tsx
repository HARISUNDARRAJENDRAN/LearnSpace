"use client";

import type { StudySessionSummary } from "@learnspace/shared";
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, CircleStop, FileText, MoreHorizontal, PencilLine, Video } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useState } from "react";
import { useCodingEligibility } from "../coding/useCodingEligibility";
import { sessionParts, TOOL_PARAM } from "../study/tools";
import { lastSeenRoute, sessionIdFromPath, sessionsHref, useSessions } from "./sessions";

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
  const eligibility = useCodingEligibility(session.id, session.activeResource?.id ?? "", knownEligibility === undefined);
  const parts = sessionPartsFor(session, knownEligibility ?? eligibility === true);
  if (!parts.length) return null;
  return <div className="application-disclosure" data-open={open || undefined} inert={!open}><ul className="application-session-parts" aria-label={`${session.title} workspace`}>
    {parts.map(({ slug, label, Icon }) => {
      const partHref = `${href}?${TOOL_PARAM}=${slug}`;
      const current = active && activeSlug === slug;
      return <li key={slug}><Link className={`application-session-part${current ? " is-active" : ""}`} href={partHref} aria-current={current ? "page" : undefined} onClick={(event) => onPartClick(event, session, partHref)}><Icon aria-hidden="true" /><span>{label}</span></Link></li>;
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
  const visible = sessions.filter((session) => sessionMatchesMode(session, mode));
  const listed = showAll ? visible : visible.filter((session, index) => index < VISIBLE_SESSIONS || session.id === activeId);
  const hidden = visible.length - listed.length;

  // Entering a session opens it in the tree, so its parts are one click away.
  useEffect(() => { if (activeId) setOpen(activeId, true); }, [activeId, setOpen]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: globalThis.MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".application-session-menu, .application-session-more")) setMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
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

  // Leaving the ended session waits for the server, so Sessions reopens the one before it and never the one just ended.
  function endSession(session: StudySessionSummary) {
    setMenu(null);
    void attempt(async () => {
      await remove(session.id);
      if (session.id === activeId) router.push(sessionsHref(mode));
    }, "That session couldn't be ended. Try again.");
  }

  // Inside the session already, a part opens beside the lesson without reloading it.
  function openPart(event: ReactMouseEvent, session: StudySessionSummary, href: string) {
    onClose();
    if (session.id !== activeId || !session.route || pathname !== session.route) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
  }

  const overviewActive = pathname === "/app/sessions";
  // Sessions goes straight back to where the learner was in this mode; with nothing open it asks what to study next.
  const resumeHref = lastSeenRoute(visible) ?? sessionsHref(mode);
  return (
    <div className={`application-sessions${groupOpen ? " is-open" : ""}`}>
      <div className="application-nav-row">
        <Link className={`application-nav-link${overviewActive || (activeId && !groupOpen) ? " is-active" : ""}`} data-nav-tone="sessions" href={resumeHref} aria-current={overviewActive ? "page" : undefined} onClick={onClose}>
          <span className="application-nav-icon" aria-hidden="true"><CalendarDays /></span><span>Sessions</span>
        </Link>
        {visible.length > 0 ? <button className="application-nav-disclosure" type="button" aria-expanded={groupOpen} aria-controls="application-session-tree" aria-label={groupOpen ? "Hide sessions" : "Show sessions"} onClick={toggleGroup}><ChevronRight aria-hidden="true" /></button> : null}
      </div>
      {visible.length > 0 ? (
        <div className="application-disclosure" data-open={groupOpen || undefined} inert={!groupOpen}>
          <ul className="application-session-tree" id="application-session-tree" aria-label="Your sessions">
            {listed.map((session, index) => {
              const open = expanded.includes(session.id);
              const isActive = session.id === activeId;
              const parts = sessionPartsFor(session);
              const Icon = session.activeResource?.type === "paper" ? FileText : Video;
              const href = session.route ?? "/app/sessions";
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
                      <Link className="application-session-link" href={href} title={session.title} aria-current={isActive && activeSlug === "canvas" ? "page" : undefined} onClick={onClose}>
                        <span>{session.title}</span>
                      </Link>
                    )}
                    <button className="application-session-more" type="button" aria-label={`Actions for ${session.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenu(menuOpen ? null : { sessionId: session.id, confirmEnd: false })}><MoreHorizontal aria-hidden="true" /></button>
                    {menuOpen ? (
                      <div className="application-session-menu" role="menu" aria-label={`Actions for ${session.title}`}>
                        {menu.confirmEnd ? <>
                          <p>End &ldquo;{session.title}&rdquo;? It leaves your sessions. If you&apos;ve finished it, it moves to your Library; your progress and notes stay with each video.</p>
                          <button type="button" role="menuitem" className="is-danger" onClick={() => endSession(session)}><CircleStop aria-hidden="true" /><span>End session</span></button>
                          <button type="button" role="menuitem" onClick={() => setMenu({ sessionId: session.id, confirmEnd: false })}><span>Cancel</span></button>
                        </> : <>
                          <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(session.id); }}><PencilLine aria-hidden="true" /><span>Rename</span></button>
                          <button type="button" role="menuitem" disabled={index === 0} onClick={() => { setMenu(null); const above = listed[index - 1]; if (above) void attempt(() => swap(session.id, above.id), "That session couldn't be moved. Try again."); }}><ArrowUp aria-hidden="true" /><span>Move up</span></button>
                          <button type="button" role="menuitem" disabled={index === listed.length - 1} onClick={() => { setMenu(null); const below = listed[index + 1]; if (below) void attempt(() => swap(session.id, below.id), "That session couldn't be moved. Try again."); }}><ArrowDown aria-hidden="true" /><span>Move down</span></button>
                          <button type="button" role="menuitem" className="is-danger" onClick={() => setMenu({ sessionId: session.id, confirmEnd: true })}><CircleStop aria-hidden="true" /><span>End session</span></button>
                        </>}
                      </div>
                    ) : null}
                  </div>
                  {parts.length > 0 ? <SessionPartLinks session={session} href={href} active={isActive} activeSlug={activeSlug} open={open} onPartClick={openPart} /> : null}
                </li>
              );
            })}
          </ul>
          {hidden > 0 || showAll ? <button className="application-session-more-list" type="button" onClick={() => setShowAll((all) => !all)}>{showAll ? "Show fewer" : `Show ${hidden} more`}</button> : null}
          {error ? <p className="application-session-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

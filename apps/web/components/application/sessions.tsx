"use client";

import type { StudySessionSummary } from "@learnspace/shared";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type SessionsApi = {
  sessions: StudySessionSummary[];
  refresh: () => Promise<void>;
  rename: (sessionId: string, title: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  /** Swaps a session with another one in the learner's order. */
  swap: (sessionId: string, otherId: string) => Promise<void>;
};

const SessionsContext = createContext<SessionsApi | null>(null);

export function useSessions(): SessionsApi {
  const api = useContext(SessionsContext);
  if (!api) throw new Error("useSessions needs a SessionsProvider");
  return api;
}

const STUDY_PATH = /^\/app\/study\/(?:video|paper)\/([0-9a-f-]{36})/i;

/** The session a study route shows. */
export function sessionIdFromPath(pathname: string): string | null {
  return STUDY_PATH.exec(pathname)?.[1] ?? null;
}

/** The open session the learner was in last, which the Sessions tab opens. */
export function lastSeenRoute(sessions: StudySessionSummary[]): string | null {
  const open = sessions.filter((session) => session.route && (session.status === "active" || session.status === "paused"));
  return open.toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0]?.route ?? null;
}

async function send(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/**
 * The learner's sessions, shared by the sidebar, the header search and the Sessions page. The layout renders the first list;
 * after that it is kept current on the client: a session opened from anywhere joins it at once, coming back to the tab
 * resyncs it, and rename, delete and reorder show before the server confirms them (and roll back if it refuses).
 */
export function SessionsProvider({ initial, children }: { initial: StudySessionSummary[]; children: ReactNode }) {
  const [sessions, setSessions] = useState(initial);
  const latest = useRef(sessions);
  latest.current = sessions;
  // A server render of the layout (router.refresh) brings the newest list.
  useEffect(() => setSessions(initial), [initial]);
  // Only the newest request may land, so a slow refresh never overwrites a newer list.
  const generation = useRef(0);
  // Sessions ended here stay out of the list even if a refresh that started before the server ended them brings them back.
  const ended = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const response = await fetch("/api/v1/study-sessions", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { sessions: StudySessionSummary[] };
      if (mine === generation.current) setSessions(body.sessions.filter((session) => !ended.current.has(session.id)));
    } catch {
      // The list stays as it was; the next refresh tries again.
    }
  }, []);
  // Writes made optimistically: a refresh started before one of them would bring back the old list.
  const mutate = useCallback(async (next: StudySessionSummary[], request: () => Promise<void>) => {
    const previous = latest.current;
    generation.current++;
    setSessions(next);
    try {
      await request();
    } catch (error) {
      generation.current++;
      setSessions(previous);
      throw error;
    }
  }, []);

  const pathname = usePathname();
  const openId = sessionIdFromPath(pathname);
  const known = openId ? ended.current.has(openId) || sessions.some((session) => session.id === openId) : true;
  useEffect(() => { if (!known) void refresh(); }, [known, refresh]);
  // Opening a session makes it the one Sessions goes back to (the server records the same when it renders the session).
  useEffect(() => {
    if (!openId) return;
    const now = new Date().toISOString();
    setSessions((current) => current.map((session) => (session.id === openId ? { ...session, lastActiveAt: now } : session)));
  }, [openId]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const rename = useCallback((sessionId: string, title: string) => mutate(
    latest.current.map((session) => (session.id === sessionId ? { ...session, title } : session)),
    () => send(`/api/v1/study-sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  ), [mutate]);
  const remove = useCallback(async (sessionId: string) => {
    ended.current.add(sessionId);
    try {
      await mutate(latest.current.filter((session) => session.id !== sessionId), () => send(`/api/v1/study-sessions/${sessionId}`, { method: "DELETE" }));
    } catch (error) {
      ended.current.delete(sessionId);
      throw error;
    }
  }, [mutate]);
  const swap = useCallback((sessionId: string, otherId: string) => {
    const current = latest.current;
    const moving = current.find((session) => session.id === sessionId);
    const other = current.find((session) => session.id === otherId);
    if (!moving || !other) return Promise.resolve();
    const next = current.map((session) => (session === moving ? other : session === other ? moving : session));
    return mutate(next, () => send("/api/v1/study-sessions/order", { method: "PUT", body: JSON.stringify({ sessionIds: next.map((session) => session.id) }) }));
  }, [mutate]);

  const api = useMemo(() => ({ sessions, refresh, rename, remove, swap }), [sessions, refresh, rename, remove, swap]);
  return <SessionsContext value={api}>{children}</SessionsContext>;
}

"use client";

import type { ChangeSessionFolder, CreateSessionFolder, StartStudySessionResponse } from "@learnspace/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { listSessionFolders } from "../../lib/folders/service";

export type SessionFolderList = Awaited<ReturnType<typeof listSessionFolders>>;
type Folders = SessionFolderList;
const base = "/api/v1/session-folders";

export function folderHref(id: string, mode: "learn" | "research") {
  return `/app/sessions/folders/${id}${mode === "research" ? "?mode=research" : ""}`;
}

export function folderSessionHref(route: string, folderId: string, mode: "learn" | "research", tool?: string) {
  const params = new URLSearchParams({ folder: folderId });
  if (mode === "research") params.set("folderMode", mode);
  if (tool) params.set("tool", tool);
  return `${route}?${params}`;
}

export class FolderRequestError extends Error {
  constructor(readonly status: number, readonly info: { message?: string; code?: string; folderId?: string; sessionId?: string }) {
    super(info.message ?? "Something went wrong. Try again.");
  }
}

export async function folderRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new FolderRequestError(response.status, body?.error ?? {});
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

function json(method: "POST" | "PATCH", body: unknown) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function shift<T>(rows: T[], match: (item: T) => boolean, direction: "up" | "down") {
  const index = rows.findIndex(match);
  const neighbor = index + (direction === "up" ? -1 : 1);
  if (index < 0 || neighbor < 0 || neighbor >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[neighbor]] = [next[neighbor]!, next[index]!];
  return next;
}

function optimistic(folders: Folders, id: string, input: ChangeSessionFolder): Folders {
  if (input.action === "reorder-folder") return shift(folders, (item) => item.id === id, input.direction);
  if (input.action === "move-session") {
    if (folders.find((folder) => folder.id === id)?.sessionIds.includes(input.sessionId)) return folders;
    return folders.map((folder) => ({
      ...folder,
      sessionIds: folder.id === id ? [...folder.sessionIds, input.sessionId] : folder.sessionIds.filter((item) => item !== input.sessionId),
    }));
  }
  return folders.map((folder) => {
    if (folder.id !== id) return folder;
    if (input.action === "edit") return { ...folder, title: input.title, description: input.description };
    if (input.action === "unfile-session") return { ...folder, sessionIds: folder.sessionIds.filter((item) => item !== input.sessionId) };
    if (input.action === "reorder-session") return { ...folder, sessionIds: shift(folder.sessionIds, (item) => item === input.sessionId, input.direction) };
    return folder;
  });
}

type FolderState = {
  folders: Folders;
  folderBySession: Map<string, string>;
  loading: boolean;
  failed: boolean;
  pending: boolean;
  revision: number;
  refresh: () => Promise<void>;
  create: (input: CreateSessionFolder) => Promise<{ id: string }>;
  change: (id: string, input: ChangeSessionFolder) => Promise<StartStudySessionResponse | null>;
  remove: (id: string) => Promise<null>;
};

const FolderContext = createContext<FolderState | null>(null);

export function useSessionFolders() {
  const folders = useContext(FolderContext);
  if (!folders) throw new Error("Session folders require SessionFoldersProvider");
  return folders;
}

export function SessionFoldersProvider({ initial, children }: { initial?: Folders; children: ReactNode }) {
  const [folders, setFolders] = useState<Folders>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const current = useRef(folders);
  const generation = useRef(0);
  const busy = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    const mine = ++generation.current;
    try {
      const data = await folderRequest<{ folders: Folders }>(base);
      if (mine !== generation.current) return;
      current.current = data.folders;
      setFolders(data.folders);
      setFailed(false);
    } catch {
      if (mine === generation.current) setFailed(true);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const update = () => { setRevision((value) => value + 1); void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") update(); };
    const listener = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("learnspace:session-folders");
    if (listener) listener.onmessage = update;
    channel.current = listener;
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      generation.current++;
      listener?.close();
      channel.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const mutate = useCallback(async <T,>(request: () => Promise<T>, update?: (items: Folders) => Folders) => {
    if (busy.current) throw new Error("Wait for the current folder change to finish.");
    busy.current = true;
    generation.current++;
    setPending(true);
    const next = update?.(current.current);
    if (next) setFolders(next);
    try {
      const result = await request();
      if (next) current.current = next;
      channel.current?.postMessage("updated");
      return result;
    } catch (error) {
      if (update) setFolders(current.current);
      throw error;
    } finally {
      busy.current = false;
      setRevision((value) => value + 1);
      try { await refresh(); } finally { setPending(false); }
    }
  }, [refresh]);

  const create = useCallback((input: CreateSessionFolder) => mutate(() => folderRequest<{ id: string }>(base, json("POST", input))), [mutate]);
  const change = useCallback(async (id: string, input: ChangeSessionFolder) => {
    const result = await mutate(
      () => folderRequest<StartStudySessionResponse | null>(`${base}/${id}`, json("PATCH", input)),
      (items) => optimistic(items, id, input),
    );
    if (input.action === "start-resource" && result?.sessionId) {
      const startedId = result.sessionId;
      setFolders((items) => {
        const next = items.map((folder) => (
          folder.id === id && !folder.sessionIds.includes(startedId)
            ? { ...folder, sessionIds: [...folder.sessionIds, startedId] }
            : folder
        ));
        current.current = next;
        return next;
      });
    }
    return result;
  }, [mutate]);
  const remove = useCallback((id: string) => mutate(
    () => folderRequest<null>(`${base}/${id}`, { method: "DELETE" }),
    (items) => items.filter((folder) => folder.id !== id),
  ), [mutate]);
  const folderBySession = useMemo(() => new Map(folders.flatMap((folder) => folder.sessionIds.map((id) => [id, folder.id]))), [folders]);
  const value = useMemo(() => ({ folders, folderBySession, loading, failed, pending, revision, refresh, create, change, remove }),
    [folders, folderBySession, loading, failed, pending, revision, refresh, create, change, remove]);
  return <FolderContext value={value}>{children}</FolderContext>;
}

"use client";

import { FileText, Plus, Search, Video } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { folderSessionCandidates } from "../../lib/folders/service";
import type { GlobalSearchResult } from "../../lib/search/service";
import { FolderDialog } from "./FolderDialogs";
import { folderRequest, useSessionFolders } from "./state";

type Kind = "sessions" | "papers" | "videos";
type Candidate = { id: string; title: string; type: string | null; detail: string; folderId?: string | null; folderTitle?: string | null };

export function AddFolderContent({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { change, pending } = useSessionFolders();
  const [kind, setKind] = useState<Kind>("sessions");
  const [value, setValue] = useState("");
  const [query, setQuery] = useState({ text: "" });
  const [result, setResult] = useState<{ key: string; items: Candidate[]; error?: string } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Candidate | null>(null);
  const [error, setError] = useState("");
  const key = `${kind}:${query.text}`;
  const canSearch = kind === "sessions" || query.text.length >= 2;

  useEffect(() => {
    if (!canSearch) return;
    const controller = new AbortController();
    const init = { signal: controller.signal };
    const q = encodeURIComponent(query.text);
    const request = kind === "sessions"
      ? folderRequest<{ sessions: Awaited<ReturnType<typeof folderSessionCandidates>> }>(`/api/v1/session-folders/${folderId}/candidates?q=${q}`, init)
        .then(({ sessions }) => sessions.map((item) => ({ ...item, detail: item.folderTitle ?? item.status })))
      : folderRequest<{ results: GlobalSearchResult[] }>(`/api/v1/search?mode=${kind === "papers" ? "research" : "learn"}&q=${q}`, init)
        .then(({ results }) => {
          const unique = new Map<string, Candidate>();
          for (const item of results) {
            if ((item.kind === "resource" || item.kind === "library") && item.resourceId && !unique.has(item.resourceId)) {
              unique.set(item.resourceId, { id: item.resourceId, title: item.title, type: item.resourceType, detail: item.resourceType === "paper" ? "Paper" : "Video" });
            }
          }
          return [...unique.values()];
        });
    request.then(
      (items) => { if (!controller.signal.aborted) setResult({ key, items }); },
      () => { if (!controller.signal.aborted) setResult({ key, items: [], error: "Search failed. Try again." }); },
    );
    return () => controller.abort();
  }, [canSearch, folderId, key, kind, query]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirm(null);
    setResult(null);
    setQuery({ text: value.trim() });
  }

  async function save(item: Candidate) {
    setError("");
    try {
      await change(folderId, kind === "sessions"
        ? { action: "move-session", sessionId: item.id, fromFolderId: item.folderId ?? null }
        : { action: "save-resource", resourceId: item.id });
      setAdded((current) => [...current, item.id]);
      setConfirm(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This item couldn't be added."); }
  }

  const current = result?.key === key ? result : null;
  return <FolderDialog title="Add content" onClose={onClose}>
    <fieldset className="session-folder-filters">
      <legend className="sr-only">Content type</legend>
      {(["sessions", "papers", "videos"] as const).map((item) => <button type="button" key={item} aria-pressed={kind === item} disabled={pending} onClick={() => { setKind(item); setConfirm(null); setError(""); }}>{item[0]?.toUpperCase()}{item.slice(1)}</button>)}
    </fieldset>
    <form className="session-folder-search" onSubmit={search}>
      <input type="search" aria-label={`Search ${kind}`} placeholder={`Search ${kind}`} maxLength={120} value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="submit"><Search aria-hidden="true" />Search</button>
    </form>
    {error ? <p className="session-folder-error" role="alert">{error}</p> : null}
    {confirm ? <div className="session-folder-confirm">
      <p>Move “{confirm.title}” from “{confirm.folderTitle}” into this folder?</p>
      <div className="session-folder-actions"><button type="button" onClick={() => setConfirm(null)}>Cancel</button><button className="is-primary" type="button" disabled={pending} onClick={() => void save(confirm)}>Move session</button></div>
    </div> : null}
    {!canSearch ? <p>Enter at least two characters to find material in LearnSpace.</p>
      : !current ? <p role="status">Searching…</p>
      : current.error ? <p role="alert">{current.error}</p>
      : !current.items.length ? <p>No {kind} found. Try a different title.</p>
      : <ul className="session-folder-results">
        {current.items.map((item) => {
          const Icon = item.type === "paper" ? FileText : Video;
          return <li key={item.id}><Icon aria-hidden="true" /><div><strong>{item.title}</strong><small>{item.detail}</small></div>
            <button type="button" disabled={pending || added.includes(item.id)} aria-label={added.includes(item.id) ? `${item.title} added` : `Add ${item.title}`} onClick={() => { if (item.folderId) setConfirm(item); else void save(item); }}>
              {added.includes(item.id) ? "Added" : <><Plus aria-hidden="true" /> Add</>}
            </button>
          </li>;
        })}
      </ul>}
    <div className="session-folder-actions"><button type="button" onClick={onClose}>Done</button></div>
  </FolderDialog>;
}

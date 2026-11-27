"use client";

import type { SourcePreview, StudyAnchor } from "@learnspace/shared";
import { FileText, MoreHorizontal, Plus, Video } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FolderMaterial, SessionFolderDetails } from "../../lib/folders/details";
import { sessionsHref, useSessions } from "../application/sessions";
import { SourceDiscoveryModal } from "../source-discovery/SourceDiscoveryModal";
import { postStudyAction } from "../study/session-api";
import { useTranscriptCapture } from "../study/useTranscriptCapture";
import { AddFolderContent } from "./AddFolderContent";
import { FolderDialog, FolderOptions, SessionFolderItemOptions } from "./FolderDialogs";
import { takeFolderQuestion } from "./StudyFolderAction";
import { folderRequest, FolderRequestError, folderSessionHref, useSessionFolders } from "./state";

const SessionChat = dynamic(() => import("../study/SessionChat").then((module) => module.SessionChat));
const SessionNotes = dynamic(() => import("../study/SessionNotes").then((module) => module.SessionNotes));
const MasteryCheck = dynamic(() => import("../study/MasteryCheck").then((module) => module.MasteryCheck));
const tools = [{ id: "chat", label: "AI Chat" }, { id: "notes", label: "Notes" }, { id: "practice", label: "Mastery Check" }] as const;
const noAction = () => undefined;

function LoadTranscript({ id }: { id: string }) {
  useTranscriptCapture(id, true);
  return null;
}

export function FolderCanvas({ folderId, mode }: { folderId: string; mode: "learn" | "research" }) {
  const router = useRouter();
  const { refresh } = useSessions();
  const { change, pending, revision } = useSessionFolders();
  const [folder, setFolder] = useState<SessionFolderDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [add, setAdd] = useState<"discovery" | "library" | null>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const [options, setOptions] = useState(false);
  const [itemOptions, setItemOptions] = useState<FolderMaterial | null>(null);
  const [opening, setOpening] = useState(false);
  const [conflict, setConflict] = useState<{ item: FolderMaterial; folderId: string; sessionId: string; message: string; anchor: StudyAnchor | null } | null>(null);
  const params = useSearchParams();
  const tool = tools.find((item) => item.id === params.get("tool"))?.id ?? null;
  const [chatOpened, setChatOpened] = useState(tool === "chat");
  const [seed, setSeed] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (tool !== "chat") return;
    setChatOpened(true);
    const text = takeFolderQuestion(`/app/sessions/folders/${folderId}`);
    if (text) setSeed({ text, at: Date.now() });
  }, [folderId, tool]);
  function selectTool(next: string | null) {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("tool", next);
    else url.searchParams.delete("tool");
    window.history.pushState(null, "", url);
  }
  const notesId = params.get("resource");
  const materials = folder?.materials ?? [];
  const selectedNotes = materials.find((item) => item.id === notesId) ?? materials[0];
  const readySources = materials.filter((item) => item.state === "ready").length;
  const preparing = materials.some((item) => item.state === "preparing");

  // Folder mutations and incoming transcript versions refresh the canvas without remounting the tools.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry and revision explicitly refresh the same endpoint.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await folderRequest<SessionFolderDetails>(`/api/v1/session-folders/${folderId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setFolder(value);
        setLoadError("");
        if (value.materials.some((item) => item.state === "preparing")) timer = setTimeout(() => void load(), 10_000);
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Could not open the folder.");
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [folderId, retry, revision]);

  async function open(item: FolderMaterial, anchor: StudyAnchor | null = null, moveFrom?: { folderId: string; sessionId: string }) {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      const result = item.sessionId
        ? item.active ? { route: `/app/study/${item.type}/${item.sessionId}` }
          : await postStudyAction<{ route: string }>(item.sessionId, "resources", { resourceId: item.id })
        : await change(folderId, { action: "start-resource", resourceId: item.id, idempotencyKey: crypto.randomUUID(), ...(moveFrom ? { moveFrom } : {}) });
      if (!result) throw new Error("Could not open this material.");
      setConflict(null);
      void refresh();
      const destination = new URL(folderSessionHref(result.route, folderId, mode), window.location.origin);
      if (anchor?.kind === "paper" && anchor.page) destination.searchParams.set("page", String(anchor.page));
      if (anchor?.kind === "video") destination.searchParams.set("at", String(anchor.positionMs));
      router.push(destination.pathname + destination.search);
    } catch (cause) {
      const info = cause instanceof FolderRequestError && cause.info.code === "FOLDER_MEMBERSHIP_CHANGED" ? cause.info : null;
      if (info?.folderId && info.sessionId) setConflict({ item, anchor, folderId: info.folderId, sessionId: info.sessionId, message: cause instanceof Error ? cause.message : "" });
      else setError(cause instanceof Error ? cause.message : "Could not open this material.");
    } finally { setOpening(false); }
  }

  async function remove(item: FolderMaterial) {
    setError("");
    try {
      if (item.saved) await change(folderId, { action: "remove-resource", resourceId: item.id });
      else if (item.sessionId) await change(folderId, { action: "unfile-session", sessionId: item.sessionId });
      setItemOptions(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the folder."); }
  }

  const collapse = () => selectTool(null);
  const place = { kind: "paper", page: 1 } as const;
  return <main className="folder-workspace" aria-labelledby="folder-title">
    <header className="folder-workspace-header">
      <div><h1 id="folder-title">{folder?.title ?? "Learning Canvas"}</h1>{folder?.description ? <p>{folder.description}</p> : null}</div>
      {folder ? <div className="session-folder-actions">
        <button className="is-primary" type="button" onClick={(event) => { addTrigger.current = event.currentTarget; setAdd("discovery"); }}><Plus aria-hidden="true" />Add content</button>
        <button className="session-folder-icon" type="button" aria-label="Folder options" onClick={() => setOptions(true)}><MoreHorizontal aria-hidden="true" /></button>
      </div> : null}
    </header>
    {loadError ? <p role="alert" className="session-folder-error">{loadError} <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></p> : null}
    {error && !itemOptions ? <p role="alert" className="session-folder-error">{error}</p> : null}
    {folder ? <>
      <nav className="folder-workspace-tools" aria-label="Folder tools">
        <button type="button" aria-pressed={tool === null} onClick={collapse}>Learning Canvas</button>
        {tools.map((item) => <button key={item.id} type="button" aria-pressed={tool === item.id} onClick={() => selectTool(item.id)}>{item.label}</button>)}
      </nav>
      <div className="folder-workspace-body">
        <section className="folder-canvas-board" aria-label="Learning Canvas">
          {materials.length === 0 ? <p className="folder-canvas-empty">Add a YouTube video or research paper to start studying.</p> : <ul className="folder-canvas-grid">
            {materials.map((item) => {
              const Icon = item.type === "video" ? Video : FileText;
              return <li key={item.id} className="folder-canvas-card">
                {item.type === "video" && item.state === "preparing" ? <LoadTranscript id={item.id} /> : null}
                <button className="folder-canvas-material" type="button" disabled={opening || pending} onClick={() => void open(item)}>
                  <span className={`folder-canvas-preview is-${item.type}`}>
                    {item.thumbnailUrl ? <Image src={item.thumbnailUrl} alt="" width={480} height={270} unoptimized /> : <Icon aria-hidden="true" />}
                  </span>
                  <span className="folder-canvas-caption">
                    <small>{item.type === "video" ? "YouTube video" : "Research paper"}{item.progress > 0 ? ` · ${Math.round(item.progress)}%` : ""}</small>
                    <strong>{item.title}</strong>
                  </span>
                </button>
                <button className="session-folder-icon folder-canvas-options" type="button" aria-label={`Options for ${item.title}`} onClick={() => { setError(""); setItemOptions(item); }}><MoreHorizontal aria-hidden="true" /></button>
              </li>;
            })}
          </ul>}
        </section>
        {tool || chatOpened ? <aside className="folder-workspace-panel" aria-label={tools.find((item) => item.id === tool)?.label} hidden={!tool}>
          {tool === "chat" || chatOpened ? <div className="folder-tool-slot" hidden={tool !== "chat"}><SessionChat sessionId={folderId} folder resource={{ type: "paper", title: folder.title }} place={place} seed={seed} code={null}
            onGo={noAction} onCollapse={collapse} preparing={preparing} readySources={readySources} onSource={(id, anchor) => {
              const item = materials.find((resource) => resource.id === id);
              if (item) void open(item, anchor);
              else setError("This source is no longer in the folder.");
            }} /></div> : null}
          {tool === "notes" ? selectedNotes ? <>
            <label className="folder-notes-picker">Notes for<select value={selectedNotes.id} onChange={(event) => { const url = new URL(window.location.href); url.searchParams.set("resource", event.target.value); window.history.replaceState(null, "", url); }}>
              {materials.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select></label>
            <SessionNotes key={selectedNotes.id} sessionId={folderId} resourceId={selectedNotes.id} title={selectedNotes.title} material={selectedNotes.type}
              tutor={{ lesson: () => ({ positionMs: 0, playing: false, ...(selectedNotes.type === "paper" ? { paper: { anchor: { kind: "paper", page: 1 }, selection: null } } : {}) }), capture: () => null, onControl: noAction, onTurn: noAction,
                onGo: (anchor) => { void open(selectedNotes, anchor); }, sharing: false, shareError: null, onShare: noAction }}
              onCollapse={collapse} />
          </> : <p className="folder-canvas-empty">Add material to start taking notes.</p> : null}
          {tool === "practice" ? <MasteryCheck sessionId={folderId} resourceId={folderId} folder readySources={readySources} next={{ course: null, nextTitle: null }} place={place} onGo={noAction} onCollapse={collapse} /> : null}
        </aside> : null}
      </div>
    </> : !loadError ? <p role="status">Opening folder…</p> : null}
    {options && folder ? <FolderOptions folder={folder} onClose={() => setOptions(false)} onDeleted={() => router.push(sessionsHref(mode))} /> : null}
    {add === "discovery" ? <SourceDiscoveryModal mode={mode} isOpen onClose={() => setAdd(null)} triggerRef={addTrigger}
      onBrowseLibrary={() => setAdd("library")} onSaveSource={async ({ resourceId, sourceUrl }, sourceMode) => {
        if (!resourceId && sourceUrl) {
          const { preview } = await folderRequest<{ preview: SourcePreview }>("/api/v1/source-discovery/resolve", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: sourceMode, url: sourceUrl, correlationId: crypto.randomUUID() }),
          });
          resourceId = preview.resourceId;
        }
        if (!resourceId) throw new Error("This source is unavailable.");
        await change(folderId, { action: "save-resource", resourceId });
      }} /> : null}
    {add === "library" ? <AddFolderContent folderId={folderId} onClose={() => setAdd(null)} /> : null}
    {itemOptions ? <SessionFolderItemOptions title={itemOptions.title} onClose={() => setItemOptions(null)}>
      <button type="button" className="is-danger" disabled={pending} onClick={() => void remove(itemOptions)}>{itemOptions.saved ? "Remove saved material" : "Unfile session"}</button>
      {error ? <p role="alert" className="session-folder-error">{error}</p> : null}
    </SessionFolderItemOptions> : null}
    {conflict ? <FolderDialog title="Move the existing session?" onClose={() => setConflict(null)}>
      <p>{conflict.message} Move it here to continue from the same place.</p>
      <div className="session-folder-actions">
        <button type="button" onClick={() => setConflict(null)}>Cancel</button>
        <button className="is-primary" type="button" disabled={opening} onClick={() => void open(conflict.item, conflict.anchor, { folderId: conflict.folderId, sessionId: conflict.sessionId })}>Move and continue</button>
      </div>
    </FolderDialog> : null}
  </main>;
}

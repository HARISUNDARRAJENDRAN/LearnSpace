"use client";

import { ArrowDown, ArrowUp, Share2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ShareFolderDialog } from "./ShareFolderDialog";
import { useSessionFolders } from "./state";

export function FolderDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector("input")?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected && !document.querySelector("dialog[open]") && document.activeElement === document.body) trigger.focus();
      });
    };
  }, []);
  return <dialog ref={ref} className="session-folder-dialog" aria-labelledby={titleId} onClose={onClose}>
    <header><h2 id={titleId}>{title}</h2><button className="session-folder-icon" type="button" aria-label="Close dialog" onClick={() => ref.current?.close()}><X aria-hidden="true" /></button></header>
    {children}
  </dialog>;
}

export function FolderEditor({ folder, session, onClose, onSaved }: {
  folder?: { id: string; title: string; description?: string | null };
  session?: { id: string; folderId: string | null };
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { create, change, pending } = useSessionFolders();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title")).trim();
    if (!title) { setError("Enter a folder name."); return; }
    const description = String(form.get("description") ?? "").trim() || null;
    setError("");
    try {
      if (folder) {
        await change(folder.id, { action: "edit", title, description });
        onClose();
      } else {
        const membership = session ? { sessionId: session.id, fromFolderId: session.folderId } : {};
        const { id } = await create({ title, description, ...membership });
        onClose();
        onSaved?.(id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The folder could not be saved."); }
  }
  return <FolderDialog title={folder ? "Edit folder" : session ? "Create folder and move session" : "New folder"} onClose={onClose}>
    <form className="session-folder-form" onSubmit={submit}>
      <label>Folder name<input name="title" required maxLength={120} defaultValue={folder?.title} /></label>
      <label>Description <span>(optional)</span><textarea name="description" rows={3} maxLength={1000} defaultValue={folder?.description ?? ""} /></label>
      {error ? <p role="alert" className="session-folder-error">{error}</p> : null}
      <div className="session-folder-actions"><button type="button" onClick={onClose}>Cancel</button><button className="is-primary" type="submit" disabled={pending}>{folder ? "Save changes" : "Create folder"}</button></div>
    </form>
  </FolderDialog>;
}

export function MoveSessionDialog({ session, onClose }: { session: { id: string; title: string }; onClose: () => void }) {
  const { folders, folderBySession, change, pending, loading, failed, refresh } = useSessionFolders();
  const [create, setCreate] = useState(false);
  const [destination, setDestination] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = folderBySession.get(session.id) ?? null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      if (destination === "unfile" && source) await change(source, { action: "unfile-session", sessionId: session.id });
      else if (destination) await change(destination, { action: "move-session", sessionId: session.id, fromFolderId: source });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The session could not be moved."); }
  }
  if (create) return <FolderEditor session={{ id: session.id, folderId: source }} onClose={onClose} />;
  return <FolderDialog title="Move to folder" onClose={onClose}>
    <form className="session-folder-form" onSubmit={submit}>
      <p>{session.title}</p>
      {failed ? <button type="button" onClick={() => void refresh()}>Retry loading folders</button> : null}
      <label>Destination<select value={destination} onChange={(event) => { setDestination(event.target.value); setSource(current); }} disabled={loading}>
        <option value="">{loading ? "Loading folders…" : "Choose a folder"}</option>
        {current ? <option value="unfile">Unfiled sessions</option> : null}
        {folders.filter((folder) => folder.id !== current).map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}
      </select></label>
      {destination && source !== current ? <p role="status">This session moved. Choose a destination again.</p> : null}
      {error ? <p role="alert" className="session-folder-error">{error}</p> : null}
      <div className="session-folder-actions">
        <button type="button" disabled={loading || failed || pending} onClick={() => { setSource(current); setCreate(true); }}>New folder</button>
        <button type="submit" className="is-primary" disabled={pending || failed || !destination || source !== current}>Move session</button>
      </div>
    </form>
  </FolderDialog>;
}

export function FolderOptions({ folder, onClose, onDeleted }: {
  folder: { id: string; title: string; description?: string | null };
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { folders, change, remove, pending } = useSessionFolders();
  const [view, setView] = useState<"options" | "edit" | "share" | "delete">("options");
  const [error, setError] = useState("");
  const index = folders.findIndex(({ id }) => id === folder.id);
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError("");
    try { await action(); after?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The folder could not be updated."); }
  }
  if (view === "edit") return <FolderEditor folder={folder} onClose={onClose} />;
  if (view === "share") return <ShareFolderDialog folder={folder} onClose={onClose} />;
  return <FolderDialog title={view === "delete" ? "Delete folder?" : `Options for ${folder.title}`} onClose={onClose}>
    {view === "delete" ? <>
      <p>Delete “{folder.title}”? Its sessions will become unfiled. Their progress, notes, and conversations will still be available.</p>
      <div className="session-folder-actions">
        <button type="button" onClick={() => setView("options")}>Cancel</button>
        <button type="button" className="is-danger" disabled={pending} onClick={() => void run(() => remove(folder.id), () => { onClose(); onDeleted?.(); })}>Delete folder</button>
      </div>
    </> : <div className="session-folder-options">
      <button type="button" disabled={pending} onClick={() => setView("share")}><Share2 aria-hidden="true" />Share folder link…</button>
      <button type="button" disabled={pending} onClick={() => setView("edit")}>Edit name and description</button>
      <button type="button" disabled={pending || index < 1} onClick={() => void run(() => change(folder.id, { action: "reorder-folder", direction: "up" }))}><ArrowUp aria-hidden="true" />Move folder up</button>
      <button type="button" disabled={pending || index < 0 || index === folders.length - 1} onClick={() => void run(() => change(folder.id, { action: "reorder-folder", direction: "down" }))}><ArrowDown aria-hidden="true" />Move folder down</button>
      <button type="button" className="is-danger" disabled={pending} onClick={() => setView("delete")}>Delete folder…</button>
    </div>}
    {error ? <p role="alert" className="session-folder-error">{error}</p> : null}
  </FolderDialog>;
}

export function SessionFolderItemOptions({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <FolderDialog title={`Options for ${title}`} onClose={onClose}><div className="session-folder-options">{children}</div></FolderDialog>;
}

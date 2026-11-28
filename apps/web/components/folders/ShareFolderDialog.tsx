"use client";

import type { FolderShareState } from "@learnspace/shared";
import { Check, Copy, Link2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FolderDialog } from "./FolderDialogs";
import { folderRequest } from "./state";

export function ShareFolderDialog({
  folder,
  onClose,
}: {
  folder: { id: string; title: string };
  onClose: () => void;
}) {
  const [state, setState] = useState<FolderShareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/v1/session-folders/${folder.id}/share`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    folderRequest<FolderShareState>(endpoint, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setState(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not load share settings.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint]);

  async function enableOrRotate(rotate: boolean) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const next = await folderRequest<FolderShareState>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate }),
      });
      setState(next);
      setConfirmRotate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the share link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const next = await folderRequest<FolderShareState>(endpoint, { method: "DELETE" });
      setState(next);
      setConfirmRotate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disable the share link.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!state?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy automatically. Select the link and copy it manually.");
    }
  }

  return (
    <FolderDialog title={`Share “${folder.title}”`} onClose={onClose}>
      <div className="session-folder-share">
        <p className="session-folder-share-note">
          <ShieldCheck aria-hidden="true" />
          <span>
            Recipients sign in to LearnSpace and get their own copy of this folder and its materials. Your notes, AI chats, and progress stay private.
          </span>
        </p>

        {loading ? (
          <p role="status" className="session-folder-share-status">Loading share link…</p>
        ) : state?.enabled && state.shareUrl ? (
          <>
            <label className="session-folder-share-field">
              <span>Share link</span>
              <div className="session-folder-share-row">
                <input
                  type="text"
                  readOnly
                  value={state.shareUrl}
                  aria-label="Share link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="session-folder-button is-primary"
                  onClick={() => void copyLink()}
                  disabled={busy}
                >
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </label>

            {confirmRotate ? (
              <div className="session-folder-confirm">
                <p>Generating a new link will immediately stop the current link from working for new recipients.</p>
                <div className="session-folder-actions">
                  <button type="button" onClick={() => setConfirmRotate(false)} disabled={busy}>Cancel</button>
                  <button type="button" className="is-primary" onClick={() => void enableOrRotate(true)} disabled={busy}>
                    {busy ? "Resetting…" : "Generate new link"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="session-folder-actions session-folder-share-controls">
                <button type="button" onClick={() => setConfirmRotate(true)} disabled={busy}>
                  <RefreshCw aria-hidden="true" />
                  Reset link
                </button>
                <button type="button" className="is-danger" onClick={() => void revoke()} disabled={busy}>
                  <Trash2 aria-hidden="true" />
                  Disable link
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="session-folder-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void enableOrRotate(false)}
              disabled={busy}
            >
              <Link2 aria-hidden="true" />
              {busy ? "Creating link…" : "Create share link"}
            </button>
          </div>
        )}

        {error ? <p role="alert" className="session-folder-error">{error}</p> : null}
      </div>
    </FolderDialog>
  );
}

"use client";

import type { FolderShareState } from "@learnspace/shared";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/v1/session-folders/${folder.id}/share`;

  const loadShareLink = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const value = await folderRequest<FolderShareState>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate: false }),
        ...(signal ? { signal } : {}),
      });
      if (!signal?.aborted) setState(value);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not load the share link.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void loadShareLink(controller.signal);
    return () => controller.abort();
  }, [loadShareLink]);

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
        {loading ? (
          <p role="status" className="session-folder-share-status">Preparing share link…</p>
        ) : state?.shareUrl ? (
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
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </label>
        ) : (
          <div className="session-folder-actions">
            <button type="button" onClick={onClose}>Close</button>
            <button type="button" className="is-primary" onClick={() => void loadShareLink()}>
              Try again
            </button>
          </div>
        )}

        {error ? <p role="alert" className="session-folder-error">{error}</p> : null}
      </div>
    </FolderDialog>
  );
}

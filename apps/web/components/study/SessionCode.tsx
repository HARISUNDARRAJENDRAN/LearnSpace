"use client";

import { CODE_LANGUAGES, type CodeLanguage } from "@learnspace/shared";
import Editor from "@monaco-editor/react";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { codeLanguageLabels, type SessionCodeDraft } from "./tools";
import type { SaveStatus } from "./useWorkspaceSave";

const statusLabel: Record<SaveStatus, string> = { saved: "Saved", saving: "Saving…", error: "Not saved yet, retrying" };

/**
 * The session's code scratchpad. The draft lives with the session (VideoSession autosaves it), so it is there on every device.
 * The editor owns its text once loaded (a controlled value would fight Monaco's own cursor and auto-closing while typing).
 */
export function SessionCode({ draft, status, onChange, onCollapse }: { draft: SessionCodeDraft; status: SaveStatus; onChange: (draft: SessionCodeDraft) => void; onCollapse: () => void }) {
  return (
    <div className="session-tool session-code">
      <SessionPanelHeader title="Code" onCollapse={onCollapse}>
        <span className={`session-save-status${status === "error" ? " is-error" : ""}`} role="status" aria-live="polite">{draft.code || status !== "saved" ? statusLabel[status] : ""}</span>
        <label className="sr-only" htmlFor="session-code-language">Language</label>
        <select id="session-code-language" className="session-select" value={draft.language} onChange={(event) => onChange({ ...draft, language: event.target.value as CodeLanguage })}>
          {CODE_LANGUAGES.map((language) => <option key={language} value={language}>{codeLanguageLabels[language]}</option>)}
        </select>
      </SessionPanelHeader>
      <div className="session-code-editor">
        <Editor language={draft.language} defaultValue={draft.code} onChange={(code) => onChange({ ...draft, code: code ?? "" })} loading={<span className="session-muted">Loading editor…</span>} options={{ automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12 }, tabSize: 4, wordWrap: "on" }} />
      </div>
    </div>
  );
}

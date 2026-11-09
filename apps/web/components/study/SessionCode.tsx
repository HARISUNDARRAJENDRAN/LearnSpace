"use client";

import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { SessionPanelHeader } from "./SessionPanelHeader";

const languages = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
] as const;

type Draft = { language: string; code: string };

// shortcut: the scratchpad lives in this browser only; move it to the session once the backend stores code.
function readDraft(key: string): Draft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value && typeof value === "object" && "language" in value && "code" in value && typeof value.language === "string" && typeof value.code === "string") return { language: value.language, code: value.code };
  } catch {}
  return { language: "python", code: "" };
}

export function SessionCode({ sessionId, onCollapse }: { sessionId: string; onCollapse: () => void }) {
  const key = `learnspace:session-code:${sessionId}`;
  const [draft, setDraft] = useState<Draft>({ language: "python", code: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setDraft(readDraft(key));
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch {}
  }, [draft, key, loaded]);

  return (
    <div className="session-tool session-code">
      <SessionPanelHeader title="Code" onCollapse={onCollapse}>
        <label className="sr-only" htmlFor="session-code-language">Language</label>
        <select id="session-code-language" className="session-select" value={draft.language} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))}>
          {languages.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
        </select>
      </SessionPanelHeader>
      <div className="session-code-editor">
        {loaded ? <Editor language={draft.language} value={draft.code} onChange={(code) => setDraft((current) => ({ ...current, code: code ?? "" }))} loading={<span className="session-muted">Loading editor…</span>} options={{ automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 12 }, tabSize: 4, wordWrap: "on" }} /> : null}
      </div>
    </div>
  );
}

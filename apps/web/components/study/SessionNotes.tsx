"use client";

import type { StudyNotesKind, StudyNotesResponse } from "@learnspace/shared";
import { Copy, RotateCw } from "lucide-react";
import { useState } from "react";
import { postStudyAction, StudyToolUnavailableError } from "./session-api";
import { SessionPanelHeader } from "./SessionPanelHeader";

type NotesState = { status: "idle" | "loading" | "unavailable" | "error" } | { status: "ready"; content: string };

const kinds: Record<StudyNotesKind, { label: string; action: string; description: string }> = {
  primer: { label: "Primer", action: "Generate primer", description: "A short briefing to read before you watch: the key terms, the questions this video answers, and what to look out for." },
  summary: { label: "Summary", action: "Summarize video", description: "Condensed notes of the whole video, organised by section, so you can review it without rewatching." },
};

export function SessionNotes({ sessionId, onCollapse }: { sessionId: string; onCollapse: () => void }) {
  const [kind, setKind] = useState<StudyNotesKind>("primer");
  const [notes, setNotes] = useState<Record<StudyNotesKind, NotesState>>({ primer: { status: "idle" }, summary: { status: "idle" } });
  const current = notes[kind];

  async function generate(target: StudyNotesKind) {
    setNotes((all) => ({ ...all, [target]: { status: "loading" } }));
    try {
      const value = await postStudyAction<StudyNotesResponse>(sessionId, "notes", { kind: target });
      setNotes((all) => ({ ...all, [target]: { status: "ready", content: value.content } }));
    } catch (error) {
      setNotes((all) => ({ ...all, [target]: { status: error instanceof StudyToolUnavailableError ? "unavailable" : "error" } }));
    }
  }

  return (
    <div className="session-tool">
      <SessionPanelHeader title="Notes" onCollapse={onCollapse}>
        {current.status === "ready" ? <><button className="session-icon-button" type="button" aria-label="Copy notes" title="Copy" onClick={() => void navigator.clipboard?.writeText(current.content)}><Copy aria-hidden="true" /></button><button className="session-icon-button" type="button" aria-label="Regenerate" title="Regenerate" onClick={() => void generate(kind)}><RotateCw aria-hidden="true" /></button></> : null}
      </SessionPanelHeader>
      <div className="session-tool-body" data-lenis-prevent>
        <fieldset className="session-segmented">
          <legend className="sr-only">Notes type</legend>
          {(Object.keys(kinds) as StudyNotesKind[]).map((option) => <button key={option} className={kind === option ? "is-active" : ""} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}>{kinds[option].label}</button>)}
        </fieldset>
        {current.status === "ready" ? <div className="session-notes-content">{current.content}</div> : (
          <div className="session-tool-empty">
            <p>{kinds[kind].description}</p>
            <button className="session-primary-button" type="button" disabled={current.status === "loading"} onClick={() => void generate(kind)}>{current.status === "loading" ? "Writing…" : kinds[kind].action}</button>
            {current.status === "unavailable" ? <p className="session-tool-message" role="status">{kinds[kind].label} notes aren&apos;t available for sessions yet.</p> : null}
            {current.status === "error" ? <p className="session-tool-message is-error" role="alert">These notes could not be written right now.</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

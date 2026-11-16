"use client";

import type { StudyAnchor } from "@learnspace/shared";
import { applyNoteOps, type LessonControl, type NoteBlock, type NoteOp, type NotesGuideStatus, type NotesView, type ScribeEvent } from "@learnspace/shared/notes";
import { Copy, Moon, Sun, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiriOrb } from "../ui/siri-orb";
import { CALLOUT, NotesEditor } from "./NotesEditor";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { type LessonState, useLunaVoice, type VoiceState } from "./useLunaVoice";

type Theme = "light" | "dark";
// The page fills in as the learner thinks out loud: the scribe writes once the talk pauses for this long (it took 4 s
// before the scribe itself got faster), and at once when they ask for a change to the notes.
const SCRIBE_AFTER_MS = 1_500;
const SCRIBE_NOW_MS = 250;
const ASKS_FOR_NOTES = /\b(note|notes|write|jot|add|put|save|insert|record|remember|change|update|rewrite|simplif\w*|fix|delete|remove|diagram|table|summar\w*|takeaway)\b/i;
// Saves that fail for a passing reason (offline, a deploy, a busy server) are retried until they land, at most this far apart.
const RETRY_MAX_MS = 15_000;
const status: Record<VoiceState, string> = { off: "Luny is off · tap to talk", loading: "Getting Luny ready…", listening: "Listening", thinking: "Thinking…", speaking: "Speaking" };
const ORB_SIZE = 250;
// Seconds per turn of the orb: it quickens while Luny listens, thinks or speaks.
const orbSpeed: Record<VoiceState, number> = { off: 20, loading: 14, listening: 10, thinking: 6, speaking: 4 };
const backoff =(attempt: number) => Math.min(1_000 * 2 ** attempt, RETRY_MAX_MS);
/** Statuses where trying again can work: offline (no response), timeouts, rate limits and server errors. */
const transient = (status: number | null) => status === null || status === 408 || status === 429 || status >= 500;
// While the study guide is being written the page checks back this often; while the transcript is still coming, less often.
const GUIDE_POLL_MS: Partial<Record<NotesGuideStatus, number>> = { writing: 4_000, waiting: 15_000 };
const guideNotice: Partial<Record<NotesGuideStatus, string>> = {
  writing: "Luny is writing your study guide for this video…",
  waiting: "Your study guide will be written as soon as this video's transcript is ready.",
  unavailable: "This video has no transcript, so it has no study guide. Talk it through with Luny to build your notes.",
  failed: "Your study guide couldn't be written just now.",
};
const fenced = (text: string) => { const [language = "", ...code] = text.split("\n"); return `\`\`\`${language.trim()}\n${code.join("\n")}\n\`\`\``; };

export const notesMarkdown = (title: string, blocks: NoteBlock[]) => [`# ${title}`, ...blocks.map((block) => block.type === "heading" ? `## ${block.text}`
  : block.type === "subheading" ? `### ${block.text}`
  : block.type === "task" ? `- [${block.done ? "x" : " "}] ${block.text}`
  : block.type === "bullet" ? `- ${block.text}`
  : block.type === "step" ? `1. ${block.text}`
  : CALLOUT[block.type] ? `> **${CALLOUT[block.type]}:** ${block.text}`
  : block.type === "code" ? fenced(block.text)
  : block.type === "idea" || block.type === "question" ? `> ${block.text}`
  : block.type === "diagram" ? `\`\`\`json\n${block.text}\n\`\`\``
  : block.type === "image" || block.type === "link" ? `${block.type === "image" ? "!" : ""}[${block.text.split("\n").slice(1).join(" ")}](${block.text.split("\n")[0]})`
  : block.text)].join("\n\n");

/** Reads an NDJSON body, one event per line, as it arrives. */
async function readLines<T>(body: ReadableStream<Uint8Array<ArrayBuffer>>, handle: (event: T) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) handle(JSON.parse(line) as T);
      }
    }
    if (buffer.trim()) handle(JSON.parse(buffer) as T);
  } finally {
    reader.releaseLock();
  }
}

export type NotesTutor = {
  lesson: () => LessonState;
  capture: () => string | null;
  onControl: (control: LessonControl) => void;
  onTurn: () => void;
  onGo: (place: StudyAnchor) => void;
  sharing: boolean;
  shareError: string | null;
  onShare: () => void;
  /** Whether Luny is on (listening, thinking or speaking), so the lesson can show it while Notes is hidden. */
  onVoice?: (on: boolean) => void;
};

export function SessionNotes({ sessionId, title, active = true, tutor, onCollapse }: { sessionId: string; title: string; active?: boolean; tutor: NotesTutor; onCollapse: () => void }) {
  const [notes, setNotes] = useState<NotesView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  // The footnote shows the result for a moment, then the lesson clock again.
  useEffect(() => { if (!copyStatus) return; const timer = setTimeout(() => setCopyStatus(""), 2_000); return () => clearTimeout(timer); }, [copyStatus]);
  // Notes always open light; dark lasts only until Notes is opened again.
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => { if (active) setTheme("light"); }, [active]);
  const revisionRef = useRef(-1);
  const receive = useCallback((value: NotesView) => { if (value.revision >= revisionRef.current) { revisionRef.current = value.revision; setNotes(value); } }, []);
  // The scribe's edits as it writes them, shown on the notes they were made against until the saved pass arrives.
  const [preview, setPreview] = useState<{ base: number; ops: NoteOp[] } | null>(null);
  const edits = useRef<Promise<void>>(Promise.resolve());
  function edit(body: { ops: NoteOp[] } | { action: "undo" }) {
    // One request at a time, in order, so a quick run of edits lands as it was made.
    const requests = "ops" in body ? Array.from({ length: Math.ceil(body.ops.length / 20) }, (_, at) => ({ ops: body.ops.slice(at * 20, at * 20 + 20) })) : [body];
    edits.current = edits.current.then(async () => {
      for (const request of requests) {
        // Every op names its block, so a request that landed but whose answer was lost changes nothing when sent again.
        for (let attempt = 0; ; attempt++) {
          const response = await fetch(`/api/v1/study-sessions/${sessionId}/notes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }).catch(() => null);
          if (response?.ok) { setFailed(null); receive(await response.json() as NotesView); break; }
          const error = await response?.json().catch(() => null);
          if (!transient(response?.status ?? null)) { setFailed(error?.error?.message ?? "That change couldn't be saved."); break; }
          setFailed("Saving… your change is kept until it's saved.");
          await new Promise((resolve) => window.setTimeout(resolve, backoff(attempt)));
        }
      }
    });
  }

  // The server saves each exchange as it happens; once the talk pauses, the scribe writes it up.
  const scribe = useRef<{ timer?: number; running: boolean; again: boolean; attempt: number }>({ running: false, again: false, attempt: 0 });
  const runScribe = useCallback(async () => {
    const state = scribe.current;
    if (state.running) { state.again = true; return; }
    state.running = true;
    setWriting(true);
    let retry = false;
    try {
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/notes/consolidate`, { method: "POST", headers: { Accept: "application/x-ndjson" } }).catch(() => null);
      // The pass streams: each edit is shown as soon as it is written, and the saved notes replace them at the end.
      let status: number | null = response?.ok ? 200 : response?.status ?? null;
      let saved = false;
      if (response?.ok && response.body) {
        status = null;
        await readLines(response.body, (event: ScribeEvent) => {
          if (event.type === "op") setPreview((current) => current?.base === event.base ? { base: current.base, ops: [...current.ops, event.op] } : { base: event.base, ops: [event.op] });
          else if (event.type === "notes") { receive(event.notes); saved = true; }
          else status = event.status;
        }).catch(() => undefined);
      }
      if (saved) state.attempt = 0;
      // A failed pass is tried again on its own, a few times; the next exchange would also bring it up to date.
      else retry = transient(status) && state.attempt < 3;
    } finally {
      setPreview(null);
      state.running = false;
      setWriting(false);
      if (state.again) { state.again = false; void runScribe(); }
      else if (retry) { window.clearTimeout(state.timer); state.timer = window.setTimeout(() => { void runScribe(); }, backoff(++state.attempt + 1)); }
    }
  }, [receive, sessionId]);
  const onExchange = useCallback((utterance: string | null) => {
    window.clearTimeout(scribe.current.timer);
    scribe.current.timer = window.setTimeout(() => { void runScribe(); }, utterance && ASKS_FOR_NOTES.test(utterance) ? SCRIBE_NOW_MS : SCRIBE_AFTER_MS);
  }, [runScribe]);
  useEffect(() => () => window.clearTimeout(scribe.current.timer), []);

  const voice = useLunaVoice({ sessionId, lesson: tutor.lesson, capture: tutor.capture, onControl: tutor.onControl, onTurn: tutor.onTurn, onExchange });
  // Opening Notes starts Luny, and she stays in the conversation while the learner watches the video or uses another tool;
  // only turning her off (which is remembered until they turn her on again) or leaving the lesson hangs up.
  const { start, stop } = voice;
  const turnedOff = useRef(false);
  useEffect(() => { if (active && !turnedOff.current) void start(); }, [active, start]);
  const onVoice = tutor.onVoice;
  const live = voice.state !== "off";
  useEffect(() => { onVoice?.(live); }, [live, onVoice]);
  useEffect(() => () => onVoice?.(false), [onVoice]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/study-sessions/${sessionId}/notes`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("notes");
      receive(await response.json() as NotesView);
    }).catch(() => { if (!controller.signal.aborted) setFailed("Your notes couldn't load. Reopen Notes to try again."); });
    return () => controller.abort();
  }, [sessionId, receive]);
  // The lesson page starts the guide as it opens; Notes starts one that could not be started then, and checks back while it is written.
  const guide = notes?.guide;
  const writeGuide = useCallback(() => {
    void fetch(`/api/v1/study-sessions/${sessionId}/notes/guide`, { method: "POST" }).then(async (response) => { if (response.ok) receive(await response.json() as NotesView); }, () => undefined);
  }, [receive, sessionId]);
  useEffect(() => { if (guide === "pending") writeGuide(); }, [guide, writeGuide]);
  useEffect(() => {
    const every = guide ? GUIDE_POLL_MS[guide] : undefined;
    if (!every) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/v1/study-sessions/${sessionId}/notes`).then(async (response) => { if (response.ok) receive(await response.json() as NotesView); }, () => undefined);
    }, every);
    return () => window.clearInterval(timer);
  }, [guide, receive, sessionId]);
  // The page shows the scribe's edits as they are written, on the notes they were made against.
  const shown = useMemo(() => {
    if (!notes || !preview || preview.base !== notes.revision) return notes ? { blocks: notes.blocks, revision: notes.revision } : null;
    return { blocks: applyNoteOps(notes.blocks, preview.ops, "luna", notes.revision + 1, preview.base).blocks, revision: notes.revision + 1 };
  }, [notes, preview]);
  const blocks = shown?.blocks ?? [];
  const on = voice.state !== "off";
  const waiting = voice.state === "loading";
  // Sharing the tab needs this click, so starting Luny by hand also asks to share the lesson when it isn't yet.
  const toggle = () => {
    turnedOff.current = on;
    if (on) stop();
    else { void start(); if (!tutor.sharing) tutor.onShare(); }
  };
  const label = copyStatus || (waiting && voice.progress !== null ? `Getting Luny ready… ${voice.progress}%` : writing && voice.state === "listening" ? "Writing your notes…" : status[voice.state]);
  return <div className={`session-tool notes-tool${blocks.length ? " has-notes" : ""}`} data-theme={theme}>
    <SessionPanelHeader title="Notes" onCollapse={onCollapse}>
      <button className="session-icon-button" type="button" aria-label={theme === "light" ? "Use dark theme" : "Use light theme"} title={theme === "light" ? "Dark theme" : "Light theme"} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</button>
      <button className="session-icon-button" type="button" aria-label="Undo Luny's last edit" title="Undo last edit" disabled={!notes?.canUndo} onClick={() => edit({ action: "undo" })}><Undo2 aria-hidden="true" /></button>
      <button className="session-icon-button" type="button" aria-label="Copy notes" title="Copy as Markdown" disabled={!blocks.length} onClick={() => { void navigator.clipboard.writeText(notesMarkdown(title, blocks)).then(() => setCopyStatus("Copied"), () => setCopyStatus("Copy failed")); }}><Copy aria-hidden="true" /></button>
    </SessionPanelHeader>
    <div className="session-tool-body notes-body" data-lenis-prevent>
      <section className="notes-hero" aria-label="Luny">
        <button className="notes-orb" type="button" data-state={voice.state} aria-pressed={on} aria-label={on ? "End the talk with Luny" : "Talk to Luny"} title={status[voice.state]} onClick={toggle}>
          <SiriOrb size={ORB_SIZE} animationDuration={orbSpeed[voice.state]} />
        </button>
        {/* One quiet line says what Luny is doing: listening, thinking, speaking, or writing the notes. */}
        <p className="notes-orb-status" data-state={writing && voice.state === "listening" ? "writing" : voice.state} role="status" aria-live="polite">{label}</p>
      </section>
      {voice.error ? <p className="session-tool-message is-error" role="alert">{voice.error}</p> : null}
      {tutor.shareError ? <p className="session-tool-message is-error notes-share" role="alert">{tutor.shareError} <button type="button" onClick={tutor.onShare}>Share this tab</button></p> : null}
      {notes === null && !failed ? <p className="notes-loading" role="status">Opening your page…</p> : <article className="notes-document" aria-busy={guide === "writing"}>
        <h2 className="notes-title">{title}</h2>
        {guide && guideNotice[guide] ? <p className={`notes-guide is-${guide}`} role="status">{guideNotice[guide]}{guide === "failed" ? <> <button type="button" onClick={writeGuide}>Try again</button></> : null}</p> : null}
        <NotesEditor blocks={blocks} revision={shown?.revision ?? 0} onOps={(ops) => edit({ ops })} onGo={tutor.onGo} />
      </article>}
      {failed ? <p className="session-tool-message is-error" role="alert">{failed}</p> : null}
    </div>
  </div>;
}

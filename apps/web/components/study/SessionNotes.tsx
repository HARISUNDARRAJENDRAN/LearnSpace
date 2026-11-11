"use client";

import type { NoteBlock, NoteBlockType, NoteOp, NotesSpatial, NotesView, TutorVisual } from "@learnspace/shared/notes";
import { ArrowUp, Copy, Eye, Mic, MicOff, PenLine, Pencil, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrbBloop } from "../ui/orb-bloop";
import { NoteMedia } from "./NoteMedia";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { useVoiceCompanion, type VoiceState } from "./voice/useVoiceCompanion";

const tags: Partial<Record<NoteBlockType, string>> = { idea: "Idea", decision: "Decided", question: "Open" };
const status: Record<VoiceState, string> = { off: "Your thoughts, a little clearer.", loading: "Getting your voice ready…", listening: "I'm listening", hearing: "Go on, I'm with you", thinking: "Connecting the dots…", speaking: "Speak any time to interrupt" };
const op = (value: Partial<NoteOp> & Pick<NoteOp, "action" | "id">): NoteOp => ({ after: null, type: null, text: null, done: null, ...value });
export const notesMarkdown = (blocks: NoteBlock[]) => blocks.map((block) => block.type === "heading" ? `## ${block.text}`
  : block.type === "task" ? `- [${block.done ? "x" : " "}] ${block.text}`
  : block.type === "diagram" ? `\`\`\`json\n${block.text}\n\`\`\``
  : block.type === "image" || block.type === "link" ? `${block.type === "image" ? "!" : ""}[${block.text.split("\n").slice(1).join(" ")}](${block.text.split("\n")[0]})`
  : block.type === "paragraph" ? block.text : `- ${tags[block.type] ? `**${tags[block.type]}:** ` : ""}${block.text}`).join("\n\n");

function Block({ block, fresh, editing, onEdit }: { block: NoteBlock; fresh: boolean; editing: boolean; onEdit: (op: NoteOp) => void }) {
  const media = block.type === "diagram" || block.type === "image" || block.type === "link";
  return <li className={`notes-block is-${block.type}${block.by === "luna" ? " is-luna" : ""}${fresh ? " is-fresh" : ""}`}>
    {block.type === "task" ? <input type="checkbox" checked={block.done} aria-label={`Complete ${block.text}`} onChange={(event) => onEdit(op({ action: "update", id: block.id, done: event.target.checked }))} /> : null}
    {tags[block.type] ? <span className="notes-tag">{tags[block.type]}</span> : null}
    {editing ? <textarea className="notes-block-text" defaultValue={block.text} rows={media ? 3 : 1} aria-label={`${tags[block.type] ?? block.type} note`}
      onBlur={(event) => { const text = event.target.value.trim(); if (!text) onEdit(op({ action: "delete", id: block.id })); else if (text !== block.text) onEdit(op({ action: "update", id: block.id, text })); }}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} />
      : media ? <NoteMedia type={block.type as "image" | "link" | "diagram"} text={block.text} /> : <p className="notes-block-copy">{block.text}</p>}
    {editing ? <button className="notes-block-delete" type="button" aria-label="Delete note" onClick={() => onEdit(op({ action: "delete", id: block.id }))}><X aria-hidden="true" /></button> : null}
  </li>;
}

export type NotesTutor = { spatial: () => NotesSpatial; onVisual: (visual: TutorVisual) => void; sharing: boolean; shareError: string | null; onShare: () => void; onStopShare: () => void; drawing: boolean; onToggleDraw: () => void; onClear: () => void };

export function SessionNotes({ sessionId, currentMs, active = true, tutor, onCollapse }: { sessionId: string; currentMs: number; active?: boolean; tutor?: NotesTutor; onCollapse: () => void }) {
  const [notes, setNotes] = useState<NotesView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const positionRef = useRef(currentMs); positionRef.current = currentMs;
  const revisionRef = useRef(-1);
  const receive = useCallback((value: NotesView) => { if (value.revision >= revisionRef.current) { revisionRef.current = value.revision; setNotes(value); } }, []);
  const edits = useRef<Promise<void>>(Promise.resolve());
  function edit(body: { ops: NoteOp[] } | { action: "undo" }) {
    // Preserve the learner's edit order, including quick checkbox changes and edits made as a voice turn finishes.
    edits.current = edits.current.then(async () => {
      setFailed(null);
      try {
        const response = await fetch(`/api/v1/study-sessions/${sessionId}/notes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error?.message ?? "That change couldn't be saved. Try again."); }
        receive(await response.json() as NotesView);
      } catch (cause) { setFailed(cause instanceof Error ? cause.message : "That change couldn't be saved. Try again."); }
    });
  }
  const commandRef = useRef((utterance: string) => {
    if (/^(?:please )?undo(?: that| the last (?:edit|change))?[.!?]?$/i.test(utterance.trim())) { edit({ action: "undo" }); return true; }
    return false;
  });
  commandRef.current = (utterance) => { if (/^(?:please )?undo(?: that| the last (?:edit|change))?[.!?]?$/i.test(utterance.trim())) { edit({ action: "undo" }); return true; } return false; };
  const voice = useVoiceCompanion({ sessionId, positionMs: useCallback(() => positionRef.current, []), onNotes: receive, ...(tutor ? { spatial: tutor.spatial, onVisual: tutor.onVisual } : {}), onCommand: (utterance) => commandRef.current(utterance) });
  useEffect(() => { if (!active) voice.stop(); }, [active, voice.stop]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/study-sessions/${sessionId}/notes`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("notes");
      receive(await response.json() as NotesView);
    }).catch(() => { if (!controller.signal.aborted) setFailed("Your notes couldn't load. Reopen Notes to try again."); });
    return () => controller.abort();
  }, [sessionId, receive]);
  const blocks = notes?.blocks ?? [];
  return <div className={`session-tool notes-tool${blocks.length ? " has-notes" : ""}`}>
    <SessionPanelHeader title="Notes" onCollapse={onCollapse}>
      <button className="session-icon-button" type="button" aria-label="Undo Luna's last edit" title="Undo last edit · or say ‘undo that’" disabled={!notes?.canUndo} onClick={() => edit({ action: "undo" })}><Undo2 aria-hidden="true" /></button>
      <button className="session-icon-button" type="button" aria-label="Copy notes" title="Copy as Markdown" disabled={!blocks.length} onClick={() => { void navigator.clipboard.writeText(notesMarkdown(blocks)).then(() => setCopyStatus("Copied"), () => setCopyStatus("Copy failed")); }}><Copy aria-hidden="true" /></button>
    </SessionPanelHeader>
    <div className="session-tool-body notes-body" data-lenis-prevent>
      <section className={`notes-hero is-${voice.state}`} aria-label="Luna voice companion">
        <div className="notes-eyebrow"><span /> LUNA <span className="notes-eyebrow-divider">/</span> YOUR THINKING PARTNER</div>
        <button className="notes-orb-button" type="button" aria-pressed={voice.enabled} aria-label={voice.enabled ? "Stop talking with Luna" : "Talk with Luna"} onClick={() => voice.enabled ? voice.stop() : void voice.start()}>
          <OrbBloop state={voice.state} size={blocks.length ? 112 : 176} level={voice.level} />
        </button>
        <h2>{blocks.length ? status[voice.state] : voice.enabled ? status[voice.state] : "A little room to think."}</h2>
        {!blocks.length ? <p className="notes-hero-description">Think out loud. I'll keep the thread.<br />We can write, draw, and work it out together.</p> : null}
        <button className={`notes-connect${voice.enabled ? " is-on" : ""}`} type="button" onClick={() => voice.enabled ? voice.stop() : void voice.start()}>{voice.enabled ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}{voice.enabled ? "End voice session" : "Let's talk"}</button>
        {voice.progress !== null ? <p className="notes-download" role="status">Preparing voice · {voice.progress}%</p> : null}
        {voice.latencyMs !== null && voice.enabled ? <span className="notes-latency" title="Time from the end of your speech to Luna's first sound">{(voice.latencyMs / 1000).toFixed(1)} s response</span> : null}
      </section>
      {notes === null && !failed ? <p className="notes-loading" role="status">Opening your page…</p> : null}
      <ol className="notes-page" aria-label="Notes">{blocks.map((block) => <Block key={`${block.id}:${block.rev}`} block={block} fresh={block.by === "luna" && block.rev === notes?.revision} editing={editing} onEdit={(change) => edit({ ops: [change] })} />)}</ol>
      {editing ? <textarea className="notes-add" aria-label="Add a note" rows={2} value={draft} placeholder="Add a note…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim()) { event.preventDefault(); edit({ ops: [op({ action: "insert", id: crypto.randomUUID().slice(0, 8), type: "paragraph", text: draft.trim() })] }); setDraft(""); } }} /> : null}
      {failed ? <p className="session-tool-message is-error" role="alert">{failed}</p> : null}
    </div>
    <section className="notes-voice" aria-label="Voice controls">
      {voice.heard || voice.reply ? <div className="notes-captions" aria-live="polite">{voice.heard ? <p className="notes-caption-you"><span>You</span>{voice.heard}</p> : null}{voice.reply ? <p className="notes-caption-luna"><span>Luna</span>{voice.reply}</p> : null}</div> : null}
      {voice.error || tutor?.shareError ? <p className="session-tool-message is-error" role="alert">{voice.error || tutor?.shareError}</p> : null}
      <div className="notes-tools" role="toolbar" aria-label="Notes controls">
        {tutor ? <>
          <button className={tutor.sharing ? "is-on" : ""} type="button" aria-pressed={tutor.sharing} title="Choose this LearnSpace tab. Luna sees a lesson snapshot with each question; frames aren't saved." onClick={tutor.sharing ? tutor.onStopShare : tutor.onShare}><Eye aria-hidden="true" />{tutor.sharing ? "Lesson shared" : "Share lesson"}</button>
          <button className={tutor.drawing ? "is-on" : ""} type="button" aria-pressed={tutor.drawing} onClick={tutor.onToggleDraw}><PenLine aria-hidden="true" />Draw</button>
          <button type="button" title="Clear lesson drawings" onClick={tutor.onClear}><X aria-hidden="true" /><span className="sr-only">Clear drawings</span></button>
        </> : null}
        <button className={editing ? "is-on" : ""} type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}><Pencil aria-hidden="true" />{editing ? "Done" : "Edit"}</button>
      </div>
      <form className="notes-type" onSubmit={(event) => { event.preventDefault(); voice.send(message); setMessage(""); }}>
        <input aria-label="Message Luna" value={message} maxLength={4000} placeholder="A quick tweak, or ask anything…" onChange={(event) => setMessage(event.target.value)} />
        <button className="chat-send" type="submit" aria-label="Send to Luna" disabled={!message.trim()}><ArrowUp aria-hidden="true" /></button>
      </form>
      <div className="notes-footnote"><span>{tutor?.sharing ? "Seeing your lesson with each turn" : "Voice stays on your device"}</span><span role="status">{copyStatus || `${Math.floor(currentMs / 60000)}:${String(Math.floor(currentMs / 1000) % 60).padStart(2, "0")}`}</span></div>
    </section>
  </div>;
}

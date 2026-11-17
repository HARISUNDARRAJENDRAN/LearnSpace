"use client";

import { ArrowUp, Clock, CornerDownRight, LoaderCircle, Mic, Plus, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MathText } from "./MathText";
import { useSpeechInput } from "./useSpeechInput";

const SHARED_SKILLS = [
  { name: "/quiz", desc: "Check what stuck", prompt: "Quiz me on the main idea" },
  { name: "/example", desc: "A worked example", prompt: "Give me a worked example of " },
  { name: "/compare", desc: "Two ideas side by side", prompt: "Compare " },
  { name: "/steps", desc: "How a process works", prompt: "Walk me through how " },
];

/** Ready-made asks for each kind of material. A skill fills the input with its prompt; one that ends in a space waits for the learner to finish it. */
export const SKILLS = {
  video: [
    { name: "/explain", desc: "What was just said", prompt: "Explain what was just said" },
    { name: "/summarize", desc: "What you've watched so far", prompt: "Summarize what I've watched so far" },
    SHARED_SKILLS[0]!,
    { name: "/define", desc: "A term the instructor uses", prompt: "Define " },
    ...SHARED_SKILLS.slice(1),
  ],
  paper: [
    { name: "/explain", desc: "The page you're on", prompt: "Explain this page" },
    { name: "/summarize", desc: "What you've read so far", prompt: "Summarize what I've read so far" },
    SHARED_SKILLS[0]!,
    { name: "/define", desc: "A term the paper uses", prompt: "Define " },
    ...SHARED_SKILLS.slice(1),
  ],
} as const;

type Skill = (typeof SKILLS)[keyof typeof SKILLS][number];
const INPUT_ID = "study-question";

/** The `/word` being typed at the end of the draft, if any. */
function slashToken(draft: string): { query: string; start: number } | null {
  const match = /(^|\s)\/([\w-]*)$/.exec(draft);
  return match ? { query: match[2]!.toLowerCase(), start: match.index + match[1]!.length } : null;
}

export function ChatComposer({ draft, onDraft, ready, answering, onCancelAnswering, pending, reasoning, onSend, onStop, moment, noun, resourceTitle }: {
  draft: string;
  onDraft: (value: string | ((current: string) => string)) => void;
  ready: boolean;
  answering: string | null;
  onCancelAnswering: () => void;
  pending: boolean;
  /** The tutor chose to reason about this question; the bar celebrates it with a sweep. */
  reasoning: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Where the question is asked: "4:10" in a video, "p. 3" in a paper. */
  moment: string;
  noun: "video" | "paper";
  resourceTitle: string;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [wide, setWide] = useState(false);
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null);
  // Each change remounts the sweep, which replays its one-shot animation.
  const [sweeps, setSweeps] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const momentRef = useRef<HTMLSpanElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusInput = () => requestAnimationFrame(() => document.getElementById(INPUT_ID)?.focus());
  const speech = useSpeechInput((text) => {
    onDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    focusInput();
  });

  const token = dismissed ? null : slashToken(draft);
  const open = plusOpen || token !== null;
  const query = plusOpen ? "" : token?.query ?? "";
  const skills = open ? SKILLS[noun].filter((skill) => skill.name.slice(1).startsWith(query)) : [];

  const resetActive = () => {
    setActive(0);
    setEngaged(false);
  };

  // One highlight glides between rows instead of each row lighting up on its own.
  useLayoutEffect(() => {
    const row = open ? optionRefs.current[Math.min(active, skills.length - 1)] : null;
    setHighlight(row ? { top: row.offsetTop, height: row.offsetHeight } : null);
  }, [active, open, skills.length]);

  // Short questions sit inline between the controls; once the text would wrap, it takes the full width above them.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    const moment = momentRef.current;
    if (!row || !measure || !moment) return;
    const inlineWidth = row.clientWidth - 28 * 3 - moment.offsetWidth - 4 * 4;
    setWide(draft.includes("\n") || measure.offsetWidth + 8 > inlineWidth);
  }, [draft]);

  useEffect(() => {
    if (reasoning) setSweeps((count) => count + 1);
  }, [reasoning]);

  useEffect(() => {
    if (!plusOpen) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setPlusOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [plusOpen]);

  function pick(skill: Skill) {
    onDraft(token ? `${draft.slice(0, token.start)}${skill.prompt}` : draft.trim() ? `${draft.trimEnd()} ${skill.prompt}` : skill.prompt);
    setPlusOpen(false);
    setDismissed(false);
    focusInput();
  }

  function submit() {
    if (!draft.trim() || !ready || pending) return;
    onSend(draft);
    setPlusOpen(false);
    setSweeps((count) => count + 1);
  }

  const recording = speech.state === "recording";
  const canSend = Boolean(draft.trim()) && ready;
  const placeholder = !ready ? `Waiting for the ${noun === "video" ? "transcript" : "paper"}…` : recording ? "Listening…" : speech.state === "transcribing" ? "Transcribing…" : answering ? "Your answer…" : `Ask about this ${noun}, / for skills…`;
  return (
    <div className="chat-composer-wrap" ref={rootRef}>
      {open ? (
        <div className="chat-skills" role="listbox" id="chat-skills" aria-label="Skills" onMouseLeave={() => setEngaged(false)}>
          <span className="chat-skills-highlight" aria-hidden="true" style={{ top: highlight?.top ?? 0, height: highlight?.height ?? 0, opacity: highlight && (engaged || !plusOpen) && skills.length > 0 ? 1 : 0 }} />
          {skills.map((skill, index) => (
            <button
              key={skill.name}
              id={`chat-skill-${index}`}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => { setActive(index); setEngaged(true); }}
              onClick={() => pick(skill)}
            >
              <strong>{skill.name}</strong><span>{skill.desc}</span>
            </button>
          ))}
          {skills.length === 0 ? <p className="chat-skills-empty">No skills match &ldquo;{query}&rdquo;</p> : null}
          <p className="chat-skills-hint">Type to search skills · ↑↓ to move · Enter to use</p>
        </div>
      ) : null}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {sweeps ? <span className="chat-composer-sweep" key={sweeps} aria-hidden="true" /> : null}
        <span className="chat-composer-measure" ref={measureRef} aria-hidden="true">{draft}</span>
        {answering ? <span className="chat-context-card tutor-reply"><CornerDownRight aria-hidden="true" /><span>Answering: <MathText text={answering.replace(/\*\*/g, "")} /></span><button type="button" aria-label="Cancel answering" onClick={onCancelAnswering}><X aria-hidden="true" /></button></span> : null}
        {speech.progress !== null ? <p className="chat-composer-status" role="status">Downloading the voice model, one time only · {Math.round(speech.progress)}%</p> : null}
        <div className={`chat-composer-row${wide ? " is-wide" : ""}`} ref={rowRef}>
          <button className="chat-composer-plus" type="button" aria-label="Use a skill" title="Use a skill" aria-expanded={plusOpen} aria-controls="chat-skills" disabled={!ready} onClick={() => { setPlusOpen(!plusOpen); resetActive(); focusInput(); }}><Plus aria-hidden="true" /></button>
          <label className="sr-only" htmlFor={INPUT_ID}>Ask the tutor</label>
          <textarea
            id={INPUT_ID}
            value={draft}
            rows={1}
            maxLength={1_000}
            disabled={!ready}
            placeholder={placeholder}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? "chat-skills" : undefined}
            aria-activedescendant={open && skills.length > 0 ? `chat-skill-${active}` : undefined}
            onChange={(event) => { onDraft(event.target.value); setDismissed(false); setPlusOpen(false); resetActive(); }}
            onKeyDown={(event) => {
              if (open && skills.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setEngaged(true);
                  setActive((current) => (current + (event.key === "ArrowDown" ? 1 : skills.length - 1)) % skills.length);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  pick(skills[active]!);
                  return;
                }
              }
              if (event.key === "Escape" && open) {
                event.preventDefault();
                setDismissed(true);
                setPlusOpen(false);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <span className="chat-composer-moment" ref={momentRef} title={`Your question is asked about ${resourceTitle} at ${moment}`}><Clock aria-hidden="true" />{moment}</span>
          <button className={`chat-mic${recording ? " is-recording" : ""}`} type="button" aria-label={recording ? "Stop dictating" : "Dictate your question"} title={recording ? "Stop dictating" : "Dictate (runs on your device)"} aria-pressed={recording} disabled={!ready || speech.state === "transcribing"} onClick={() => (recording ? speech.stop() : void speech.start())}>
            {recording ? <span className="chat-eq" aria-hidden="true"><span /><span /><span /></span> : speech.state === "transcribing" ? <LoaderCircle className="chat-spin" aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </button>
          {pending ? <button className="chat-send is-stop" type="button" aria-label="Stop answering" title="Stop" onClick={onStop}><Square aria-hidden="true" /></button>
            : <button className="chat-send" type="submit" aria-label="Send" disabled={!canSend}><ArrowUp aria-hidden="true" /></button>}
        </div>
      </form>
      {speech.error ? <p className="chat-composer-error" role="alert">{speech.error}</p> : null}
    </div>
  );
}

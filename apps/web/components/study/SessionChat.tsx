"use client";

import type { StudySessionResource } from "@learnspace/shared";
import { type TutorMessageView, tutorMessageViewSchema, type TutorStreamEvent, type TutorThreadView } from "@learnspace/shared/tutor";
import { ArrowUp, Clock, Copy, CornerDownRight, RotateCcw, Sparkles, Square, SquarePen, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { formatTime } from "./StudyWorkspace";
import { type TutorActions, TutorAnswer } from "./TutorBlocks";

type Phase = "retrieving" | "thinking" | "writing";
type Pending = { id: string | null; phase: Phase };
type Reply = { messageId: string; blockId: string; prompt: string };
type Failure = { message: string; retry: { question: string; replyTo: Reply | null } | null };

const suggestions = ["Explain what was just said", "Summarize what I've watched so far", "Quiz me on the main idea"];
const phaseLabel: Record<Phase, string> = { retrieving: "Finding the relevant part of the transcript…", thinking: "Thinking it through…", writing: "Writing…" };
const transcriptNotice = {
  preparing: "The transcript for this video is still being prepared. The tutor answers only from the transcript, so questions open once it's ready.",
  unavailable: "This video has no captions LearnSpace can use, so the tutor can't answer questions about it.",
  failed: "LearnSpace couldn't get this video's transcript, so the tutor can't answer questions about it.",
} as const;

function clockLabel(iso: string): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Messages that fail the shared schema are shown as unreadable instead of being rendered. */
function readMessage(value: unknown): TutorMessageView | null {
  const parsed = tutorMessageViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  const retryAfter = Number(response.headers.get("Retry-After"));
  const wait = response.status === 429 && retryAfter > 0 && retryAfter < 600 ? ` Try again in ${retryAfter}s.` : "";
  return `${body?.error?.message ?? "The tutor couldn't take that question right now."}${wait}`;
}

export function SessionChat({ sessionId, resource, currentMs, onSeek, onCollapse }: { sessionId: string; resource: StudySessionResource; currentMs: number; onSeek: (positionMs: number) => void; onCollapse: () => void }) {
  const [thread, setThread] = useState<TutorThreadView | null>(null);
  const [messages, setMessages] = useState<Array<TutorMessageView | { id: string; invalid: true }>>([]);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [acting, setActing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endpoint = `/api/v1/study-sessions/${sessionId}/tutor`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("load failed");
      const value = await response.json() as TutorThreadView;
      setThread(value);
      setMessages(value.messages.map((message) => readMessage(message) ?? { id: crypto.randomUUID(), invalid: true }));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);
  // The answer belongs to this lesson only; leaving it stops an answer in progress.
  useEffect(() => () => abortRef.current?.abort(), []);

  const status = thread?.transcript.status;
  useEffect(() => {
    if (status !== "preparing") return;
    // A transcript usually lands within seconds of opening the video; past two minutes it waits on the Firecrawl fallback.
    const started = Date.now();
    let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(() => { void load(); schedule(); }, Date.now() - started < 120_000 ? 3_000 : 30_000); };
    schedule();
    return () => window.clearTimeout(timer);
  }, [status, load]);

  useEffect(() => {
    const list = listRef.current;
    if (list && (messages.length > 0 || pending)) list.scrollTo({ top: list.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages, pending]);

  const upsert = (message: TutorMessageView) => setMessages((current) => current.some((item) => item.id === message.id) ? current.map((item) => item.id === message.id ? message : item) : [...current, message]);

  async function send(text: string, replyTo: Reply | null = reply) {
    const question = text.trim();
    if (!question || pending || status !== "ready") return;
    setDraft("");
    setReply(null);
    setFailure(null);
    setPending({ id: null, phase: "retrieving" });
    const controller = new AbortController();
    abortRef.current = controller;
    const retry = { question, replyTo };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, positionMs: currentMs, idempotencyKey: crypto.randomUUID(), ...(replyTo ? { replyTo: { messageId: replyTo.messageId, blockId: replyTo.blockId } } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        setFailure({ message: await errorMessage(response), retry: response.status === 429 || response.status >= 500 ? retry : null });
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as TutorStreamEvent;
          if (event.type === "accepted") {
            const user = readMessage(event.user);
            if (user) upsert(user);
            setPending({ id: event.assistantId, phase: "retrieving" });
          } else if (event.type === "phase") {
            setPending((current) => current ? { ...current, phase: event.phase } : current);
          } else if (event.type === "done") {
            const message = readMessage(event.message);
            setMessages((current) => [...current.filter((item) => item.id !== event.message.id), message ?? { id: event.message.id, invalid: true }]);
            finished = true;
          } else if (event.type === "error") {
            setFailure({ message: event.message, retry: event.code === "cancelled" ? null : retry });
            finished = true;
          }
        }
      }
      if (!finished) setFailure({ message: "The answer was interrupted.", retry });
    } catch {
      setFailure(controller.signal.aborted ? { message: "Stopped.", retry } : { message: "The tutor couldn't be reached. Check your connection.", retry });
    } finally {
      abortRef.current = null;
      setPending(null);
    }
  }

  async function act(body: Record<string, unknown>) {
    setActing(true);
    try {
      const response = await fetch(`${endpoint}/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        setFailure({ message: await errorMessage(response), retry: null });
        return;
      }
      const message = readMessage(await response.json());
      if (message) upsert(message);
    } finally {
      setActing(false);
    }
  }

  const actions: TutorActions = {
    seek: onSeek,
    answer: (messageId, blockId, choice) => void act({ action: "answer", messageId, blockId, choice }),
    hint: (messageId, blockId) => void act({ action: "hint", messageId, blockId }),
    reply: (messageId, blockId, prompt) => {
      setReply({ messageId, blockId, prompt });
      requestAnimationFrame(() => document.getElementById("study-question")?.focus());
    },
    busy: acting || Boolean(pending),
  };

  async function newChat() {
    abortRef.current?.abort();
    await fetch(endpoint, { method: "DELETE" });
    setFailure(null);
    setReply(null);
    await load();
  }

  const ready = status === "ready";
  const visible = messages.filter((message) => "invalid" in message || message.status !== "pending" || message.id !== pending?.id);
  const title = messages.find((message): message is TutorMessageView => !("invalid" in message) && message.role === "user")?.text ?? "New chat";
  return (
    <div className="session-tool session-chat">
      <SessionPanelHeader title={title} onCollapse={onCollapse}>
        <button className="session-icon-button" type="button" aria-label="New chat" title="New chat" disabled={messages.length === 0 || Boolean(pending)} onClick={() => void newChat()}><SquarePen aria-hidden="true" /></button>
      </SessionPanelHeader>
      <div className="chat-messages" ref={listRef} data-lenis-prevent aria-live="polite" aria-busy={Boolean(pending)}>
        {loadError ? <p className="session-tool-message is-error" role="alert">The conversation couldn&apos;t be loaded. <button className="session-link-button" type="button" onClick={() => void load()}>Try again</button></p> : null}
        {thread && !ready ? <p className="tutor-notice" role="status">{transcriptNotice[thread.transcript.status as keyof typeof transcriptNotice]}</p> : null}
        {thread && visible.length === 0 && !pending ? (
          <div className="chat-empty">
            <p className="chat-empty-title">Learn from this video</p>
            <p>Ask about anything the instructor covers. Answers come only from this video&apos;s transcript, link to the moment they come from, and check what stuck as you go.</p>
            <ul className="chat-suggestions">{suggestions.map((suggestion) => <li key={suggestion}><button type="button" disabled={!ready} onClick={() => void send(suggestion, null)}><ArrowUp aria-hidden="true" />{suggestion}</button></li>)}</ul>
          </div>
        ) : visible.map((message) => "invalid" in message ? (
          <article className="chat-message" key={message.id}><p className="session-tool-message is-error">This answer couldn&apos;t be displayed.</p></article>
        ) : (
          <article className={`chat-message${message.role === "assistant" && message.outcome && message.outcome !== "answer" ? " is-notice" : ""}`} key={message.id}>
            <header>{message.role === "assistant" ? <span className="chat-avatar is-ai" aria-hidden="true"><Sparkles /></span> : <span className="chat-avatar" aria-hidden="true">Y</span>}<strong>{message.role === "assistant" ? "LearnSpace tutor" : "You"}</strong><time dateTime={message.createdAt}>· {clockLabel(message.createdAt)}</time></header>
            {message.role === "user" && message.positionMs !== null ? <button className="chat-context-chip" type="button" title="Play from this moment" onClick={() => onSeek(message.positionMs!)}><Video aria-hidden="true" />{resource.title} · {formatTime(message.positionMs)}</button> : null}
            {message.role === "user" ? <p>{message.text}</p> : message.status === "completed" ? (
              message.blocks.length > 0 ? <TutorAnswer message={message} actions={actions} /> : <p>{message.text}</p>
            ) : <p className="session-tool-message">{message.status === "cancelled" ? "Stopped before answering." : "This answer didn't finish."}</p>}
            {message.stale ? <p className="tutor-stale">Cites an earlier version of this video&apos;s transcript.</p> : null}
            {message.role === "assistant" && message.status === "completed" && message.text ? <div className="chat-message-actions"><button className="session-icon-button" type="button" aria-label="Copy answer" title="Copy" onClick={() => void navigator.clipboard?.writeText(message.text)}><Copy aria-hidden="true" /></button></div> : null}
          </article>
        ))}
        {pending ? <article className="chat-message is-pending"><header><span className="chat-avatar is-ai" aria-hidden="true"><Sparkles /></span><strong>LearnSpace tutor</strong></header><p role="status">{phaseLabel[pending.phase]}</p></article> : null}
        {failure ? <div className="tutor-failure" role="alert"><span>{failure.message}</span>{failure.retry ? <button className="session-link-button" type="button" onClick={() => void send(failure.retry!.question, failure.retry!.replyTo)}><RotateCcw aria-hidden="true" />Retry</button> : null}</div> : null}
      </div>
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        {reply ? <span className="chat-context-card tutor-reply"><CornerDownRight aria-hidden="true" /><span>Answering: {reply.prompt}</span><button type="button" aria-label="Cancel answering" onClick={() => setReply(null)}><X aria-hidden="true" /></button></span> : <span className="chat-context-card"><span className="chat-context-index">1</span><Video aria-hidden="true" /><span>{resource.title}</span></span>}
        <label className="sr-only" htmlFor="study-question">Ask the tutor</label>
        <textarea id="study-question" value={draft} rows={2} maxLength={1_000} disabled={!ready} placeholder={ready ? reply ? "Your answer…" : "Ask about this video…" : "Waiting for the transcript…"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
        <div className="chat-composer-bar">
          <span className="chat-composer-moment" title="Context sent with your question"><Clock aria-hidden="true" />At {formatTime(currentMs)}</span>
          {pending ? <button className="chat-send" type="button" aria-label="Stop answering" title="Stop" onClick={() => abortRef.current?.abort()}><Square aria-hidden="true" /></button>
            : <button className="chat-send" type="submit" aria-label="Send" disabled={!draft.trim() || !ready}><ArrowUp aria-hidden="true" /></button>}
        </div>
      </form>
    </div>
  );
}

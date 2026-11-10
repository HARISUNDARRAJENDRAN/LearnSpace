"use client";

import type { StudySessionResource } from "@learnspace/shared";
import { type TutorDoubt, type TutorMessageView, tutorMessageViewSchema, type TutorStreamEvent, type TutorThreadView } from "@learnspace/shared/tutor";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Copy, CornerDownLeft, MessagesSquare, PencilLine, Play, RotateCcw, Search, SquarePen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ChatComposer, SKILLS } from "./ChatComposer";
import { type DoubtAnchor, type DoubtMark, DoubtPopup, DoubtThread, selectedAnchor, useDoubtHighlights } from "./Doubts";
import { LoadingState } from "./LoadingState";
import { MathText } from "./MathText";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { formatTime } from "./StudyWorkspace";
import { type TutorActions, TutorAnswer } from "./TutorBlocks";

type Phase = "retrieving" | "thinking" | "reasoning" | "writing";
type Pending = { id: string | null; phase: Phase; doubtId: string | null };
type Reply = { messageId: string; blockId: string; prompt: string };
type Failure = { message: string; doubtId: string | null; retry: { question: string; replyTo: Reply | null; doubt: TutorDoubt | null } | null };
type Doubt = { anchor: TutorDoubt; messages: TutorMessageView[] };
type Asking = { anchor: DoubtAnchor; top: number; left: number };

const phaseLabel: Record<Phase, string> = { retrieving: "Finding the moment in the transcript", thinking: "Thinking it through", reasoning: "Working through it step by step", writing: "Writing" };
const transcriptNotice = {
  preparing: "The transcript for this video is still being prepared. The tutor answers only from the transcript, so questions open once it's ready.",
  unavailable: "This video has no captions LearnSpace can use, so the tutor can't answer questions about it.",
  failed: "LearnSpace couldn't get this video's transcript, so the tutor can't answer questions about it.",
} as const;

function whenLabel(iso: string): string {
  const date = new Date(iso);
  const today = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("en", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(date);
}

type ChatSummary = { title: string; preview: string | null };

/** Every conversation about this video, searchable; picking an earlier one makes it the current chat again. */
function ChatList({ current, history, onOpenCurrent, onRestore }: { current: ChatSummary | null; history: TutorThreadView["history"]; onOpenCurrent: () => void; onRestore: (threadId: string) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (item: ChatSummary) => !needle || item.title.toLowerCase().includes(needle) || Boolean(item.preview?.toLowerCase().includes(needle));
  const earlier = history.filter(matches);
  const showCurrent = current && matches(current);
  return (
    <div className="chat-list" data-lenis-prevent>
      <label className="chat-list-search"><Search aria-hidden="true" /><span className="sr-only">Find a chat</span><input type="search" value={query} placeholder="Find a chat…" onChange={(event) => setQuery(event.target.value)} /></label>
      <ul>
        {showCurrent ? <li><button type="button" onClick={onOpenCurrent}><strong>{current.title}</strong>{current.preview ? <span><MathText text={current.preview} /></span> : null}<small>Current chat</small></button></li> : null}
        {earlier.map((item) => <li key={item.id}><button type="button" onClick={() => onRestore(item.id)}><strong>{item.title}</strong>{item.preview ? <span><MathText text={item.preview} /></span> : null}<small><time dateTime={item.updatedAt}>{whenLabel(item.updatedAt)}</time></small></button></li>)}
      </ul>
      {!showCurrent && earlier.length === 0 ? <p className="chat-list-empty">{needle ? <>No chats match &ldquo;{query.trim()}&rdquo;.</> : "No chats about this video yet."}</p> : null}
    </div>
  );
}

/** The transcript moments an answer cites, collapsed under a count. */
function AnswerSources({ message, onSeek }: { message: TutorMessageView; onSeek: (positionMs: number) => void }) {
  const [open, setOpen] = useState(false);
  if (message.sources.length === 0) return null;
  return (
    <>
      <button className="chat-sources-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{message.sources.length} {message.sources.length === 1 ? "moment" : "moments"}<ChevronDown aria-hidden="true" /></button>
      <div className="chat-sources" data-open={open || undefined}>
        <ul inert={!open}>{message.sources.map((source) => <li key={source.chunkId}>{source.startMs === null ? <span className="chat-source"><span>{source.excerpt}</span></span> : <button className="chat-source" type="button" onClick={() => onSeek(source.startMs!)}><Play aria-hidden="true" /><time>{formatTime(source.startMs)}</time><span>{source.excerpt}</span></button>}</li>)}</ul>
      </div>
    </>
  );
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
  const [revealing, setRevealing] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [streaming, setStreaming] = useState<TutorMessageView | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [asking, setAsking] = useState<Asking | null>(null);
  // Folded or not, per doubt; a doubt without a choice here is folded once resolved.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // A streamed answer is already where the learner is reading when it completes, so its arrival doesn't scroll.
  const holdScroll = useRef(false);
  const revealed = useCallback(() => setRevealing(null), []);
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

  const drafting = streaming !== null;
  const doubting = Boolean(pending?.doubtId);
  useEffect(() => {
    const list = listRef.current;
    if (!list || listing || (messages.length === 0 && !pending && !drafting)) return;
    if (holdScroll.current) {
      holdScroll.current = false;
      return;
    }
    // An answer coming in is read from its start: its question goes to the top instead of jumping past words that haven't appeared yet.
    const question = list.querySelector(".tutor-answer:is(.is-revealing, .is-streaming)")?.closest(".chat-message")?.previousElementSibling;
    // A doubt is asked in the middle of the conversation, so the conversation stays where the learner is reading.
    if (!(question instanceof HTMLElement) && doubting) return;
    const top = question instanceof HTMLElement ? question.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 12 : list.scrollHeight;
    list.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages, pending, listing, drafting, doubting]);

  const upsert = (message: TutorMessageView) => setMessages((current) => current.some((item) => item.id === message.id) ? current.map((item) => item.id === message.id ? message : item) : [...current, message]);

  async function send(text: string, replyTo: Reply | null = reply, doubt: TutorDoubt | null = null) {
    const question = text.trim();
    if (!question || pending || status !== "ready") return;
    if (!doubt) {
      setDraft("");
      setReply(null);
    }
    setFailure(null);
    const doubtId = doubt?.id ?? null;
    setPending({ id: null, phase: "retrieving", doubtId });
    const controller = new AbortController();
    abortRef.current = controller;
    const retry = { question, replyTo, doubt };
    // The question shows at once; the server's copy replaces it when the turn is accepted, and a refused turn takes it away.
    const localId = crypto.randomUUID();
    let accepted = false;
    let drafted = false;
    upsert({ id: localId, role: "user", status: "completed", createdAt: new Date().toISOString(), text: question, positionMs: currentMs, outcome: null, blocks: [], sources: [], followUps: [], stale: false, doubt });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, positionMs: currentMs, idempotencyKey: crypto.randomUUID(), ...(replyTo ? { replyTo: { messageId: replyTo.messageId, blockId: replyTo.blockId } } : {}), ...(doubt ? { doubt } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        setFailure({ message: await errorMessage(response), doubtId, retry: response.status === 429 || response.status >= 500 ? retry : null });
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
            accepted = Boolean(user);
            if (user) setMessages((current) => current.map((item) => item.id === localId ? user : item));
            setPending({ id: event.assistantId, phase: "retrieving", doubtId });
          } else if (event.type === "phase") {
            setPending((current) => current ? { ...current, phase: event.phase } : current);
          } else if (event.type === "draft") {
            const message = readMessage(event.message);
            if (message) {
              drafted = true;
              setStreaming(message);
            }
          } else if (event.type === "done") {
            const message = readMessage(event.message);
            if (drafted) holdScroll.current = true;
            else if (message?.status === "completed" && message.blocks.length > 0) setRevealing(message.id);
            setMessages((current) => [...current.filter((item) => item.id !== event.message.id), message ?? { id: event.message.id, invalid: true }]);
            finished = true;
          } else if (event.type === "error") {
            setFailure({ message: event.message, doubtId, retry: event.code === "cancelled" ? null : retry });
            finished = true;
          }
        }
      }
      if (!finished) setFailure({ message: "The answer was interrupted.", doubtId, retry });
    } catch {
      setFailure({ message: controller.signal.aborted ? "Stopped." : "The tutor couldn't be reached. Check your connection.", doubtId, retry });
    } finally {
      if (!accepted) setMessages((current) => current.filter((item) => item.id !== localId));
      abortRef.current = null;
      setPending(null);
      setStreaming(null);
    }
  }

  async function act(body: Record<string, unknown>) {
    setActing(true);
    try {
      const response = await fetch(`${endpoint}/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        setFailure({ message: await errorMessage(response), doubtId: null, retry: null });
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
    ask: (messageId, blockId, prompt, question) => void send(question, { messageId, blockId, prompt }),
    busy: acting || Boolean(pending),
  };

  async function restore(threadId: string) {
    const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", threadId }) });
    if (!response.ok) {
      setFailure({ message: await errorMessage(response), doubtId: null, retry: null });
      return;
    }
    setFailure(null);
    setReply(null);
    setListing(false);
    await load();
  }

  async function resolve(doubtId: string, resolved: boolean) {
    const previous = thread?.resolvedDoubts ?? [];
    const next = resolved ? [...previous, doubtId] : previous.filter((id) => id !== doubtId);
    setThread((current) => current ? { ...current, resolvedDoubts: next } : current);
    setFolded((current) => ({ ...current, [doubtId]: resolved }));
    const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve", doubtId, resolved }) }).catch(() => null);
    if (!response?.ok) setThread((current) => current ? { ...current, resolvedDoubts: previous } : current);
  }

  /** Opens the ask box under a selection inside a finished answer. */
  function pickDoubt() {
    const list = listRef.current;
    const picked = list && !pending && ready ? selectedAnchor(list) : null;
    if (!list || !picked) return;
    const box = list.getBoundingClientRect();
    const width = Math.min(300, list.clientWidth - 16);
    const left = Math.min(Math.max(8, picked.rect.left - box.left + picked.rect.width / 2 - width / 2), list.clientWidth - width - 8);
    setAsking({ anchor: picked.anchor, top: picked.rect.bottom - box.top + list.scrollTop + 8, left });
  }

  async function newChat() {
    abortRef.current?.abort();
    setListing(false);
    await fetch(endpoint, { method: "DELETE" });
    setFailure(null);
    setReply(null);
    await load();
  }

  const ready = status === "ready";
  const shown = messages.filter((message): message is TutorMessageView => !("invalid" in message));
  const resolved = new Set(thread?.resolvedDoubts ?? []);
  // Each doubt gathers its questions and answers, in the order they were asked, under the block it was raised on.
  const doubts = new Map<string, Doubt>();
  for (const message of shown) {
    if (!message.doubt) continue;
    const doubt = doubts.get(message.doubt.id) ?? { anchor: message.doubt, messages: [] };
    doubt.messages.push(message);
    doubts.set(message.doubt.id, doubt);
  }
  const marks: DoubtMark[] = [...doubts.values()].map((doubt) => ({ ...doubt.anchor, state: resolved.has(doubt.anchor.id) ? "resolved" : "open" }));
  if (asking) marks.push({ ...asking.anchor, state: "draft" });
  useDoubtHighlights(listRef, marks);
  const isPendingAnswer = (message: TutorMessageView | { id: string; invalid: true }) => !("invalid" in message) && message.status === "pending" && message.id === pending?.id;
  const visible = messages.filter((message) => ("invalid" in message || !message.doubt) && !isPendingAnswer(message));
  const main = shown.filter((message) => !message.doubt);
  const lastQuestion = main.findLast((message) => message.role === "user");
  const firstQuestion = main.find((message) => message.role === "user")?.text ?? null;
  const current = firstQuestion ? { title: firstQuestion, preview: main.find((message) => message.role === "assistant" && message.status === "completed")?.text.slice(0, 200) || null } : null;
  const generalNote = <p className="chat-general-note"><BookOpen aria-hidden="true" />General knowledge, not from this video</p>;

  const pendingAnswer = (doubtId: string | null) => pending && pending.doubtId === doubtId ? (
    <article className="chat-message is-assistant">
      {streaming?.outcome === "general" ? generalNote : null}
      {streaming ? <TutorAnswer message={streaming} actions={{ ...actions, busy: true }} streaming /> : <LoadingState label={phaseLabel[pending.phase]} />}
    </article>
  ) : null;
  const failureNote = (doubtId: string | null) => failure && failure.doubtId === doubtId ? (
    <div className="tutor-failure" role="alert"><span>{failure.message}</span>{failure.retry ? <button className="session-link-button" type="button" onClick={() => void send(failure.retry!.question, failure.retry!.replyTo, failure.retry!.doubt)}><RotateCcw aria-hidden="true" />Retry</button> : null}</div>
  ) : null;

  function renderDoubts(messageId: string, blockId: string): ReactNode {
    const here = [...doubts.values()].filter((doubt) => doubt.anchor.messageId === messageId && doubt.anchor.blockId === blockId);
    if (here.length === 0) return null;
    return (
      <div className="doubt-list">
        {here.map(({ anchor, messages: thread }) => (
          <DoubtThread
            key={anchor.id}
            quote={anchor.quote}
            count={thread.filter((message) => message.role === "assistant").length}
            resolved={resolved.has(anchor.id)}
            folded={(folded[anchor.id] ?? resolved.has(anchor.id)) && pending?.doubtId !== anchor.id}
            onFold={(value) => setFolded((current) => ({ ...current, [anchor.id]: value }))}
            onResolve={(value) => void resolve(anchor.id, value)}
            onReply={(question) => void send(question, null, anchor)}
            busy={Boolean(pending) || !ready}
          >
            {thread.filter((message) => !isPendingAnswer(message)).map((message) => renderMessage(message))}
            {pendingAnswer(anchor.id)}
            {failureNote(anchor.id)}
          </DoubtThread>
        ))}
      </div>
    );
  }

  function renderMessage(message: TutorMessageView): ReactNode {
    if (message.role === "user") {
      return (
        <article className="chat-message is-user" key={message.id}>
          {message.positionMs !== null && !message.doubt ? <button className="chat-context-chip" type="button" title="Play from this moment" onClick={() => onSeek(message.positionMs!)}><Play aria-hidden="true" />{formatTime(message.positionMs)}</button> : null}
          <p className="chat-bubble">{message.text}</p>
          {message === lastQuestion && !pending ? <button className="session-icon-button chat-edit" type="button" aria-label="Edit question" title="Edit and ask again" onClick={() => { setDraft(message.text); requestAnimationFrame(() => document.getElementById("study-question")?.focus()); }}><PencilLine aria-hidden="true" /></button> : null}
        </article>
      );
    }
    return (
      <article className={`chat-message is-assistant${message.outcome && message.outcome !== "answer" && message.outcome !== "general" ? " is-notice" : ""}`} key={message.id} data-message-id={message.status === "completed" ? message.id : undefined}>
        {message.outcome === "general" ? generalNote : null}
        {message.status === "completed" ? (
          message.blocks.length > 0 ? <TutorAnswer message={message} actions={actions} revealing={message.id === revealing} onRevealed={revealed} after={(blockId) => renderDoubts(message.id, blockId)} /> : <p>{message.text}</p>
        ) : <p className="session-tool-message">{message.status === "cancelled" ? "Stopped before answering." : "This answer didn't finish."}</p>}
        {message.stale ? <p className="tutor-stale">Cites an earlier version of this video&apos;s transcript.</p> : null}
        {message.id === revealing ? null : <>
          {message.status === "completed" && message.text ? (
            <div className="chat-message-actions">
              <button className="session-icon-button" type="button" aria-label="Copy answer" title="Copy" onClick={() => void navigator.clipboard?.writeText(message.text)}><Copy aria-hidden="true" /></button>
              <AnswerSources message={message} onSeek={onSeek} />
            </div>
          ) : null}
          {message === visible.at(-1) && message.followUps.length > 0 && !pending ? (
            <section className="chat-followups" aria-label="Follow-ups">
              <p>Follow-ups</p>
              <ul>{message.followUps.map((followUp, index) => <li key={followUp} style={{ animationDelay: `${index * 90}ms` }}><button type="button" disabled={!ready} onClick={() => void send(followUp, null)}><CornerDownLeft aria-hidden="true" /><span><MathText text={followUp} /></span></button></li>)}</ul>
            </section>
          ) : null}
        </>}
      </article>
    );
  }

  return (
    <div className="session-tool session-chat">
      <SessionPanelHeader title={listing ? "Chats about this video" : firstQuestion ?? "New chat"} onCollapse={onCollapse}>
        {listing ? null : <button className="session-icon-button" type="button" aria-label="All chats" title="All chats" disabled={Boolean(pending)} onClick={() => setListing(true)}><MessagesSquare aria-hidden="true" /></button>}
        <button className="session-icon-button" type="button" aria-label="New chat" title="New chat" disabled={(messages.length === 0 && !listing) || Boolean(pending)} onClick={() => (messages.length === 0 ? setListing(false) : void newChat())}><SquarePen aria-hidden="true" /></button>
      </SessionPanelHeader>
      {listing ? <ChatList current={current} history={thread?.history ?? []} onOpenCurrent={() => setListing(false)} onRestore={(threadId) => void restore(threadId)} /> : <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: selecting text is the interaction; the ask box it opens is a real form. */}
      <div
        className="chat-messages"
        ref={listRef}
        data-lenis-prevent
        aria-live="polite"
        aria-busy={Boolean(pending)}
        onScroll={(event) => { const list = event.currentTarget; setAtEnd(list.scrollHeight - list.scrollTop - list.clientHeight < 80); }}
        onPointerDown={(event) => { if (!(event.target as Element).closest(".doubt-popup")) setAsking(null); }}
        onPointerUp={pickDoubt}
        onKeyUp={(event) => { if (event.shiftKey) pickDoubt(); }}
      >
        {loadError ? <p className="session-tool-message is-error" role="alert">The conversation couldn&apos;t be loaded. <button className="session-link-button" type="button" onClick={() => void load()}>Try again</button></p> : null}
        {thread && !ready ? <p className="tutor-notice" role="status">{transcriptNotice[thread.transcript.status as keyof typeof transcriptNotice]}</p> : null}
        {thread && visible.length === 0 && !pending ? (
          <div className="chat-empty">
            <p className="chat-empty-title">Learn from this video</p>
            <p>Ask about anything the instructor covers. Answers link to the moment they come from, say plainly when they go beyond the video, and check what stuck as you go. Highlight any part of an answer to ask about just that.</p>
            <ul className="chat-suggestions">{SKILLS.slice(0, 3).map((skill) => <li key={skill.name}><button type="button" disabled={!ready} onClick={() => void send(skill.prompt, null)}><ArrowUp aria-hidden="true" />{skill.prompt}</button></li>)}</ul>
          </div>
        ) : visible.map((message) => "invalid" in message ? (
          <article className="chat-message is-assistant" key={message.id}><p className="session-tool-message is-error">This answer couldn&apos;t be displayed.</p></article>
        ) : renderMessage(message))}
        {pendingAnswer(null)}
        {failureNote(null)}
        {asking ? <DoubtPopup key={`${asking.anchor.messageId}:${asking.anchor.blockId}:${asking.anchor.quote}:${asking.anchor.occurrence}`} top={asking.top} left={asking.left} onClose={() => setAsking(null)} onAsk={(question) => { const doubt = { ...asking.anchor, id: crypto.randomUUID() }; setAsking(null); window.getSelection()?.removeAllRanges(); void send(question, null, doubt); }} /> : null}
        {atEnd || visible.length === 0 ? null : <div className="chat-jump-dock"><button className="chat-jump" type="button" aria-label="Jump to latest" title="Jump to latest" onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })}><ArrowDown aria-hidden="true" /></button></div>}
      </div>
      <ChatComposer draft={draft} onDraft={setDraft} ready={ready} answering={reply?.prompt ?? null} onCancelAnswering={() => setReply(null)} pending={Boolean(pending)} reasoning={pending?.phase === "reasoning"} onSend={(text) => void send(text)} onStop={() => abortRef.current?.abort()} currentMs={currentMs} resourceTitle={resource.title} />
      </>}
    </div>
  );
}

"use client";

import type { StudySessionResource } from "@learnspace/shared";
import { ArrowUp, Clock, Copy, SquarePen, Sparkles, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postStudyAction } from "./session-api";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { formatTime } from "./StudyWorkspace";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string; at: Date; context?: string };

const suggestions = ["Summarize what I've watched so far", "Explain the main idea in simple terms", "What should I know before watching?"];

function clockLabel(date: Date): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function SessionChat({ sessionId, resource, currentMs, onCollapse }: { sessionId: string; resource: StudySessionResource; currentMs: number; onCollapse: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list && (messages.length > 0 || pending)) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setDraft("");
    const reply = (answer: string) => setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: answer, at: new Date() }]);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: question, at: new Date(), context: `${resource.title} · ${formatTime(currentMs)}` }]);
    setPending(true);
    try {
      const value = await postStudyAction<{ message: string }>(sessionId, "questions", { question, anchor: { kind: "video", positionMs: currentMs } });
      reply(value.message);
    } catch {
      reply("The lesson context could not be checked right now.");
    } finally {
      setPending(false);
    }
  }

  const title = messages.find((message) => message.role === "user")?.text ?? "New chat";
  return (
    <div className="session-tool session-chat">
      <SessionPanelHeader title={title} onCollapse={onCollapse}>
        <button className="session-icon-button" type="button" aria-label="New chat" title="New chat" disabled={messages.length === 0} onClick={() => setMessages([])}><SquarePen aria-hidden="true" /></button>
      </SessionPanelHeader>
      <div className="chat-messages" ref={listRef} data-lenis-prevent aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p className="chat-empty-title">Ask about this video</p>
            <p>Questions use the moment you&apos;re at in the lesson as context.</p>
            <ul className="chat-suggestions">{suggestions.map((suggestion) => <li key={suggestion}><button type="button" onClick={() => void send(suggestion)}><ArrowUp aria-hidden="true" />{suggestion}</button></li>)}</ul>
          </div>
        ) : messages.map((message) => (
          <article className="chat-message" key={message.id}>
            <header>{message.role === "assistant" ? <span className="chat-avatar is-ai" aria-hidden="true"><Sparkles /></span> : <span className="chat-avatar" aria-hidden="true">Y</span>}<strong>{message.role === "assistant" ? "LearnSpace AI" : "You"}</strong><time dateTime={message.at.toISOString()}>· {clockLabel(message.at)}</time></header>
            {message.context ? <span className="chat-context-chip"><Video aria-hidden="true" />{message.context}</span> : null}
            <p>{message.text}</p>
            {message.role === "assistant" ? <div className="chat-message-actions"><button className="session-icon-button" type="button" aria-label="Copy answer" title="Copy" onClick={() => void navigator.clipboard?.writeText(message.text)}><Copy aria-hidden="true" /></button></div> : null}
          </article>
        ))}
        {pending ? <article className="chat-message is-pending"><header><span className="chat-avatar is-ai" aria-hidden="true"><Sparkles /></span><strong>LearnSpace AI</strong></header><p>Reading the lesson…</p></article> : null}
      </div>
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        <span className="chat-context-card"><span className="chat-context-index">1</span><Video aria-hidden="true" /><span>{resource.title}</span></span>
        <label className="sr-only" htmlFor="study-question">Ask AI</label>
        <textarea id="study-question" value={draft} rows={2} placeholder="Ask AI anything about this video…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
        <div className="chat-composer-bar"><span className="chat-composer-moment" title="Context sent with your question"><Clock aria-hidden="true" />At {formatTime(currentMs)}</span><button className="chat-send" type="submit" aria-label="Send" disabled={!draft.trim() || pending}><ArrowUp aria-hidden="true" /></button></div>
      </form>
    </div>
  );
}

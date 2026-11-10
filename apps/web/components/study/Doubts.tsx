"use client";

import type { TutorDoubt } from "@learnspace/shared/tutor";
import { ArrowUp, Check, RotateCcw } from "lucide-react";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useState } from "react";

export type DoubtAnchor = Omit<TutorDoubt, "id">;
export type DoubtMark = DoubtAnchor & { state: "open" | "resolved" | "draft" };

const MAX_QUOTE = 600;
const PRESETS = [
  { label: "Simpler", question: "Explain this more simply." },
  { label: "Example", question: "Give me an example of this." },
] as const;

/** The block of one answer: nested doubt answers are inside their parent's answer, so the nearest message must be this one. */
function blockElement(root: HTMLElement, messageId: string, blockId: string): HTMLElement | null {
  const article = root.querySelector(`[data-message-id="${messageId}"]`);
  if (!article) return null;
  return [...article.querySelectorAll<HTMLElement>(`[data-block-id="${blockId}"]`)].find((block) => block.closest("[data-message-id]") === article) ?? null;
}

/** The range of the n-th match of `quote` in the block's text, across however many text nodes it spans. */
function quoteRange(block: HTMLElement, quote: string, occurrence: number): Range | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const text = nodes.map((node) => node.data).join("");
  let start = -1;
  for (let found = 0; found <= occurrence; found += 1) {
    start = text.indexOf(quote, start + 1);
    if (start < 0) return null;
  }
  const end = start + quote.length;
  const range = document.createRange();
  let offset = 0;
  let opened = false;
  for (const node of nodes) {
    const next = offset + node.data.length;
    if (!opened && start < next) {
      range.setStart(node, start - offset);
      opened = true;
    }
    if (opened && end <= next) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return null;
}

/** What the learner selected, if it lies inside one block of one finished answer. */
export function selectedAnchor(root: HTMLElement): { anchor: DoubtAnchor; rect: DOMRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const block = (container instanceof Element ? container : container.parentElement)?.closest<HTMLElement>("[data-block-id]");
  const article = block?.closest<HTMLElement>("[data-message-id]");
  if (!block || !article || !root.contains(article) || article.querySelector(".tutor-answer.is-streaming")) return null;
  const raw = range.toString();
  const quote = raw.trim();
  if (!quote || quote.length > MAX_QUOTE) return null;
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length + raw.length - raw.trimStart().length;
  const text = block.textContent ?? "";
  let occurrence = 0;
  for (let index = text.indexOf(quote); index >= 0 && index < start; index = text.indexOf(quote, index + 1)) occurrence += 1;
  return { anchor: { messageId: article.dataset.messageId!, blockId: block.dataset.blockId!, quote, occurrence }, rect: range.getBoundingClientRect() };
}

/** Paints doubts with the CSS Custom Highlight API, so React's text nodes are never wrapped or split. */
export function useDoubtHighlights(root: RefObject<HTMLElement | null>, marks: DoubtMark[]) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const layers = { open: new Highlight(), resolved: new Highlight(), draft: new Highlight() };
    for (const mark of marks) {
      const block = blockElement(element, mark.messageId, mark.blockId);
      const range = block ? quoteRange(block, mark.quote, mark.occurrence) : null;
      if (range) layers[mark.state].add(range);
    }
    for (const [state, layer] of Object.entries(layers)) CSS.highlights.set(`doubt-${state}`, layer);
    return () => { for (const state of Object.keys(layers)) CSS.highlights.delete(`doubt-${state}`); };
  });
}

/** The small box under a selection: ask anything about it, or one of the quick asks. */
export function DoubtPopup({ top, left, onAsk, onClose }: { top: number; left: number; onAsk: (question: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <form className="doubt-popup" style={{ top, left }} onSubmit={(event) => { event.preventDefault(); if (text.trim()) onAsk(text.trim()); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <label className="sr-only" htmlFor="doubt-question">Ask about the highlighted words</label>
      <div className="doubt-popup-row">
        {/* biome-ignore lint/a11y/noAutofocus: the box opens because the learner wants to type a doubt. */}
        <input id="doubt-question" value={text} placeholder="Ask about this…" autoComplete="off" maxLength={1_000} autoFocus onChange={(event) => setText(event.target.value)} />
        <button className="chat-send" type="submit" aria-label="Ask" disabled={!text.trim()}><ArrowUp aria-hidden="true" /></button>
      </div>
      <div className="doubt-popup-presets">{PRESETS.map((preset) => <button key={preset.label} type="button" onClick={() => onAsk(preset.question)}>{preset.label}</button>)}</div>
    </form>
  );
}

/**
 * One doubt as a comment thread. The line on its left folds and unfolds it; "Got it" resolves it, which folds it and
 * fades its highlight. Its answers can hold doubts of their own, nested the same way.
 */
export function DoubtThread({ quote, count, resolved, folded, onFold, onResolve, onReply, busy, children }: {
  quote: string;
  count: number;
  resolved: boolean;
  folded: boolean;
  onFold: (folded: boolean) => void;
  onResolve: (resolved: boolean) => void;
  onReply: (question: string) => void;
  busy: boolean;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  return (
    <section className={`doubt${folded ? " is-folded" : ""}${resolved ? " is-resolved" : ""}`} aria-label={`Doubt about “${quote}”`}>
      <button className="doubt-line" type="button" aria-expanded={!folded} aria-label={folded ? "Expand this doubt" : "Collapse this doubt"} title={folded ? "Expand" : "Collapse"} onClick={() => onFold(!folded)} />
      <div className="doubt-body">
        <button className="doubt-head" type="button" aria-expanded={!folded} onClick={() => onFold(!folded)}>
          <q>{quote}</q>
          {folded ? <span>{count} {count === 1 ? "reply" : "replies"}{resolved ? " · Resolved" : ""}</span> : null}
        </button>
        {folded ? null : <>
          {children}
          <form className="doubt-reply" onSubmit={(event) => { event.preventDefault(); if (!text.trim() || busy) return; onReply(text.trim()); setText(""); }}>
            <label className="sr-only" htmlFor={inputId}>Reply in this thread</label>
            <input id={inputId} value={text} placeholder="Still unsure? Ask more…" autoComplete="off" maxLength={1_000} onChange={(event) => setText(event.target.value)} />
            <button className="doubt-resolve" type="button" aria-pressed={resolved} onClick={() => onResolve(!resolved)}>{resolved ? <><RotateCcw aria-hidden="true" />Reopen</> : <><Check aria-hidden="true" />Got it</>}</button>
          </form>
        </>}
      </div>
    </section>
  );
}

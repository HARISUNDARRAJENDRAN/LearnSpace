"use client";

import type { TutorBlockView, TutorMessageView, TutorSource } from "@learnspace/shared/tutor";
import { BookOpen, Check, CornerDownRight, Lightbulb, Play, Quote, Repeat, X } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext, useLayoutEffect, useRef } from "react";
import { MathText } from "./MathText";
import { formatTime } from "./StudyWorkspace";

/** Everything a block may do. Each action is an app-owned request the server authorizes; blocks carry no URLs or code. */
export type TutorActions = {
  seek: (positionMs: number) => void;
  answer: (messageId: string, blockId: string, choice: number) => void;
  hint: (messageId: string, blockId: string) => void;
  reply: (messageId: string, blockId: string, prompt: string) => void;
  /** Sends a question about a block straight away. */
  ask: (messageId: string, blockId: string, prompt: string, question: string) => void;
  busy: boolean;
};

type BlockProps<T extends TutorBlockView["type"]> = { block: Extract<TutorBlockView, { type: T }>; message: TutorMessageView; actions: TutorActions };

function Cites({ src, message, actions }: { src: number[]; message: TutorMessageView; actions: TutorActions }) {
  // A transcript without timestamps has no moment to jump to, so its passages get no pill.
  const sources = src.flatMap((index) => message.sources[index]?.startMs != null ? [message.sources[index]] : []);
  if (sources.length === 0) return null;
  return <span className="tutor-cites">{sources.map((source) => <Cite key={source.chunkId} source={source} actions={actions} />)}</span>;
}

function Cite({ source, actions }: { source: TutorSource; actions: TutorActions }) {
  if (source.startMs === null) return null;
  const at = formatTime(source.startMs);
  return <button className="tutor-cite" type="button" title={source.excerpt} aria-label={`Play the video from ${at}`} onClick={() => actions.seek(source.startMs!)}><Play aria-hidden="true" />{at}</button>;
}

const WORD_MS = 55;
const MAX_REVEAL_MS = 6_000;
// While a fresh answer is revealed, its words render one span each so they can resolve in sequence.
const Revealing = createContext(false);
// While an answer streams in, its last words may be half a formula or half a **bold**.
const Streaming = createContext(false);

function Words({ text }: { text: string }) {
  // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's text never reorders.
  return <>{text.split(/(\s+)/).map((part, index) => index % 2 || !part ? part : <span className="stream-word" key={index}>{part}</span>)}</>;
}

/** The model marks key words as **bold** and writes math as LaTeX; that is the only formatting it may use, and everything else stays plain text. */
function Rich({ text }: { text: string }) {
  const revealing = useContext(Revealing);
  const partial = useContext(Streaming);
  const show = (part: string) => <MathText text={part} partial={partial} render={(words) => revealing ? <Words text={words} /> : words} />;
  // An unclosed ** still being written is dropped rather than shown.
  const marks = text.match(/\*\*/g)?.length ?? 0;
  const settled = partial && marks % 2 === 1 ? text.slice(0, text.lastIndexOf("**")) + text.slice(text.lastIndexOf("**") + 2) : text;
  // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's text never reorders.
  return <>{settled.split(/\*\*(.+?)\*\*/g).map((part, index) => index % 2 ? <strong key={index}>{show(part)}</strong> : <Fragment key={index}>{show(part)}</Fragment>)}</>;
}

const plain = (text: string) => text.replace(/\*\*/g, "");

function Paragraphs({ text }: { text: string }) {
  // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's paragraphs never reorder.
  return <>{text.split(/\n{2,}/).map((paragraph, index) => <p key={index}><Rich text={paragraph} /></p>)}</>;
}

function TextBlock({ block, message, actions }: BlockProps<"text">) {
  return <div className="tutor-text"><Paragraphs text={block.text} /><Cites src={block.src} message={message} actions={actions} /></div>;
}

function ConceptBlock({ block, message, actions }: BlockProps<"concept">) {
  return <section className="tutor-card tutor-concept" aria-label={`Key concept: ${plain(block.term)}`}><span className="tutor-eyebrow">Key concept</span><h4><Rich text={block.term} /></h4><p><Rich text={block.definition} /></p><Cites src={block.src} message={message} actions={actions} /></section>;
}

function ListBlock({ block, message, actions }: BlockProps<"steps" | "outline">) {
  // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's items never reorder.
  const items = block.items.map((item, index) => <li key={index}><span><Rich text={item.text} /></span><Cites src={item.src} message={message} actions={actions} /></li>);
  return (
    <section className={`tutor-card tutor-${block.type}`}>
      {block.title ? <h4><Rich text={block.title} /></h4> : null}
      {block.type === "steps" ? <ol>{items}</ol> : <ul>{items}</ul>}
    </section>
  );
}

function CompareBlock({ block, message, actions }: BlockProps<"compare">) {
  return (
    <section className="tutor-card tutor-compare">
      {block.title ? <h4><Rich text={block.title} /></h4> : null}
      <div className="tutor-compare-columns" style={{ gridTemplateColumns: `repeat(${block.columns.length}, minmax(0, 1fr))` }}>
        {block.columns.map((column) => <div key={column.label}><strong><Rich text={column.label} /></strong><ul>{column.points.map((point) => <li key={point}><Rich text={point} /></li>)}</ul></div>)}
      </div>
      <Cites src={block.src} message={message} actions={actions} />
    </section>
  );
}

function TimelineBlock({ block, message, actions }: BlockProps<"timeline">) {
  return (
    <section className="tutor-card tutor-timeline">
      {block.title ? <h4><Rich text={block.title} /></h4> : null}
      <ol>{block.items.map((item, index) => {
        const source = message.sources[item.src];
        // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's items never reorder.
        return <li key={index}>{source ? <Cite source={source} actions={actions} /> : null}<span><Rich text={item.label} /></span></li>;
      })}</ol>
    </section>
  );
}

function FlowBlock({ block, message, actions }: BlockProps<"flow">) {
    return (
    <section className="tutor-card tutor-flow" aria-label={plain(block.title) || "Diagram"}>
      {block.title ? <h4><Rich text={block.title} /></h4> : null}
      <ol>{block.nodes.map((node, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's nodes never reorder.
        <li key={index}>
          <div className="tutor-node">
            <strong><Rich text={node.label} /></strong>
            {node.detail ? <span><Rich text={node.detail} /></span> : null}
            <Cites src={node.src} message={message} actions={actions} />
          </div>
          {index < block.nodes.length - 1 || block.loop ? <div className="tutor-arrow">{node.arrow ? <span>{node.arrow}</span> : null}</div> : null}
        </li>
      ))}</ol>
      {block.loop ? <p className="tutor-loop"><Repeat aria-hidden="true" />Back to {block.nodes[0]?.label}</p> : null}
    </section>
  );
}

function TreeBlock({ block, message, actions }: BlockProps<"tree">) {
  return (
    <section className="tutor-card tutor-tree" aria-label={plain(block.title || block.root)}>
      {block.title ? <h4><Rich text={block.title} /></h4> : null}
      <div className="tutor-tree-root"><strong><Rich text={block.root} /></strong><Cites src={block.src} message={message} actions={actions} /></div>
      <ul>{block.branches.map((branch, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's branches never reorder.
        <li key={index}>
          <div className="tutor-node">
            <strong><Rich text={branch.label} /></strong>
            {branch.detail ? <span><Rich text={branch.detail} /></span> : null}
            {branch.leaves.length ? <ul className="tutor-leaves">{branch.leaves.map((leaf) => <li key={leaf}><Rich text={leaf} /></li>)}</ul> : null}
            <Cites src={branch.src} message={message} actions={actions} />
          </div>
        </li>
      ))}</ul>
    </section>
  );
}

function EvidenceBlock({ block, message, actions }: BlockProps<"evidence">) {
  const source = message.sources[block.src];
  if (!source) return null;
  return <figure className="tutor-evidence"><Quote aria-hidden="true" /><blockquote>{source.excerpt}</blockquote><figcaption>{block.note ? <span><Rich text={block.note} /></span> : null}<Cite source={source} actions={actions} /></figcaption></figure>;
}

function HintButton({ block, message, actions }: { block: Extract<TutorBlockView, { type: "question" | "check" }>; message: TutorMessageView; actions: TutorActions }) {
  if (block.hint) return <p className="tutor-hint"><Lightbulb aria-hidden="true" /><Rich text={block.hint} /></p>;
  if (!block.hintAvailable) return null;
  return <button className="session-link-button" type="button" disabled={actions.busy} onClick={() => actions.hint(message.id, block.id)}><Lightbulb aria-hidden="true" />Show a hint</button>;
}

function QuestionBlock({ block, message, actions }: BlockProps<"question">) {
  return (
    <section className="tutor-card tutor-question" aria-label="Question for you">
      <span className="tutor-eyebrow">Your turn</span>
      <p className="tutor-prompt"><Rich text={block.prompt} /></p>
      <div className="tutor-row">
        <button className="session-secondary-button" type="button" disabled={actions.busy} onClick={() => actions.reply(message.id, block.id, block.prompt)}><CornerDownRight aria-hidden="true" />Answer</button>
        <HintButton block={block} message={message} actions={actions} />
        <Cites src={block.src} message={message} actions={actions} />
      </div>
    </section>
  );
}

function CheckBlock({ block, message, actions }: BlockProps<"check">) {
  const result = block.result;
  return (
    <section className="tutor-card tutor-check" aria-label="Check your understanding">
      <span className="tutor-eyebrow">Check your understanding</span>
      <p className="tutor-prompt" id={`${message.id}-${block.id}`}><Rich text={block.question} /></p>
      <ol className="session-quiz-options" aria-labelledby={`${message.id}-${block.id}`}>
        {block.options.map((option, index) => {
          const state = !result ? "" : index === result.answer ? " is-correct" : index === result.choice ? " is-wrong" : "";
          return <li key={option}><button className={`session-quiz-option${state}`} type="button" disabled={Boolean(result) || actions.busy} aria-pressed={result?.choice === index} onClick={() => actions.answer(message.id, block.id, index)}><span>{String.fromCharCode(65 + index)}</span><Rich text={option} />{state === " is-correct" ? <Check aria-label="Correct answer" /> : state === " is-wrong" ? <X aria-label="Your answer" /> : null}</button></li>;
        })}
      </ol>
      {result ? (
        <div className="session-quiz-feedback" role="status">
          <strong>{result.correct ? "Correct" : "Not quite"}</strong>
          {result.explanation ? <p><Rich text={result.explanation} /></p> : null}
          <div className="tutor-row">
            <Cites src={block.src} message={message} actions={actions} />
            <button className="session-secondary-button" type="button" disabled={actions.busy} onClick={() => actions.ask(message.id, block.id, block.question, result.correct ? "Got it. Give me the next question." : "Help me understand why my answer was wrong.")}>{result.correct ? "Keep going" : "Help me understand"}</button>
          </div>
        </div>
      ) : <div className="tutor-row"><HintButton block={block} message={message} actions={actions} /></div>}
    </section>
  );
}

// The fixed catalog: the server validates every block against the same schema, so an unknown type never gets here.
const registry: { [T in TutorBlockView["type"]]: (props: BlockProps<T>) => ReactNode } = {
  text: TextBlock,
  concept: ConceptBlock,
  steps: (props) => <ListBlock {...props} />,
  outline: (props) => <ListBlock {...props} />,
  compare: CompareBlock,
  timeline: TimelineBlock,
  flow: FlowBlock,
  tree: TreeBlock,
  evidence: EvidenceBlock,
  question: QuestionBlock,
  check: CheckBlock,
};

/**
 * `revealing` plays a just-arrived answer in word by word, then calls `onRevealed`; `streaming` resolves each word as it
 * arrives in a draft that is still being written; stored answers render at once.
 */
/** Whether a block cites the video; one that doesn't is the tutor's own general knowledge. */
function fromVideo(block: TutorBlockView): boolean {
  if (block.type === "steps" || block.type === "outline") return block.items.some((item) => item.src.length > 0);
  if (block.type === "flow") return block.nodes.some((node) => node.src.length > 0);
  if (block.type === "timeline" || block.type === "evidence") return true;
  return block.src.length > 0;
}

export function TutorAnswer({ message, actions, revealing = false, streaming = false, onRevealed, after }: { message: TutorMessageView; actions: TutorActions; revealing?: boolean; streaming?: boolean; onRevealed?: () => void; after?: (blockId: string) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Delays are set from the rendered order before paint, so words, citations and diagram nodes resolve in reading order.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!revealing || !root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onRevealed?.();
      return;
    }
    const items = root.querySelectorAll<HTMLElement>(".stream-word, .tutor-cite, .tutor-evidence, .tutor-node, .session-quiz-option");
    const step = Math.min(WORD_MS, MAX_REVEAL_MS / Math.max(1, items.length));
    items.forEach((item, index) => { item.style.animationDelay = `${Math.round(index * step)}ms`; });
    const timer = window.setTimeout(() => onRevealed?.(), items.length * step + 300);
    return () => window.clearTimeout(timer);
  }, [revealing, onRevealed]);
  return (
    <Revealing value={revealing || streaming}>
    <Streaming value={streaming}>
      <div className={`tutor-answer${revealing ? " is-revealing" : streaming ? " is-streaming" : ""}`} ref={ref}>
        {message.blocks.map((block, index) => {
          const Render = registry[block.type] as (props: BlockProps<typeof block.type>) => ReactNode;
          const previous = message.blocks[index - 1];
          // In an answer from the video, a run of blocks from general knowledge is labelled where it starts.
          const beyond = message.outcome === "answer" && !fromVideo(block) && (!previous || fromVideo(previous));
          // Doubts about a block follow it, outside its wrapper, so the block's text is only its own.
          return <Fragment key={block.id}>{beyond ? <p className="chat-general-note"><BookOpen aria-hidden="true" />Beyond this video</p> : null}<div className="tutor-block" data-block-id={block.id}><Render block={block} message={message} actions={actions} /></div>{after?.(block.id)}</Fragment>;
        })}
      </div>
    </Streaming>
    </Revealing>
  );
}

"use client";

import type { TutorBlockView, TutorMessageView, TutorSource } from "@learnspace/shared/tutor";
import { Check, CornerDownRight, Lightbulb, Play, Quote, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatTime } from "./StudyWorkspace";

/** Everything a block may do. Each action is an app-owned request the server authorizes; blocks carry no URLs or code. */
export type TutorActions = {
  seek: (positionMs: number) => void;
  answer: (messageId: string, blockId: string, choice: number) => void;
  hint: (messageId: string, blockId: string) => void;
  reply: (messageId: string, blockId: string, prompt: string) => void;
  busy: boolean;
};

type BlockProps<T extends TutorBlockView["type"]> = { block: Extract<TutorBlockView, { type: T }>; message: TutorMessageView; actions: TutorActions };

function Cites({ src, message, actions }: { src: number[]; message: TutorMessageView; actions: TutorActions }) {
  const sources = src.flatMap((index) => message.sources[index] ? [message.sources[index]] : []);
  if (sources.length === 0) return null;
  return <span className="tutor-cites">{sources.map((source) => <Cite key={source.chunkId} source={source} actions={actions} />)}</span>;
}

function Cite({ source, actions }: { source: TutorSource; actions: TutorActions }) {
  if (source.startMs === null) return <span className="tutor-cite is-static" title={source.excerpt}>Transcript</span>;
  const at = formatTime(source.startMs);
  return <button className="tutor-cite" type="button" title={source.excerpt} aria-label={`Play the video from ${at}`} onClick={() => actions.seek(source.startMs!)}><Play aria-hidden="true" />{at}</button>;
}

function Paragraphs({ text }: { text: string }) {
  // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's paragraphs never reorder.
  return <>{text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</>;
}

function TextBlock({ block, message, actions }: BlockProps<"text">) {
  return <div className="tutor-text"><Paragraphs text={block.text} /><Cites src={block.src} message={message} actions={actions} /></div>;
}

function ConceptBlock({ block, message, actions }: BlockProps<"concept">) {
  return <section className="tutor-card tutor-concept" aria-label={`Key concept: ${block.term}`}><span className="tutor-eyebrow">Key concept</span><h4>{block.term}</h4><p>{block.definition}</p><Cites src={block.src} message={message} actions={actions} /></section>;
}

function ListBlock({ block, message, actions }: BlockProps<"steps" | "outline">) {
  // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's items never reorder.
  const items = block.items.map((item, index) => <li key={index}><span>{item.text}</span><Cites src={item.src} message={message} actions={actions} /></li>);
  return (
    <section className={`tutor-card tutor-${block.type}`}>
      {block.title ? <h4>{block.title}</h4> : null}
      {block.type === "steps" ? <ol>{items}</ol> : <ul>{items}</ul>}
    </section>
  );
}

function CompareBlock({ block, message, actions }: BlockProps<"compare">) {
  return (
    <section className="tutor-card tutor-compare">
      {block.title ? <h4>{block.title}</h4> : null}
      <div className="tutor-compare-columns" style={{ gridTemplateColumns: `repeat(${block.columns.length}, minmax(0, 1fr))` }}>
        {block.columns.map((column) => <div key={column.label}><strong>{column.label}</strong><ul>{column.points.map((point) => <li key={point}>{point}</li>)}</ul></div>)}
      </div>
      <Cites src={block.src} message={message} actions={actions} />
    </section>
  );
}

function TimelineBlock({ block, message, actions }: BlockProps<"timeline">) {
  return (
    <section className="tutor-card tutor-timeline">
      {block.title ? <h4>{block.title}</h4> : null}
      <ol>{block.items.map((item, index) => {
        const source = message.sources[item.src];
        // biome-ignore lint/suspicious/noArrayIndexKey: a stored answer's items never reorder.
        return <li key={index}>{source ? <Cite source={source} actions={actions} /> : null}<span>{item.label}</span></li>;
      })}</ol>
    </section>
  );
}

function EvidenceBlock({ block, message, actions }: BlockProps<"evidence">) {
  const source = message.sources[block.src];
  if (!source) return null;
  return <figure className="tutor-evidence"><Quote aria-hidden="true" /><blockquote>{source.excerpt}</blockquote><figcaption>{block.note ? <span>{block.note}</span> : null}<Cite source={source} actions={actions} /></figcaption></figure>;
}

function HintButton({ block, message, actions }: { block: Extract<TutorBlockView, { type: "question" | "check" }>; message: TutorMessageView; actions: TutorActions }) {
  if (block.hint) return <p className="tutor-hint"><Lightbulb aria-hidden="true" />{block.hint}</p>;
  if (!block.hintAvailable) return null;
  return <button className="session-link-button" type="button" disabled={actions.busy} onClick={() => actions.hint(message.id, block.id)}><Lightbulb aria-hidden="true" />Show a hint</button>;
}

function QuestionBlock({ block, message, actions }: BlockProps<"question">) {
  return (
    <section className="tutor-card tutor-question" aria-label="Question for you">
      <span className="tutor-eyebrow">Your turn</span>
      <p className="tutor-prompt">{block.prompt}</p>
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
      <p className="tutor-prompt" id={`${message.id}-${block.id}`}>{block.question}</p>
      <ol className="session-quiz-options" aria-labelledby={`${message.id}-${block.id}`}>
        {block.options.map((option, index) => {
          const state = !result ? "" : index === result.answer ? " is-correct" : index === result.choice ? " is-wrong" : "";
          return <li key={option}><button className={`session-quiz-option${state}`} type="button" disabled={Boolean(result) || actions.busy} aria-pressed={result?.choice === index} onClick={() => actions.answer(message.id, block.id, index)}><span>{String.fromCharCode(65 + index)}</span>{option}{state === " is-correct" ? <Check aria-label="Correct answer" /> : state === " is-wrong" ? <X aria-label="Your answer" /> : null}</button></li>;
        })}
      </ol>
      {result ? (
        <div className="session-quiz-feedback" role="status">
          <strong>{result.correct ? "Correct" : "Not quite"}</strong>
          {result.explanation ? <p>{result.explanation}</p> : null}
          <div className="tutor-row">
            <Cites src={block.src} message={message} actions={actions} />
            <button className="session-secondary-button" type="button" disabled={actions.busy} onClick={() => actions.reply(message.id, block.id, block.question)}>{result.correct ? "Keep going" : "Help me understand"}</button>
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
  evidence: EvidenceBlock,
  question: QuestionBlock,
  check: CheckBlock,
};

export function TutorAnswer({ message, actions }: { message: TutorMessageView; actions: TutorActions }) {
  return (
    <div className="tutor-answer">
      {message.blocks.map((block) => {
        const Render = registry[block.type] as (props: BlockProps<typeof block.type>) => ReactNode;
        return <Render key={block.id} block={block} message={message} actions={actions} />;
      })}
    </div>
  );
}

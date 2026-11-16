import type { Signature } from "@learnspace/shared/coding";
import { Fragment, type ReactNode } from "react";

/** `code` and **bold** inside a line, as React elements (never HTML), so model-written text can't inject markup. */
export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(match[1] !== undefined ? <code key={match.index}>{match[1]}</code> : <strong key={match.index}>{match[2]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  // biome-ignore lint/suspicious/noArrayIndexKey: parsed text parts never reorder.
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}

/** Paragraphs and "- " lists from plain text with inline Markdown. */
// biome-ignore-start lint/suspicious/noArrayIndexKey: paragraphs, items and lines of fixed text never reorder.
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*] /.test(line))) return <ul key={index}>{lines.map((line, item) => <li key={item}><Inline text={line.replace(/^\s*[-*] /, "")} /></li>)}</ul>;
        return <p key={index}>{lines.map((line, item) => <Fragment key={item}>{item ? <br /> : null}<Inline text={line} /></Fragment>)}</p>;
      })}
    </div>
  );
}
// biome-ignore-end lint/suspicious/noArrayIndexKey: paragraphs, items and lines of fixed text never reorder.

export const formatValue = (value: unknown) => JSON.stringify(value) ?? "null";

/** A case's arguments as LeetCode shows them: one `name = value` per parameter. */
export function Args({ signature, args }: { signature: Signature; args: unknown[] }) {
  return <>{signature.params.map((param, index) => <div key={param.name} className="coding-value"><span>{param.name} =</span><code>{formatValue(args[index])}</code></div>)}</>;
}

/** The text a learner edits for a custom case: one JSON value per line, one line per parameter. */
export const caseText = (args: unknown[]) => args.map(formatValue).join("\n");

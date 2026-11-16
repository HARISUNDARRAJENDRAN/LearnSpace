"use client";

import hljs from "highlight.js/lib/common";
import { Check, Pencil } from "lucide-react";
import { useState } from "react";
import { MathText } from "./MathText";
import { safeNoteUrl, tableRows } from "./note-text";
import { NoteDiagram } from "./NoteDiagram";

export type MediaKind = "image" | "link" | "diagram" | "code" | "table";

/** Code is highlighted as its language, or guessed when highlight.js doesn't know it. */
function highlighted(text: string): { language: string; html: string } {
  const [first = "", ...rest] = text.split("\n");
  const language = first.trim().toLowerCase();
  const code = rest.join("\n");
  const known = hljs.getLanguage(language);
  return { language, html: (known ? hljs.highlight(code, { language, ignoreIllegals: true }) : hljs.highlightAuto(code)).value };
}

/** A code block or table reads rendered; Edit opens its source, and leaving the box keeps the change. */
function SourceBlock({ kind, text, onChange }: { kind: "code" | "table"; text: string; onChange: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const toggle = <button className="notes-source-toggle" type="button" aria-label={editing ? "Done editing" : `Edit ${kind}`} title={editing ? "Done" : "Edit"} onMouseDown={(event) => event.preventDefault()} onClick={() => setEditing(!editing)}>
    {editing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
  </button>;
  if (editing) {
    return <div className="notes-source is-editing">{toggle}
      {/* biome-ignore lint/a11y/noAutofocus: the box opens on the learner's click on Edit, so typing goes straight into it. */}
      <textarea className="notes-source-edit" autoFocus defaultValue={text} spellCheck={false} aria-label={kind === "code" ? "Code, with its language on the first line" : "Table, in Markdown"}
        rows={Math.min(24, text.split("\n").length + 1)} onBlur={(event) => { setEditing(false); if (event.currentTarget.value.trim() && event.currentTarget.value !== text) onChange(event.currentTarget.value); }} />
    </div>;
  }
  if (kind === "code") {
    const { language, html } = highlighted(text);
    return <div className="notes-source notes-code">{toggle}
      {language ? <span className="notes-code-language">{language}</span> : null}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js escapes the code and emits only its own span markup. */}
      <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>;
  }
  const [head = [], ...rows] = tableRows(text);
  // Cells never reorder, so they are keyed by position.
  /* biome-ignore-start lint/suspicious/noArrayIndexKey: see above. */
  return <div className="notes-source notes-table">{toggle}
    <table>
      <thead><tr>{head.map((cell, index) => <th key={index} scope="col"><MathText text={cell} render={strong} /></th>)}</tr></thead>
      <tbody>{rows.map((row, at) => <tr key={at}>{head.map((_, index) => <td key={index}><MathText text={row[index] ?? ""} render={strong} /></td>)}</tr>)}</tbody>
    </table>
  </div>;
  /* biome-ignore-end lint/suspicious/noArrayIndexKey: see above. */
}

/** **bold** in a table cell. */
// biome-ignore lint/suspicious/noArrayIndexKey: a cell's parts never reorder.
const strong = (text: string) => text.split(/\*\*(.+?)\*\*/).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part);

/** A diagram is an editable drawing from a small JSON contract, never generated SVG, HTML or JavaScript. */
export function NoteMedia({ type, text, onChange }: { type: MediaKind; text: string; onChange: (text: string) => void }) {
  if (type === "diagram") return <NoteDiagram text={text} onChange={onChange} />;
  if (type === "code" || type === "table") return <SourceBlock kind={type} text={text} onChange={onChange} />;
  const value = safeNoteUrl(text);
  if (!value) return <p className="notes-media-error">Add a valid HTTPS source.</p>;
  return <figure className="notes-media">
    {type === "image" ? <img src={value.url} alt={value.caption} loading="lazy" referrerPolicy="no-referrer" /> : null}
    <figcaption><a href={value.url} target="_blank" rel="noreferrer">{value.caption}</a></figcaption>
  </figure>;
}

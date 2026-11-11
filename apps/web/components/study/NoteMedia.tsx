"use client";

import { diagramSchema } from "@learnspace/shared/notes";
import { useId } from "react";

export function safeNoteUrl(text: string): { url: string; caption: string } | null {
  const [raw = "", ...rest] = text.split("\n");
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { url: url.href, caption: rest.join("\n").trim() || url.hostname };
  } catch { return null; }
}

/** A small, editable diagram contract instead of executing generated SVG, HTML or JavaScript. */
export function NoteDiagram({ text }: { text: string }) {
  const marker = useId().replaceAll(":", "");
  let parsed: ReturnType<typeof diagramSchema.safeParse>;
  try { parsed = diagramSchema.safeParse(JSON.parse(text)); } catch { return <p className="notes-media-error">This diagram needs correcting.</p>; }
  if (!parsed.success) return <p className="notes-media-error">This diagram needs correcting.</p>;
  const { nodes, edges } = parsed.data;
  const xy = (node: typeof nodes[number]) => ({ x: 70 + node.x * 460, y: 35 + node.y * 270 });
  return <svg className="notes-diagram" viewBox="0 0 600 340" role="img" aria-label={`Diagram: ${nodes.map((node) => node.label).join(", ")}`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
    {edges.map((edge) => {
      const from = nodes.find((node) => node.id === edge.from); const to = nodes.find((node) => node.id === edge.to);
      if (!from || !to) return null;
      const a = xy(from); const b = xy(to);
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return <g key={`${edge.from}-${edge.to}-${edge.label}`} className="notes-diagram-edge"><path d={`M ${a.x} ${a.y} L ${b.x - (b.x - a.x) / d * 64} ${b.y - (b.y - a.y) / d * 25}`} markerEnd={`url(#${marker})`} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10}>{edge.label}</text></g>;
    })}
    {nodes.map((node) => { const { x, y } = xy(node); return <g key={node.id} className="notes-diagram-node"><rect x={x - 64} y={y - 24} width={128} height={48} rx={12} /><foreignObject x={x - 60} y={y - 22} width={120} height={44}><div className="notes-diagram-label">{node.label}</div></foreignObject></g>; })}
  </svg>;
}

export function NoteMedia({ type, text }: { type: "image" | "link" | "diagram"; text: string }) {
  if (type === "diagram") return <NoteDiagram text={text} />;
  const value = safeNoteUrl(text);
  if (!value) return <p className="notes-media-error">Add a valid HTTPS source.</p>;
  return <figure className="notes-media">
    {type === "image" ? <img src={value.url} alt={value.caption} loading="lazy" referrerPolicy="no-referrer" /> : null}
    <figcaption><a href={value.url} target="_blank" rel="noreferrer">{value.caption}</a></figcaption>
  </figure>;
}

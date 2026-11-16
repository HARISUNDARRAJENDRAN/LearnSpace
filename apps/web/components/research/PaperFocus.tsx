"use client";

import "katex/dist/katex.min.css";
import katex from "katex";
import { ArrowUpRight, FileText, Minus, Plus, Sparkles, Type, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { forwardRef, Fragment, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { PaperBlock, PaperContent, PaperReference } from "../../lib/research/paper-content";
import { MathText } from "../study/MathText";
import { loadPdfjs, type PaperSelection } from "./PaperReader";

export type PaperFocusHandle = { goTo: (target: { page?: number | null; sectionId?: string | null; chunkId?: string | null; reference?: number | null }) => void };
type Theme = "paper" | "sepia" | "night";
type Settings = { theme: Theme; size: number; columns: 1 | 2 };

const SETTINGS_KEY = "learnspace.paper-focus";
const DEFAULT_SETTINGS: Settings = { theme: "paper", size: 17, columns: 2 };
// Bracketed numeric citations: [4], [3, 7], [12–15].
const CITATION = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

function readSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Settings> | null;
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch { return DEFAULT_SETTINGS; }
}

function expandCitation(group: string): number[] {
  return group.split(",").flatMap((part) => {
    const [from, to] = part.split(/[–-]/).map((n) => Number(n.trim()));
    if (!from) return [];
    return to && to > from && to - from < 30 ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [from];
  });
}

function formatDate(date: string | null) {
  return date ? new Date(`${date}T00:00:00`).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" }) : null;
}

/** A heading as a journal sets it: top-level sections numbered in roman numerals unless the paper already numbers them. */
function headingText(block: PaperBlock, topIndex: number) {
  const title = block.content.trim();
  if (block.headingPath.length > 1 || /^([0-9IVX]+\.?|[A-Z]\.)\s/.test(title) || /^(abstract|references|acknowledg)/i.test(title)) return title;
  return `${ROMAN[topIndex] ?? topIndex + 1}. ${title}`;
}

/** A figure, cropped from its PDF page when the parser gave a box, so Focus mode shows the paper's own artwork. */
function FigureCrop({ doc, page, bbox, alt }: { doc: PDFDocumentProxy; page: number; bbox: [number, number, number, number]; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void doc.getPage(page).then(async (pdfPage) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const [x0, y0, x1, y1] = bbox;
      const scale = Math.min(3, Math.max(1.5, 900 / Math.max(1, x1 - x0))) * Math.min(window.devicePixelRatio || 1, 2) / 1.5;
      const viewport = pdfPage.getViewport({ scale, offsetX: -x0 * scale, offsetY: -y0 * scale });
      canvas.width = Math.ceil((x1 - x0) * scale);
      canvas.height = Math.ceil((y1 - y0) * scale);
      const render = pdfPage.render({ canvas, viewport });
      task = render;
      await render.promise.catch(() => undefined);
    }).catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, bbox]);
  return <canvas ref={canvasRef} className="paper-focus-figure-art" role="img" aria-label={alt} />;
}

type Props = {
  content: PaperContent | null;
  failed: boolean;
  onClose: () => void;
  onAsk?: ((selection: PaperSelection) => void) | undefined;
  onAskReference?: ((reference: PaperReference) => void) | undefined;
  onOpenResource?: ((resourceId: string) => void) | undefined;
};

/** The paper re-typeset natively from its parsed passages: journal layout, real equations, live citations, readable in any theme. */
export const PaperFocus = forwardRef<PaperFocusHandle, Props>(function PaperFocus({ content, failed, onClose, onAsk, onAskReference, onOpenResource }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [reference, setReference] = useState<{ ref: PaperReference; x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<(PaperSelection & { x: number; y: number }) | null>(null);

  useEffect(() => { setSettings(readSettings()); }, []);
  const update = (next: Partial<Settings>) => setSettings((current) => {
    const merged = { ...current, ...next };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* settings are a per-viewer convenience */ }
    return merged;
  });

  // The PDF is only opened when there is a figure to crop from it.
  const needsPdf = Boolean(content?.blocks.some((block) => block.type === "figure" && block.bbox && block.page));
  useEffect(() => {
    if (!needsPdf || !content) return;
    let loaded: PDFDocumentProxy | null = null;
    let cancelled = false;
    void loadPdfjs().then(async (lib) => {
      loaded = await lib.getDocument({ url: `/api/v1/papers/${content.resourceId}/pdf` }).promise;
      if (!cancelled) setDoc(loaded);
    }).catch(() => undefined);
    return () => { cancelled = true; void loaded?.destroy(); };
  }, [needsPdf, content]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (reference || settingsOpen) { setReference(null); setSettingsOpen(false); } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reference, settingsOpen, onClose]);

  useImperativeHandle(ref, () => ({
    goTo: ({ page, sectionId, chunkId, reference }) => {
      const box = scrollRef.current;
      if (!box) return;
      const target = (reference && box.querySelector<HTMLElement>(`.paper-focus-references li[value="${reference}"]`))
        || (chunkId && box.querySelector<HTMLElement>(`[data-chunk="${CSS.escape(chunkId)}"]`))
        || (sectionId && box.querySelector<HTMLElement>(`[data-section="${CSS.escape(sectionId)}"]`))
        || (page && box.querySelector<HTMLElement>(`[data-page="${page}"]`));
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("is-flash");
      window.setTimeout(() => target.classList.remove("is-flash"), 1600);
    },
  }), []);

  const references = new Map((content?.references ?? []).map((item) => [item.ordinal, item]));
  function showReference(ordinal: number, event: React.MouseEvent<HTMLElement>) {
    const found = references.get(ordinal);
    const box = scrollRef.current;
    if (!found || !box) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    setReference({ ref: found, x: Math.min(rect.left - frame.left, frame.width - 340), y: rect.bottom - frame.top + box.scrollTop + 6 });
  }

  function linkCitations(text: string): ReactNode {
    if (!references.size) return text;
    const out: ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(CITATION)) {
      const ordinals = expandCitation(match[1] ?? "").filter((n) => references.has(n));
      if (!ordinals.length) continue;
      out.push(text.slice(last, match.index));
      out.push(<span key={match.index} className="paper-focus-cite">[{ordinals.map((n, i) => <Fragment key={n}>{i ? ", " : ""}<button type="button" onClick={(event) => showReference(n, event)} aria-label={`Reference ${n}`}>{n}</button></Fragment>)}]</span>);
      last = (match.index ?? 0) + match[0].length;
    }
    out.push(text.slice(last));
    return out;
  }

  function onPointerUp() {
    const chosen = window.getSelection();
    const text = chosen?.toString().trim() ?? "";
    const box = scrollRef.current;
    if (!chosen || !box || text.length < 3 || !box.contains(chosen.anchorNode)) { setSelection(null); return; }
    const rect = chosen.getRangeAt(0).getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    const host = (chosen.anchorNode instanceof Element ? chosen.anchorNode : chosen.anchorNode?.parentElement)?.closest<HTMLElement>("[data-page]");
    setSelection({ text: text.slice(0, 2000), page: Number(host?.dataset.page ?? 1), x: rect.left - frame.left + rect.width / 2, y: rect.top - frame.top + box.scrollTop });
  }

  let topIndex = -1;
  let equationNumber = 0;
  const body = (content?.blocks ?? []).map((block) => {
    const common = { "data-chunk": block.id, "data-page": block.page ?? undefined } as const;
    switch (block.type) {
      case "heading": {
        if (block.headingPath.length <= 1) topIndex += 1;
        const Tag = block.headingPath.length <= 1 ? "h2" : "h3";
        return <Tag key={block.id} {...common} data-section={block.sectionId ?? undefined} className="paper-focus-heading">{headingText(block, topIndex)}</Tag>;
      }
      case "equation": {
        equationNumber += 1;
        const label = block.label ?? `(${equationNumber})`;
        const html = block.latex ? katex.renderToString(block.latex, { displayMode: true, throwOnError: false, output: "htmlAndMathml" }) : null;
        // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX escapes the source and, with trust off, emits only its own markup.
        return <div key={block.id} {...common} className="paper-focus-equation">{html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="paper-focus-equation-text"><MathText text={block.content} /></span>}<span className="paper-focus-equation-label">{label.replace(/^Eq\.\s*/, "")}</span></div>;
      }
      case "figure":
      case "table": {
        const caption = block.caption ?? block.content;
        return <figure key={block.id} {...common} className={`paper-focus-figure is-${block.type}`}>
          {block.type === "figure" && doc && block.bbox && block.page ? <FigureCrop doc={doc} page={block.page} bbox={block.bbox} alt={caption} /> : null}
          {block.type === "table" && block.content && block.content !== caption ? <pre className="paper-focus-table">{block.content}</pre> : null}
          <figcaption>{block.label ? <strong>{block.label}. </strong> : null}<MathText text={caption} render={linkCitations} /></figcaption>
        </figure>;
      }
      case "code":
        return <pre key={block.id} {...common} className="paper-focus-code"><code>{block.content}</code></pre>;
      default:
        return <p key={block.id} {...common} className="paper-focus-paragraph"><MathText text={block.content} render={linkCitations} /></p>;
    }
  });

  const date = formatDate(content?.publicationDate ?? null);
  const header = [content?.venue, content?.arxivId ? `arXiv:${content.arxivId}` : null].filter(Boolean).join(" · ");
  const hasReferences = Boolean(content?.references.length);
  return <div className="paper-focus" data-theme={settings.theme} style={{ "--focus-size": `${settings.size}px` } as React.CSSProperties} role="dialog" aria-modal="true" aria-label={content ? `Focus mode: ${content.title}` : "Focus mode"}>
    <div className="paper-focus-controls">
      <button type="button" className="paper-focus-control" onClick={onClose} aria-label="Leave focus mode" title="Leave focus mode (Esc)"><X aria-hidden="true" /></button>
      <div className="paper-focus-settings-wrap">
        <button type="button" className="paper-focus-control" aria-expanded={settingsOpen} aria-label="Reading settings" onClick={() => setSettingsOpen((open) => !open)}><Type aria-hidden="true" /></button>
        {settingsOpen ? <div className="paper-focus-settings" role="group" aria-label="Reading settings">
          <p>Theme</p>
          <div className="paper-focus-segment">{(["paper", "sepia", "night"] as const).map((theme) => <button key={theme} type="button" aria-pressed={settings.theme === theme} data-swatch={theme} onClick={() => update({ theme })}>{theme === "paper" ? "Paper" : theme === "sepia" ? "Sepia" : "Night"}</button>)}</div>
          <p>Text size</p>
          <div className="paper-focus-segment"><button type="button" aria-label="Smaller text" onClick={() => update({ size: Math.max(14, settings.size - 1) })}><Minus aria-hidden="true" /></button><output>{settings.size}px</output><button type="button" aria-label="Larger text" onClick={() => update({ size: Math.min(24, settings.size + 1) })}><Plus aria-hidden="true" /></button></div>
          <p>Layout</p>
          <div className="paper-focus-segment">{([1, 2] as const).map((columns) => <button key={columns} type="button" aria-pressed={settings.columns === columns} onClick={() => update({ columns })}>{columns === 1 ? "One column" : "Two columns"}</button>)}</div>
        </div> : null}
      </div>
    </div>
    <div ref={scrollRef} className="paper-focus-scroll" data-lenis-prevent onPointerUp={onPointerUp} onClick={(event) => { if (!(event.target as HTMLElement).closest(".paper-focus-cite, .paper-focus-reference")) setReference(null); }}>
      <article className="paper-focus-sheet" data-columns={settings.columns}>
        {!content ? <p className="paper-focus-state" role={failed ? "alert" : "status"}>{failed ? "The paper couldn't be loaded." : "Typesetting the paper…"}</p> : <>
          <header className="paper-focus-masthead">
            <div className="paper-focus-running"><span>{header || "Preprint"}</span><span>{date}</span></div>
            <h1>{content.title}</h1>
            {content.authors.length ? <p className="paper-focus-authors">{content.authors.join(", ")}</p> : null}
            {content.abstract ? <div className="paper-focus-abstract"><MathText text={content.abstract} /></div> : null}
            {content.doi ? <p className="paper-focus-doi">DOI: {content.doi}</p> : null}
          </header>
          {content.status === "ready" && body.length ? <div className="paper-focus-body">{body}</div>
            : <div className="paper-focus-pending"><FileText aria-hidden="true" /><strong>{content.status === "failed" ? "This paper couldn't be typeset." : "The full text is still being prepared."}</strong><span>{content.status === "failed" ? "Its PDF is still readable in the session." : "Focus mode fills in once the paper is parsed. Meanwhile, read the PDF in the session."}</span><button type="button" onClick={onClose}>Back to the PDF</button></div>}
          {hasReferences ? <section className="paper-focus-references" aria-labelledby="paper-focus-references">
            <h2 id="paper-focus-references" className="paper-focus-heading">References</h2>
            <ol>{content.references.map((item) => <li key={item.ordinal} value={item.ordinal}>{item.raw}</li>)}</ol>
          </section> : null}
        </>}
      </article>
      {reference ? <div className="paper-focus-reference" role="dialog" aria-label={`Reference ${reference.ref.ordinal}`} style={{ left: Math.max(12, reference.x), top: reference.y }}>
        <small>[{reference.ref.ordinal}]{reference.ref.year ? ` · ${reference.ref.year}` : ""}</small>
        <strong>{reference.ref.title ?? reference.ref.raw}</strong>
        {reference.ref.title ? <p>{reference.ref.raw}</p> : null}
        <div className="paper-focus-reference-actions">
          {onAskReference ? <button type="button" onClick={() => { onAskReference(reference.ref); setReference(null); }}><Sparkles aria-hidden="true" />Ask Luny</button> : null}
          {reference.ref.citedResourceId && onOpenResource ? <button type="button" onClick={() => onOpenResource(reference.ref.citedResourceId!)}>Study it</button> : null}
          {reference.ref.url ? <a href={reference.ref.url} target="_blank" rel="noreferrer">Source<ArrowUpRight aria-hidden="true" /></a> : null}
        </div>
      </div> : null}
      {selection && onAsk ? <button type="button" className="paper-reader-ask" style={{ left: selection.x, top: selection.y }} onPointerUp={(event) => event.stopPropagation()} onClick={() => { onAsk({ text: selection.text, page: selection.page }); setSelection(null); window.getSelection()?.removeAllRanges(); }}><Sparkles aria-hidden="true" /> Ask Luny</button> : null}
    </div>
  </div>;
});

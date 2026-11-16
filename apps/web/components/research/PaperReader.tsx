"use client";

import "pdfjs-dist/web/pdf_viewer.css";
import { ChevronDown, ChevronUp, Minus, Plus, ScanLine, Sparkles } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type PaperSection = { id: string; title: string; depth: number; page: number };
export type PaperSelection = { text: string; page: number };
/** A passage box in PDF user space (points, bottom-left origin), as ingestion stores it. */
export type PdfBox = [number, number, number, number];
export type PaperReaderHandle = { goTo: (target: { page?: number | null; sectionId?: string | null; bbox?: PdfBox | null }) => void; page: () => number };
type Mark = { page: number; bbox: PdfBox; key: number };

type Props = {
  resourceId: string;
  title: string;
  initialPage?: number | undefined;
  sections: PaperSection[];
  onPageChange?: (page: number, pageCount: number) => void;
  onAsk?: (selection: PaperSelection) => void;
  /** Extra toolbar controls, e.g. the Focus mode toggle. */
  actions?: React.ReactNode;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.6;
// Pages this far outside the viewport (in px) are drawn ahead of time, so scrolling never shows a blank page.
const RENDER_MARGIN = 1200;
// Fit-to-width stops at a comfortable reading measure on wide screens.
const READING_WIDTH = 940;
const fitScale = (boxWidth: number, pageWidth: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(boxWidth - 48, READING_WIDTH) / pageWidth));

type PdfModule = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfModule> | null = null;
export function loadPdfjs(): Promise<PdfModule> {
  pdfjs ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return module;
  });
  return pdfjs;
}

type PageLink = { box: [number, number, number, number]; url: URL | null; page: number | null };

/** A PDF-space rectangle [x0, y0, x1, y1] as [left, top, width, height] in viewport pixels (handles crop box and rotation). */
function viewportBox(viewport: ReturnType<PDFPageProxy["getViewport"]>, rect: number[]): [number, number, number, number] {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0]!, rect[1]!) as [number, number];
  const [x2, y2] = viewport.convertToViewportPoint(rect[2]!, rect[3]!) as [number, number];
  return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
}

/** The page's link annotations: web links (http and https only) and links within the paper, resolved to their page. */
async function pageLinks(doc: PDFDocumentProxy, page: PDFPageProxy, viewport: ReturnType<PDFPageProxy["getViewport"]>): Promise<PageLink[]> {
  const annotations: Array<{ subtype?: string; rect: number[]; url?: string; dest?: unknown }> = await page.getAnnotations({ intent: "display" });
  const links = await Promise.all(annotations.filter((item) => item.subtype === "Link").map(async (item): Promise<PageLink | null> => {
    const box = viewportBox(viewport, item.rect);
    if (item.url) {
      const url = URL.canParse(item.url) ? new URL(item.url) : null;
      return url && (url.protocol === "https:" || url.protocol === "http:") ? { box, url, page: null } : null;
    }
    if (!item.dest) return null;
    const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
    const ref = Array.isArray(dest) ? dest[0] : null;
    if (!ref) return null;
    const index = typeof ref === "number" ? ref : await doc.getPageIndex(ref).catch(() => null);
    return index === null ? null : { box, url: null, page: index + 1 };
  }).map((link) => link.catch(() => null)));
  return links.filter((link): link is PageLink => link !== null);
}

/** One page: a sized placeholder until it nears the viewport, then canvas, selectable text and its links. */
function PdfPage({ doc, number, scale, width, height, visible, lib, onGoPage, mark, onMarkPlaced }: { doc: PDFDocumentProxy; number: number; scale: number; width: number; height: number; visible: boolean; lib: PdfModule; onGoPage: (page: number) => void; mark: Mark | null; onMarkPlaced: (page: number, top: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PageLink[]>([]);
  const [markBox, setMarkBox] = useState<{ key: number; left: number; top: number; width: number; height: number } | null>(null);
  // The cited passage's box, mapped through this page's viewport (handles crop box and rotation), then brought into view.
  useEffect(() => {
    if (!mark) { setMarkBox(null); return; }
    let cancelled = false;
    void doc.getPage(number).then((page) => {
      if (cancelled) return;
      const [left, top, width, height] = viewportBox(page.getViewport({ scale }), mark.bbox);
      const box = { key: mark.key, left: left - 3, top: top - 3, width: width + 6, height: height + 6 };
      setMarkBox(box);
      onMarkPlaced(number, box.top);
    });
    return () => { cancelled = true; };
  }, [doc, number, scale, mark, onMarkPlaced]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: InstanceType<PdfModule["TextLayer"]> | null = null;
    void doc.getPage(number).then(async (page: PDFPageProxy) => {
      if (cancelled || !canvasRef.current || !textRef.current) return;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise.catch(() => undefined);
      if (cancelled) return;
      textRef.current.replaceChildren();
      textLayer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport });
      await textLayer.render().catch(() => undefined);
      const found = await pageLinks(doc, page, viewport).catch(() => []);
      if (!cancelled) setLinks(found);
    });
    return () => { cancelled = true; task?.cancel(); textLayer?.cancel(); };
  }, [doc, number, scale, visible, lib]);
  return <div className="paper-page" data-page={number} style={{ width, height, "--total-scale-factor": scale, "--scale-factor": scale } as React.CSSProperties}>
    {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas has no tabIndex; the text layer carries the page for assistive tech. */}
    <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />
    <div ref={textRef} className="textLayer" />
    {visible ? links.map((link, index) => {
      const style = { left: link.box[0], top: link.box[1], width: link.box[2], height: link.box[3] };
      /* biome-ignore-start lint/suspicious/noArrayIndexKey: a page's links are read once and never reorder. */
      return link.url
        // biome-ignore lint/a11y/useAnchorContent: the link overlays the PDF's own link text; aria-label names it.
        ? <a key={index} className="paper-page-link" style={style} href={link.url.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${link.url.hostname}`} title={link.url.href} />
        : <button key={index} type="button" className="paper-page-link" style={style} aria-label={`Go to page ${link.page}`} title={`Go to page ${link.page}`} onClick={() => onGoPage(link.page!)} />;
      /* biome-ignore-end lint/suspicious/noArrayIndexKey: see above. */
    }) : null}
    {markBox ? <div key={markBox.key} className="paper-page-mark" style={{ left: markBox.left, top: markBox.top, width: markBox.width, height: markBox.height }} aria-hidden="true" /> : null}
    {visible ? null : <span className="paper-page-number" aria-hidden="true">{number}</span>}
  </div>;
}

export const PaperReader = forwardRef<PaperReaderHandle, Props>(function PaperReader({ resourceId, title, initialPage = 1, sections, onPageChange, onAsk, actions }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lib, setLib] = useState<PdfModule | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [scale, setScale] = useState(1.25);
  const [page, setPage] = useState(initialPage);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [selection, setSelection] = useState<(PaperSelection & { x: number; y: number }) | null>(null);
  const [mark, setMark] = useState<Mark | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const restored = useRef(false);
  // A page asked for while the PDF is still opening; it wins over the saved place once the pages exist.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfModule["getDocument"]> | null = null;
    setState("loading");
    loadPdfjs().then(async (module) => {
      task = module.getDocument({ url: `/api/v1/papers/${resourceId}/pdf` });
      const loaded = await task.promise;
      // Page boxes at scale 1, so every page has its final size before it is drawn (scroll position stays stable).
      const boxes = await Promise.all(Array.from({ length: loaded.numPages }, (_, index) => loaded.getPage(index + 1).then((p) => { const v = p.getViewport({ scale: 1 }); return { width: v.width, height: v.height }; })));
      if (cancelled) return;
      // Fitted before the pages appear, so the restored place is measured at the scale the reader keeps.
      if (scrollRef.current && boxes[0]) setScale(fitScale(scrollRef.current.clientWidth, boxes[0].width));
      setLib(module);
      setDoc(loaded);
      setSizes(boxes);
      setState("ready");
    }).catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [resourceId]);

  const fitWidth = useCallback(() => {
    const box = scrollRef.current;
    const first = sizes[0];
    if (box && first) setScale(fitScale(box.clientWidth, first.width));
  }, [sizes]);

  const scrollToPage = useCallback((target: number, behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (element && scrollRef.current) scrollRef.current.scrollTo({ top: element.offsetTop - 12, behavior });
    else pending.current = target;
  }, []);

  // Which pages are near the viewport (drawn), and which one the reader is on (most visible).
  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box || !sizes.length) return;
    const top = box.scrollTop;
    const bottom = top + box.clientHeight;
    const near = new Set<number>();
    let best = pageRef.current;
    let bestArea = 0;
    for (const element of box.querySelectorAll<HTMLElement>("[data-page]")) {
      const start = element.offsetTop;
      const end = start + element.offsetHeight;
      const number = Number(element.dataset.page);
      if (end > top - RENDER_MARGIN && start < bottom + RENDER_MARGIN) near.add(number);
      const area = Math.min(end, bottom) - Math.max(start, top);
      if (area > bestArea) { bestArea = area; best = number; }
    }
    setVisible((current) => (current.size === near.size && [...near].every((n) => current.has(n)) ? current : near));
    if (best !== pageRef.current) setPage(best);
  }, [sizes.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scale is the re-measure trigger after a zoom.
  useEffect(() => {
    if (state !== "ready") return;
    if (!restored.current) {
      restored.current = true;
      requestAnimationFrame(() => { scrollToPage(pending.current ?? initialPage, "auto"); measure(); });
    } else requestAnimationFrame(measure);
  }, [state, scale, initialPage, scrollToPage, measure]);

  useEffect(() => { if (state === "ready") onPageChange?.(page, sizes.length); }, [page, state, sizes.length, onPageChange]);

  // A marked passage is scrolled to a third of the way down, so the lines before it stay in view.
  const onMarkPlaced = useCallback((target: number, top: number) => {
    const box = scrollRef.current;
    const element = box?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (box && element) box.scrollTo({ top: element.offsetTop + top - box.clientHeight / 3, behavior: "smooth" });
  }, []);

  useImperativeHandle(ref, () => ({
    goTo: ({ page: target, sectionId, bbox }) => {
      const section = sectionId ? sections.find((item) => item.id === sectionId) : undefined;
      // A citation names its exact page; a section alone goes to where the section starts.
      const destination = target ?? section?.page;
      if (!destination) return;
      const clamped = Math.min(Math.max(1, destination), sizes.length || destination);
      setMark(bbox ? { page: clamped, bbox, key: Date.now() } : null);
      if (!bbox) scrollToPage(clamped);
    },
    page: () => pageRef.current,
  }), [sections, scrollToPage, sizes.length]);

  function onPointerUp() {
    const chosen = window.getSelection();
    const text = chosen?.toString().trim() ?? "";
    if (!chosen || text.length < 3 || !scrollRef.current?.contains(chosen.anchorNode)) { setSelection(null); return; }
    const rect = chosen.getRangeAt(0).getBoundingClientRect();
    const box = scrollRef.current.getBoundingClientRect();
    const pageElement = (chosen.anchorNode instanceof Element ? chosen.anchorNode : chosen.anchorNode?.parentElement)?.closest<HTMLElement>("[data-page]");
    setSelection({ text: text.slice(0, 2000), page: Number(pageElement?.dataset.page ?? pageRef.current), x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + scrollRef.current.scrollTop });
  }

  const currentSection = [...sections].reverse().find((section) => section.page <= page);
  const pageCount = sizes.length;
  return <div className="paper-reader">
    <div className="paper-reader-toolbar" role="toolbar" aria-label="Paper controls">
      {sections.length ? <label className="paper-reader-sections"><span className="sr-only">Jump to section</span>
        <select value={currentSection?.id ?? ""} onChange={(event) => { const section = sections.find((item) => item.id === event.target.value); if (section) scrollToPage(section.page); }}>
          {currentSection ? null : <option value="">Sections</option>}
          {sections.map((section) => <option key={section.id} value={section.id}>{" ".repeat(Math.max(0, section.depth - 1))}{section.title}</option>)}
        </select>
      </label> : <span className="paper-reader-title" title={title}>{title}</span>}
      <div className="paper-reader-paging">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => scrollToPage(page - 1)}><ChevronUp aria-hidden="true" /></button>
        <label><span className="sr-only">Page</span><input type="number" min={1} max={pageCount || 1} value={page} onChange={(event) => { const target = Number(event.target.value); if (target >= 1 && target <= pageCount) scrollToPage(target); }} /></label>
        <span>/ {pageCount || "–"}</span>
        <button type="button" aria-label="Next page" disabled={!pageCount || page >= pageCount} onClick={() => scrollToPage(page + 1)}><ChevronDown aria-hidden="true" /></button>
      </div>
      <div className="paper-reader-zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setScale((value) => Math.max(MIN_SCALE, value / 1.15))}><Minus aria-hidden="true" /></button>
        <button type="button" className="paper-reader-zoom-value" aria-label="Fit to width" title="Fit to width" onClick={fitWidth}>{Math.round(scale * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => setScale((value) => Math.min(MAX_SCALE, value * 1.15))}><Plus aria-hidden="true" /></button>
        <button type="button" aria-label="Fit to width" title="Fit to width" onClick={fitWidth}><ScanLine aria-hidden="true" /></button>
      </div>
      {actions}
    </div>
    <div ref={scrollRef} className="paper-reader-scroll" data-lenis-prevent onScroll={measure} onPointerUp={onPointerUp} data-own-wheel onPointerDown={(event) => event.stopPropagation()}>
      {state === "loading" ? <div className="paper-reader-state" role="status">Opening the paper…</div> : null}
      {state === "error" ? <div className="paper-reader-state" role="alert"><strong>This PDF couldn&apos;t be opened here.</strong><span>The source may be unavailable. The parsed text is still in Focus mode, Notes and Luny.</span></div> : null}
      {/* biome-ignore lint/suspicious/noArrayIndexKey: the page number is the page's identity. */}
      {doc && lib ? <div className="paper-reader-pages">{sizes.map((size, index) => <PdfPage key={index + 1} doc={doc} lib={lib} number={index + 1} scale={scale} width={size.width * scale} height={size.height * scale} visible={visible.has(index + 1)} onGoPage={scrollToPage} mark={mark?.page === index + 1 ? mark : null} onMarkPlaced={onMarkPlaced} />)}</div> : null}
      {selection && onAsk ? <button type="button" className="paper-reader-ask" style={{ left: selection.x, top: selection.y }} onPointerUp={(event) => event.stopPropagation()} onClick={() => { onAsk({ text: selection.text, page: selection.page }); setSelection(null); window.getSelection()?.removeAllRanges(); }}><Sparkles aria-hidden="true" /> Ask Luny</button> : null}
    </div>
  </div>;
});

"use client";

import "pdfjs-dist/web/pdf_viewer.css";
import { ChevronDown, ChevronUp, Minus, Plus, ScanLine, Sparkles } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type PaperSection = { id: string; title: string; depth: number; page: number };
export type PaperSelection = { text: string; page: number };
export type PaperReaderHandle = { goTo: (target: { page?: number | null; sectionId?: string | null }) => void; page: () => number };

type Props = {
  resourceId: string;
  title: string;
  initialPage?: number | undefined;
  sections: PaperSection[];
  onPageChange?: (page: number, pageCount: number) => void;
  onAsk?: (selection: PaperSelection) => void;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.6;
// Pages this far outside the viewport (in px) are drawn ahead of time, so scrolling never shows a blank page.
const RENDER_MARGIN = 1200;

type PdfModule = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfModule> | null = null;
function loadPdfjs(): Promise<PdfModule> {
  pdfjs ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return module;
  });
  return pdfjs;
}

/** One page: a sized placeholder until it nears the viewport, then canvas + selectable text layer. */
function PdfPage({ doc, number, scale, width, height, visible, lib }: { doc: PDFDocumentProxy; number: number; scale: number; width: number; height: number; visible: boolean; lib: PdfModule }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
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
    });
    return () => { cancelled = true; task?.cancel(); textLayer?.cancel(); };
  }, [doc, number, scale, visible, lib]);
  return <div className="paper-page" data-page={number} style={{ width, height, "--total-scale-factor": scale, "--scale-factor": scale } as React.CSSProperties}>
    <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />
    <div ref={textRef} className="textLayer" />
    {visible ? null : <span className="paper-page-number" aria-hidden="true">{number}</span>}
  </div>;
}

export const PaperReader = forwardRef<PaperReaderHandle, Props>(function PaperReader({ resourceId, title, initialPage = 1, sections, onPageChange, onAsk }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lib, setLib] = useState<PdfModule | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [scale, setScale] = useState(1.25);
  const [page, setPage] = useState(initialPage);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [selection, setSelection] = useState<(PaperSelection & { x: number; y: number }) | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setState("loading");
    loadPdfjs().then(async (module) => {
      const task = module.getDocument({ url: `/api/v1/papers/${resourceId}/pdf` });
      loaded = await task.promise;
      // Page boxes at scale 1, so every page has its final size before it is drawn (scroll position stays stable).
      const boxes = await Promise.all(Array.from({ length: loaded.numPages }, (_, index) => loaded!.getPage(index + 1).then((p) => { const v = p.getViewport({ scale: 1 }); return { width: v.width, height: v.height }; })));
      if (cancelled) return;
      setLib(module);
      setDoc(loaded);
      setSizes(boxes);
      setState("ready");
    }).catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; void loaded?.destroy(); };
  }, [resourceId]);

  const fitWidth = useCallback(() => {
    const box = scrollRef.current;
    const first = sizes[0];
    if (box && first) setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, (box.clientWidth - 48) / first.width)));
  }, [sizes]);
  useEffect(() => { if (state === "ready") fitWidth(); }, [state, fitWidth]);

  const scrollToPage = useCallback((target: number, behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (element && scrollRef.current) scrollRef.current.scrollTo({ top: element.offsetTop - 12, behavior });
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

  useEffect(() => {
    if (state !== "ready") return;
    if (!restored.current) {
      restored.current = true;
      requestAnimationFrame(() => { scrollToPage(initialPage, "auto"); measure(); });
    } else requestAnimationFrame(measure);
  }, [state, scale, initialPage, scrollToPage, measure]);

  useEffect(() => { if (state === "ready") onPageChange?.(page, sizes.length); }, [page, state, sizes.length, onPageChange]);

  useImperativeHandle(ref, () => ({
    goTo: ({ page: target, sectionId }) => {
      const section = sectionId ? sections.find((item) => item.id === sectionId) : undefined;
      const destination = section?.page ?? target;
      if (destination) scrollToPage(Math.min(Math.max(1, destination), sizes.length || destination));
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
    </div>
    <div ref={scrollRef} className="paper-reader-scroll" data-lenis-prevent onScroll={measure} onPointerUp={onPointerUp} onWheel={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      {state === "loading" ? <div className="paper-reader-state" role="status">Opening the paper…</div> : null}
      {state === "error" ? <div className="paper-reader-state" role="alert"><strong>This PDF couldn&apos;t be opened here.</strong><span>The source may be unavailable. The parsed text is still in Focus mode, Notes and Luny.</span></div> : null}
      {doc && lib ? <div className="paper-reader-pages">{sizes.map((size, index) => <PdfPage key={index + 1} doc={doc} lib={lib} number={index + 1} scale={scale} width={size.width * scale} height={size.height * scale} visible={visible.has(index + 1)} />)}</div> : null}
      {selection && onAsk ? <button type="button" className="paper-reader-ask" style={{ left: selection.x, top: selection.y }} onPointerUp={(event) => event.stopPropagation()} onClick={() => { onAsk({ text: selection.text, page: selection.page }); setSelection(null); window.getSelection()?.removeAllRanges(); }}><Sparkles aria-hidden="true" /> Ask Luny</button> : null}
    </div>
  </div>;
});

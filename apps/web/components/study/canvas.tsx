"use client";

import type { StudyWorkspace } from "@learnspace/shared";
import { CircleStop, Maximize, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFolderReturn } from "../folders/StudyFolderAction";
import { studyHomeHref, useSessions } from "../application/sessions";
import type { CanvasRect } from "./CourseGraph";

/** The whiteboard every study session sits on (videos, courses, papers, paper sets). */
export type CanvasView = { x: number; y: number; zoom: number };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The whiteboard: wheel pans, ctrl/cmd + wheel zooms around the cursor, and dragging the background pans.
 * `home` is what the canvas frames on load and on resize; `bounds` is everything on it, for zoom to fit. A `restored` view
 * (where the learner left this session) is shown instead of home until they move the canvas themselves; `onMoved` hears
 * every view they make.
 */
export function useCanvas(onBackgroundClick: () => void, onBackgroundDoubleClick: () => void, home: CanvasRect, bounds: CanvasRect, homeMargin: number, restored: CanvasView | null, onMoved: () => void) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [view, setView] = useState<CanvasView>(restored ?? { x: 0, y: 0, zoom: 1 });
  const restoredRef = useRef(restored);
  // Once the learner places the canvas (or comes back to a place they chose), resizing the pane keeps their view.
  const placedRef = useRef(restored !== null);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;
  // The learner's own move: the restored view is done with, and the view is theirs to save.
  const release = useCallback(() => {
    restoredRef.current = null;
    placedRef.current = true;
    onMovedRef.current();
  }, []);
  const placed = useCallback(() => placedRef.current, []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const homeRef = useRef(home);
  const boundsRef = useRef(bounds);
  homeRef.current = home;
  boundsRef.current = bounds;

  // Frames a world rectangle in the viewport; the world origin sits at the viewport centre.
  const frame = useCallback((rect: CanvasRect, margin = 160) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    const zoom = clampZoom(Math.min(1, (box.width - margin) / rect.width, (box.height - margin) / rect.height));
    setView({ zoom, x: -(rect.x + rect.width / 2) * zoom, y: -(rect.y + rect.height / 2) * zoom });
  }, []);
  const homeMarginRef = useRef(homeMargin);
  homeMarginRef.current = homeMargin;
  const frameHome = useCallback(() => {
    if (restoredRef.current) setView(restoredRef.current);
    else frame(homeRef.current, homeMarginRef.current);
  }, [frame]);
  const fit = useCallback(() => { release(); frame(boundsRef.current); }, [frame, release]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    release();
    // The world origin sits at the viewport centre, so the zoom anchor is measured from there.
    const px = clientX === undefined ? 0 : clientX - box.left - box.width / 2;
    const py = clientY === undefined ? 0 : clientY - box.top - box.height / 2;
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const scale = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  }, [release]);

  // Reframe whenever the pane changes size (side panel or sidebar toggles) so nothing spills out, until the learner has
  // placed the canvas themselves; their view is centred on the pane, so it stays put as the pane resizes.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const box = viewport.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      if (!placedRef.current || restoredRef.current) frameHome();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [frameHome]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      // A card that scrolls itself (a paper being read) keeps its wheel; the canvas pans only from the board.
      if (event.target instanceof Element && event.target.closest("[data-own-wheel]")) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomBy(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
      else {
        release();
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomBy, release]);

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2 && !drag.moved) {
        drag.moved = true;
        release();
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    },
    onPointerUp: () => {
      if (dragRef.current && !dragRef.current.moved) onBackgroundClick();
      dragRef.current = null;
    },
    onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onBackgroundDoubleClick();
    },
  };

  const resetZoom = useCallback(() => { release(); setView((current) => ({ ...current, zoom: 1 })); }, [release]);
  return { viewportRef, view, size, fit, frameHome, zoomBy, resetZoom, release, placed, handlers };
}

/** Zoom controls for a canvas; `children` go first (e.g. a focus toggle). */
export function ZoomBar({ canvas, children }: { canvas: Pick<ReturnType<typeof useCanvas>, "view" | "fit" | "resetZoom" | "zoomBy">; children?: ReactNode }) {
  return (
    <div className="session-zoom" role="toolbar" aria-label="Zoom">
      {children}
      <button type="button" aria-label="Zoom to fit" title="Zoom to fit" onClick={canvas.fit}><Maximize aria-hidden="true" /></button>
      <button className="session-zoom-value" type="button" aria-label="Reset zoom to 100%" title="Reset zoom" onClick={canvas.resetZoom}>{Math.round(canvas.view.zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => canvas.zoomBy(1.2)}><Plus aria-hidden="true" /></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => canvas.zoomBy(1 / 1.2)}><Minus aria-hidden="true" /></button>
    </div>
  );
}

/** Where the learner left a session's canvas, clamped to what the server accepts. */
export function savedCanvas(view: CanvasView, focused: boolean): NonNullable<StudyWorkspace["canvas"]> {
  const bound = (value: number) => Math.round(Math.min(1e6, Math.max(-1e6, value)));
  return { x: bound(view.x), y: bound(view.y), zoom: clampZoom(view.zoom), focused };
}

/**
 * Ends the session and returns to the folder or study home. Study history stays with the original session.
 */
export function EndSession({ sessionId, mode }: { sessionId: string; mode: "learn" | "research" }) {
  const router = useRouter();
  const returnToFolder = useFolderReturn();
  const { remove } = useSessions();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "ending" | "error">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", onKey); };
  }, [open]);
  async function end() {
    setState("ending");
    try {
      await remove(sessionId);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      router.push(returnToFolder ?? studyHomeHref(mode));
    } catch {
      setState("error");
    }
  }
  return (
    <div className="session-end" ref={rootRef}>
      <button className="session-icon-button" type="button" aria-label="End session" title="End session" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(!open); setState("idle"); }}><CircleStop aria-hidden="true" /></button>
      {open ? (
        <div className="session-end-popover" role="dialog" aria-label="End this session">
          <p><strong>End this session?</strong> It leaves your sessions. If you&apos;ve finished it, it moves to your Library; your progress and notes stay with what you studied.</p>
          {state === "error" ? <p className="session-end-error" role="alert">The session couldn&apos;t be ended. Try again.</p> : null}
          <div className="session-end-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="is-danger" type="button" disabled={state === "ending"} onClick={() => void end()}>{state === "ending" ? "Ending…" : "End session"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


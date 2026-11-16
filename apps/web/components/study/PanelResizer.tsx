"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 320;
const STEP = 24;

const clamp = (width: number) => Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth * 0.7)));
const panelOf = (handle: HTMLElement | null) => handle?.parentElement ?? null;

/** The side panel's draggable left edge. It sets the width on the panel itself, so a drag re-renders only this handle. */
export function PanelResizer({ label, storageKey }: { label: string; storageKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();

  const apply = useCallback((value: number) => {
    const next = clamp(value);
    panelOf(ref.current)?.style.setProperty("--panel-width", `${next}px`);
    setWidth(next);
    return next;
  }, []);

  useEffect(() => {
    let saved = 0;
    try { saved = Number(localStorage.getItem(storageKey)); } catch {}
    if (saved > 0) apply(saved);
    // The panel is shared by every tool, so drop a width another tool's handle left on it.
    else {
      panelOf(ref.current)?.style.removeProperty("--panel-width");
      setWidth(Math.round(panelOf(ref.current)?.getBoundingClientRect().width ?? MIN_WIDTH));
    }
  }, [apply, storageKey]);

  const save = (value: number) => { try { localStorage.setItem(storageKey, String(value)); } catch {} };

  const current = () => panelOf(ref.current)?.getBoundingClientRect().width ?? MIN_WIDTH;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resizable splitter.
    <div
      ref={ref}
      className="session-panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={MIN_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const panel = panelOf(event.currentTarget);
        if (panel && event.currentTarget.hasPointerCapture(event.pointerId)) apply(panel.getBoundingClientRect().right - event.clientX);
      }}
      onPointerUp={() => save(current())}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        save(apply(current() + (event.key === "ArrowLeft" ? STEP : -STEP)));
      }}
    />
  );
}

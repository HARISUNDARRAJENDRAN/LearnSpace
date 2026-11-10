"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "learnspace:chat-width";
const MIN_WIDTH = 320;
const STEP = 24;

const clamp = (width: number) => Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth * 0.7)));
const panelOf = (handle: HTMLElement | null) => handle?.parentElement ?? null;

function save(width: number) {
  try { localStorage.setItem(STORAGE_KEY, String(width)); } catch {}
}

/** The side panel's draggable left edge. It sets the width on the panel itself, so a drag re-renders only this handle. */
export function PanelResizer({ label }: { label: string }) {
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
    try { saved = Number(localStorage.getItem(STORAGE_KEY)); } catch {}
    if (saved > 0) apply(saved);
    else setWidth(Math.round(panelOf(ref.current)?.getBoundingClientRect().width ?? MIN_WIDTH));
  }, [apply]);

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

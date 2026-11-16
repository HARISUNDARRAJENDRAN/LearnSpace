"use client";

import type { CodingStateView } from "@learnspace/shared/coding";
import { useCallback, useEffect, useRef, useState } from "react";
import { codingApi } from "./api";

const REPORT_EVERY_MS = 15_000;
/** Input this recent counts as working; time staring at a page untouched for longer doesn't. */
const IDLE_AFTER_MS = 90_000;
/** Leaving for less than this (a glance at another window) isn't an interruption. */
const AWAY_NOTICE_MS = 3_000;
/** Back after this long, the learner gets a moment to re-orient before the clock counts again. */
const RESUME_AFTER_MS = 30_000;
const PASTE_NOTICE_CHARS = 20;

/**
 * Focus mode's bookkeeping. A browser can't stop anyone leaving a tab, so this doesn't pretend to: it measures focused
 * working time (visible, focused and recently touched), counts the times the learner left and for how long, and counts
 * text pasted in from outside the editor. The server credits the time against its own clock. Every report is also the live
 * tutor's look over the learner's shoulder: how long they've been quiet, and whether the page is in front of them.
 */
export function useFocusActivity(sessionId: string, attemptId: string | null, onState?: (state: CodingStateView) => void) {
  const activeMs = useRef(0);
  const edits = useRef(0);
  const pasted = useRef(0);
  const away = useRef<Array<{ ms: number }>>([]);
  const lastInput = useRef(Date.now());
  const leftAt = useRef<number | null>(null);
  const copied = useRef<string | null>(null);
  const [resume, setResume] = useState<{ awayMs: number } | null>(null);
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  const touch = useCallback(() => { lastInput.current = Date.now(); }, []);
  const edited = useCallback(() => { edits.current += 1; lastInput.current = Date.now(); }, []);
  /** Text copied or cut inside the editor, so pasting it back isn't counted as outside help. */
  const copiedText = useCallback((text: string) => { copied.current = text; }, []);
  const pastedText = useCallback((text: string) => {
    if (text.length >= PASTE_NOTICE_CHARS && text !== copied.current) pasted.current += text.length;
  }, []);

  const flush = useCallback(async (keepalive = false) => {
    // While the learner is looking at the problem, a report goes even with nothing to count: the tutor is watching too,
    // and a quiet stretch is when it checks in.
    const visible = document.visibilityState === "visible" && document.hasFocus() && !resumeRef.current;
    if (!attemptId || (!visible && activeMs.current === 0 && edits.current === 0 && away.current.length === 0)) return;
    const body = {
      attemptId, activeMs: Math.min(120_000, Math.round(activeMs.current)), edits: Math.min(10_000, edits.current), pasted: pasted.current, away: away.current.slice(0, 20),
      idleMs: Math.min(86_400_000, Math.max(0, Math.round(Date.now() - lastInput.current))), visible,
    };
    activeMs.current = 0; edits.current = 0; pasted.current = 0; away.current = [];
    try {
      const state = await codingApi(sessionId, "/activity", { body, keepalive });
      onStateRef.current?.(state);
    } catch {
      // A lost report only under-counts working time; it never blocks the learner.
    }
  }, [attemptId, sessionId]);

  useEffect(() => {
    if (!attemptId) return;
    let tick = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible" && document.hasFocus() && !resumeRef.current && now - lastInput.current < IDLE_AFTER_MS) activeMs.current += now - tick;
      tick = now;
    }, 1_000);
    const report = window.setInterval(() => { void flush(); }, REPORT_EVERY_MS);
    const leave = () => { if (leftAt.current === null) leftAt.current = Date.now(); };
    const back = () => {
      if (leftAt.current === null || document.visibilityState !== "visible") return;
      const ms = Date.now() - leftAt.current;
      leftAt.current = null;
      if (ms >= AWAY_NOTICE_MS) away.current.push({ ms });
      if (ms >= RESUME_AFTER_MS) setResume({ awayMs: ms });
      lastInput.current = Date.now();
    };
    const visibility = () => (document.visibilityState === "hidden" ? leave() : back());
    const unload = () => { void flush(true); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    window.addEventListener("pagehide", unload);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(report);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      window.removeEventListener("pagehide", unload);
      void flush(true);
    };
  }, [attemptId, flush]);

  return { touch, edited, copiedText, pastedText, flush, resume, dismissResume: () => setResume(null) };
}

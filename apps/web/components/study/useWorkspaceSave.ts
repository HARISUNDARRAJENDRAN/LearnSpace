"use client";

import type { StudyWorkspace } from "@learnspace/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "saving" | "error";

// Browsers refuse keepalive bodies over 64 KiB; a larger draft is sent as a normal request, which in-app navigation does not cancel.
const KEEPALIVE_LIMIT = 60_000;
const RETRY_MS = 4_000;

/**
 * Autosaves parts of one session's workspace. Changes are merged and debounced, sent one request at a time (so an older
 * draft can never land after a newer one), kept and retried when a request fails, and flushed when the session closes, the
 * learner switches to another one or the page goes away. Each instance is bound to its session, so switching sessions
 * quickly still writes every change to the session it was made in.
 */
export function useWorkspaceSave(sessionId: string) {
  const pending = useRef<StudyWorkspace>({});
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [codeStatus, setCodeStatus] = useState<SaveStatus>("saved");
  const mounted = useRef(true);
  // A code draft sent but not yet confirmed is still at risk if the page closes before the response.
  const codeInFlight = useRef(0);

  const flush = useCallback((closing = false) => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return queue.current;
    pending.current = {};
    const body = JSON.stringify(patch);
    if (patch.code) setCodeStatus("saving");
    if (patch.code) codeInFlight.current++;
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch(`/api/v1/study-sessions/${sessionId}/workspace`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: closing && body.length < KEEPALIVE_LIMIT });
        // A session deleted meanwhile has nowhere to save to; anything else is worth another try.
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
        if (patch.code && !pending.current.code) setCodeStatus("saved");
      } catch {
        // Newer changes to the same key win; the failed ones come back for the retry.
        pending.current = { ...patch, ...pending.current };
        if (patch.code) setCodeStatus("error");
        if (mounted.current) timer.current = window.setTimeout(() => void flush(), RETRY_MS);
      } finally {
        if (patch.code) codeInFlight.current--;
      }
    });
    return queue.current;
  }, [sessionId]);

  const save = useCallback((patch: StudyWorkspace, delayMs: number) => {
    pending.current = { ...pending.current, ...patch };
    if (patch.code) setCodeStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), delayMs);
  }, [flush]);

  useEffect(() => {
    mounted.current = true;
    const onHide = () => void flush(true);
    // Only work the server has not confirmed is at risk; leaving with it pending asks first.
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (pending.current.code || codeInFlight.current > 0) { void flush(true); event.preventDefault(); } };
    const onVisibility = () => { if (document.visibilityState === "hidden") void flush(true); };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      // Leaving the session in the app (another session, another page) saves what is left.
      mounted.current = false;
      void flush(true);
    };
  }, [flush]);

  return { save, flush, codeStatus };
}

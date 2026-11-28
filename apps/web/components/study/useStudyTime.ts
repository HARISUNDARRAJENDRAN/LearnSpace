"use client";

import { useEffect } from "react";
import type { StudyFocusInterval } from "../../lib/study/focus";

export function useStudyTime(sessionId: string, resourceId: string, enabled: boolean, reading = false) {
  useEffect(() => {
    if (!enabled) return;
    let lastInteraction = Date.now();
    const visible = () => document.visibilityState === "visible" && (!reading || document.hasFocus());
    let startedAt: number | null = visible() ? Date.now() : null;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    let disposed = false;
    async function send(interval: StudyFocusInterval, retry = true) {
      try {
        const response = await fetch(`/api/v1/study-sessions/${sessionId}/focus`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(interval), keepalive: true });
        if (response.status >= 500) throw new Error("Study time not saved");
      } catch {
        if (retry && !disposed) {
          const timer = setTimeout(() => { retries.delete(timer); void send(interval, false); }, 3_000);
          retries.add(timer);
        }
      }
    }
    function flush() {
      const now = Date.now();
      const endedAt = reading ? Math.min(now, lastInteraction + 60_000) : now;
      if (startedAt !== null && endedAt - startedAt >= 1_000 && endedAt - startedAt <= 90_000) {
        void send({ id: crypto.randomUUID(), resourceId, startedAt, endedAt });
      }
      startedAt = visible() && (!reading || now < lastInteraction + 60_000) ? now : null;
    }
    function interact() {
      lastInteraction = Date.now();
      if (startedAt === null && visible()) startedAt = lastInteraction;
    }
    function visibility() { flush(); if (document.visibilityState === "hidden") startedAt = null; else interact(); }
    const timer = setInterval(flush, 60_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    if (reading) window.addEventListener("blur", flush);
    if (reading) for (const event of ["pointerdown", "keydown", "scroll", "focus"] as const) window.addEventListener(event, interact, { capture: true, passive: true });
    return () => {
      disposed = true;
      flush();
      clearInterval(timer);
      for (const retry of retries) clearTimeout(retry);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      if (reading) window.removeEventListener("blur", flush);
      if (reading) for (const event of ["pointerdown", "keydown", "scroll", "focus"] as const) window.removeEventListener(event, interact, true);
    };
  }, [enabled, reading, resourceId, sessionId]);
}

"use client";

import { parseJson3Captions, type TranscriptStatus } from "@learnspace/shared/transcripts";
import { useEffect } from "react";

// The home signer may take a few minutes to reach a new video; stop asking once the learner has been here a while.
const POLL_MS = 30_000;
const MAX_POLLS = 20;

/** Downloads the video's captions from YouTube on the learner's own connection, once per video, for the shared transcript. */
export function useTranscriptCapture(resourceId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const endpoint = `/api/v1/transcripts/${resourceId}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    async function check() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) return;
        const state = await response.json() as TranscriptStatus;
        if (state.status === "queued" && ++polls < MAX_POLLS) timer = setTimeout(() => void check(), POLL_MS);
        if (state.status !== "signed" || new URL(state.captionUrl).origin !== "https://www.youtube.com") return;
        const captions = await fetch(state.captionUrl, { signal: controller.signal, credentials: "omit" });
        if (!captions.ok) return;
        const segments = parseJson3Captions(await captions.json());
        if (segments.length === 0) return;
        await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: state.language, segments }), signal: controller.signal });
      } catch {
        // Best effort: the lesson plays the same without a transcript.
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [resourceId, enabled]);
}

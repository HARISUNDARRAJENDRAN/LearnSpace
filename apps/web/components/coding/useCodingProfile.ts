"use client";

import type { CodingStateView } from "@learnspace/shared/coding";
import { useEffect, useState } from "react";
import { codingApi } from "./api";

const POLL_MS = 8_000;
const MAX_POLLS = 20;

/**
 * Whether the active lesson calls for coding practice, so the Code tool shows itself only on coding lessons. Asking also
 * starts the lesson's classification (once per transcript) and writes its first problem ahead.
 */
export function useCodingProfile(sessionId: string, resourceId: string): CodingStateView["profile"] | null {
  const [profile, setProfile] = useState<CodingStateView["profile"] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new lesson is the trigger.
  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;
    setProfile(null);
    const load = () => {
      codingApi(sessionId, "").then((state) => {
        if (cancelled) return;
        setProfile(state.profile);
        const settling = state.profile.status === "classifying" || state.profile.status === "waiting_transcript";
        polls += 1;
        if (settling && polls < MAX_POLLS) timer = window.setTimeout(load, POLL_MS);
      }, () => undefined);
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sessionId, resourceId]);
  return profile;
}

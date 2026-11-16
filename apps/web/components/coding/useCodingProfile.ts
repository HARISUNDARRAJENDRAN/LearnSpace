"use client";

import type { CodingStateView } from "@learnspace/shared/coding";
import { useEffect, useState } from "react";
import { CodingRequestError, codingApi } from "./api";

const POLL_MS = 8_000;
const MAX_POLLS = 20;

/**
 * Whether the active lesson calls for coding practice, so the Code tool shows itself only on coding lessons. Asking also
 * starts the lesson's classification (once per transcript) and writes its first problem ahead.
 */
export function useCodingProfile(sessionId: string, resourceId: string): CodingStateView["profile"] | null {
  const [current, setCurrent] = useState<{ resourceId: string; profile: CodingStateView["profile"] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;
    setCurrent(null);
    const load = () => {
      codingApi(sessionId, "").then((state) => {
        if (cancelled) return;
        setCurrent({ resourceId, profile: state.profile });
        const settling = state.profile.status === "classifying" || state.profile.status === "waiting_transcript";
        polls += 1;
        if (settling && polls < MAX_POLLS) timer = window.setTimeout(load, POLL_MS);
      }).catch((error: unknown) => {
        if (!cancelled && error instanceof CodingRequestError && error.code === "CODING_NOT_ELIGIBLE") {
          setCurrent({ resourceId, profile: { status: "unavailable", eligible: false, category: null, concepts: [] } });
        }
      });
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sessionId, resourceId]);
  return current?.resourceId === resourceId ? current.profile : null;
}

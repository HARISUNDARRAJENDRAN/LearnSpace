"use client";

import type { CodingEligibilityView } from "@learnspace/shared/coding";
import { useEffect, useState } from "react";
import { codingApi } from "./api";

const POLL_MS = 8_000;
const MAX_POLLS = 20;

/** Whether the active resource has coding practice; null until the server has answered. */
export function useCodingEligibility(sessionId: string, resourceId: string, enabled = true): boolean | null {
  const [capability, setCapability] = useState({ resourceId: "", eligible: false });
  useEffect(() => {
    if (!enabled || !sessionId || !resourceId) return;
    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;
    const load = () => {
      codingApi<CodingEligibilityView>(sessionId, "/eligibility").then((result) => {
        if (cancelled) return;
        setCapability({ resourceId, eligible: result.eligible });
        polls += 1;
        if (result.status === "pending" && polls < MAX_POLLS) timer = window.setTimeout(load, POLL_MS);
      }).catch(() => { if (!cancelled) setCapability({ resourceId, eligible: false }); });
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, sessionId, resourceId]);
  if (!enabled) return false;
  return capability.resourceId === resourceId ? capability.eligible : null;
}

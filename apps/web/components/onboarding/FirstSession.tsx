"use client";

import type { DiscoveryCard, DiscoveryHomeResponse } from "@learnspace/shared";
import type { PreferredDuration } from "@learnspace/shared/onboarding";
import { ArrowRight, Check, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";

const durations = [15, 30, 45, 60] as const;
const defaultMinutes: Record<PreferredDuration, number> = { under_10_minutes: 15, ten_to_thirty_minutes: 30, thirty_to_sixty_minutes: 60, no_preference: 30 };

const length = (durationMs: number | null) => durationMs ? `${Math.max(1, Math.round(durationMs / 60_000))} min` : null;

// Picks the learner's next video from their interests; it becomes a new session and goes on the calendar.
export function FirstSession({ preferredDuration }: { preferredDuration: PreferredDuration }) {
  const router = useRouter();
  const [cards, setCards] = useState<DiscoveryCard[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(defaultMinutes[preferredDuration]);
  const [planned, setPlanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = cards?.find((entry) => entry.resourceId === choice);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger.
  useEffect(() => {
    const controller = new AbortController();
    setCards(null);
    fetch("/api/v1/discovery/home", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
        const { sections } = await response.json() as DiscoveryHomeResponse;
        setCards(sections.recommendedVideos.slice(0, 6));
      })
      .catch(() => { if (!controller.signal.aborted) setCards([]); });
    return () => controller.abort();
  }, [attempt]);

  async function start() {
    if (!card || busy) return;
    setBusy(true);
    setError("");
    try {
      // A retry after a failed study start must not plan the same session twice.
      if (!planned) {
        const startsAt = new Date();
        const response = await fetch("/api/v1/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Linking the material lets the observer complete this exact item, and sets its title and type.
            resourceId: card.resourceId,
            description: null,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
            allDay: false,
          }),
        });
        if (!response.ok) throw new Error(`Plan HTTP ${response.status}`);
        setPlanned(true);
      }
      const response = await fetch("/api/v1/study-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: card.resourceId, origin: "discover", recommendationRunId: card.runId || undefined, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error(`Study HTTP ${response.status}`);
      const { route } = await response.json() as { route: string };
      router.replace(route);
    } catch {
      setError("We could not start that yet. Try again.");
      setBusy(false);
    }
  }

  return <>
    <div className="onboarding-first">
      {cards === null ? <p className="onboarding-muted">Finding something good to start with…</p> : null}
      {cards?.length === 0 ? <>
        <p className="onboarding-muted">We could not load videos for you.</p>
        <button type="button" className="onboarding-back" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
      </> : null}
      <fieldset className="onboarding-first-grid">
        <legend className="sr-only">What to study</legend>
        {(cards ?? []).map((entry) => <button key={entry.resourceId} type="button" className={`onboarding-first-card${choice === entry.resourceId ? " is-selected" : ""}`} aria-pressed={choice === entry.resourceId} onClick={() => setChoice(entry.resourceId)}>
          <span className="onboarding-first-media">
            {entry.thumbnailUrl ? <YouTubeThumbnail src={entry.thumbnailUrl} alt="" fill sizes="240px" /> : <FileText aria-hidden="true" />}
            <span>{entry.type === "video" ? "Video" : "Paper"}{length(entry.durationMs) ? ` · ${length(entry.durationMs)}` : ""}</span>
          </span>
          <span className="onboarding-first-copy"><b>{entry.title}</b><small>{entry.author ?? entry.reason}</small></span>
          <span className="onboarding-option-check" aria-hidden="true">{choice === entry.resourceId ? <Check /> : null}</span>
        </button>)}
      </fieldset>

      <fieldset className="onboarding-choice-row">
        <legend className="onboarding-field-label">For how long?</legend>
        <div className="onboarding-segments onboarding-first-kinds">
          {durations.map((option) => <button key={option} type="button" aria-pressed={minutes === option} className={`onboarding-small-option${minutes === option ? " is-selected" : ""}`} onClick={() => setMinutes(option)}>{option} min</button>)}
        </div>
      </fieldset>
      <p className="onboarding-muted">It opens in Sessions, goes on your calendar from now, and you earn points as you study.</p>
    </div>

    {error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null}
    <div className="onboarding-actions">
      <button className="onboarding-primary" type="button" onClick={() => void start()} disabled={!card || busy}>
        {busy ? "Starting…" : "Start now"} <ArrowRight aria-hidden="true" />
      </button>
    </div>
  </>;
}

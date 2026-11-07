"use client";

import type { DiscoveryCard, DiscoveryHomeResponse } from "@learnspace/shared";
import type { PreferredDuration } from "@learnspace/shared/onboarding";
import { ArrowRight, Check, FileText, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { kindLabel, PLAN_KINDS, type PlanKind } from "../../lib/plan/kinds";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";

const durations = [15, 30, 45, 60] as const;
const defaultMinutes: Record<PreferredDuration, number> = { under_10_minutes: 15, ten_to_thirty_minutes: 30, thirty_to_sixty_minutes: 60, no_preference: 30 };
const own = "own";

const length = (durationMs: number | null) => durationMs ? `${Math.max(1, Math.round(durationMs / 60_000))} min` : null;

// The last onboarding step: pick what to study now, which becomes the first item on the calendar.
export function FirstSession({ preferredDuration, skipTo }: { preferredDuration: PreferredDuration; skipTo: string }) {
  const router = useRouter();
  const [cards, setCards] = useState<DiscoveryCard[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PlanKind>("practice");
  const [minutes, setMinutes] = useState(defaultMinutes[preferredDuration]);
  const [planned, setPlanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = cards?.find((entry) => entry.resourceId === choice);
  const ready = Boolean(card) || (choice === own && title.trim().length > 0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/discovery/home", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
        const { sections } = await response.json() as DiscoveryHomeResponse;
        setCards(sections.recommendedVideos.slice(0, 5));
      })
      .catch(() => { if (!controller.signal.aborted) setCards([]); });
    return () => controller.abort();
  }, []);

  async function start() {
    if (!ready || busy) return;
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
            title: card ? `${card.type === "video" ? "Watch" : "Read"} ${card.title}`.slice(0, 160) : title.trim(),
            description: null,
            kind: card ? card.type === "video" ? "watch" : "read" : kind,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
            allDay: false,
          }),
        });
        if (!response.ok) throw new Error(`Plan HTTP ${response.status}`);
        setPlanned(true);
      }
      if (!card) return router.replace("/app");
      const response = await fetch("/api/v1/study-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: card.resourceId, origin: "discover", recommendationRunId: card.runId || undefined, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error(`Study HTTP ${response.status}`);
      router.replace((await response.json() as { route: string }).route);
    } catch {
      setError("We could not start that yet. Try again.");
      setBusy(false);
    }
  }

  return <>
    <div className="onboarding-first">
      {cards === null ? <p className="onboarding-muted">Finding something good to start with…</p> : null}
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
        <button type="button" className={`onboarding-first-card is-own${choice === own ? " is-selected" : ""}`} aria-pressed={choice === own} onClick={() => setChoice(own)}>
          <span className="onboarding-first-media"><PenLine aria-hidden="true" /></span>
          <span className="onboarding-first-copy"><b>Something else</b><small>Write what you will work on</small></span>
          <span className="onboarding-option-check" aria-hidden="true">{choice === own ? <Check /> : null}</span>
        </button>
      </fieldset>

      {choice === own ? <div className="onboarding-first-own">
        <label className="onboarding-search">
          <span className="sr-only">What will you work on?</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="e.g. Practise recursion problems" />
        </label>
        <fieldset className="onboarding-segments onboarding-first-kinds">
          <legend className="sr-only">Type</legend>
          {PLAN_KINDS.map((option) => <button key={option} type="button" aria-pressed={kind === option} className={`onboarding-small-option${kind === option ? " is-selected" : ""}`} onClick={() => setKind(option)}>{kindLabel[option]}</button>)}
        </fieldset>
      </div> : null}

      <fieldset className="onboarding-choice-row">
        <legend className="onboarding-field-label">For how long?</legend>
        <div className="onboarding-segments onboarding-first-kinds">
          {durations.map((option) => <button key={option} type="button" aria-pressed={minutes === option} className={`onboarding-small-option${minutes === option ? " is-selected" : ""}`} onClick={() => setMinutes(option)}>{option} min</button>)}
        </div>
      </fieldset>
      <p className="onboarding-muted">It goes on your calendar from now, and you earn points as you study.</p>
    </div>

    {error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null}
    <div className="onboarding-actions">
      <button className="onboarding-back" type="button" onClick={() => router.replace(skipTo)} disabled={busy}>Skip for now</button>
      <button className="onboarding-primary" type="button" onClick={() => void start()} disabled={!ready || busy}>
        {busy ? "Starting…" : "Start now"} <ArrowRight aria-hidden="true" />
      </button>
    </div>
  </>;
}

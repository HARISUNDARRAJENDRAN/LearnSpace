"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, atMinutes, dayKey } from "../home/calendar/dates";

const examples = ["Pass my data structures exam next week", "Build my first React app", "Understand how transformers work"];

// Asks what the learner is working toward right now; the planning agent turns it into this week's to-dos.
export function GoalStep({ interests, onDone }: { interests: string[]; onDone: () => void }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { field.current?.focus(); }, []);

  async function save() {
    if (busy || goal.trim().length < 3) return;
    setBusy(true);
    setError("");
    const today = dayKey(new Date());
    // Local midnights, so each to-do lands on the learner's own calendar day.
    const days = Array.from({ length: 7 }, (_, index) => atMinutes(addDays(today, index), 0).toISOString());
    try {
      const response = await fetch("/api/v1/plan/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), interests: interests.slice(0, 10), days }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "We could not plan that yet. Try again.");
      }
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not plan that yet. Try again.");
      setBusy(false);
    }
  }

  return <>
    <div className="onboarding-goal">
      <label className="onboarding-goal-field">
        <span className="sr-only">Your goal right now</span>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={300} rows={3} ref={field} placeholder="e.g. Get comfortable with recursion before my interview on Friday"
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save(); }} />
      </label>
      <fieldset className="onboarding-goal-examples">
        <legend className="sr-only">Examples</legend>
        {examples.map((example) => <button key={example} type="button" className="onboarding-chip" onClick={() => setGoal(example)}>{example}</button>)}
      </fieldset>
      <p className="onboarding-muted">We&apos;ll break it into a few to-dos for this week. You can tick them off on your calendar.</p>
    </div>

    {error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null}
    <div className="onboarding-actions">
      <button className="onboarding-back" type="button" onClick={onDone} disabled={busy}>Skip</button>
      <button className="onboarding-primary" type="button" onClick={() => void save()} disabled={busy || goal.trim().length < 3}>
        {busy ? "Planning your week…" : "Create my to-dos"} <ArrowRight aria-hidden="true" />
      </button>
    </div>
  </>;
}

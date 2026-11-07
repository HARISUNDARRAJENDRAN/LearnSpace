"use client";

import { Eye, Sparkles, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { kindLabel, PLAN_KINDS, type PlanKind } from "../../../lib/plan/kinds";
import type { PlanItem } from "../../../lib/plan/service";
import { StartStudyButton } from "../../study/StudyActions";
import { atMinutes, dayKey, format, fromDmy, minutesOfDay, toDmy, type DayKey } from "./dates";
import { planTone, toneLabel } from "./plan";

export type PlanDialogState = { mode: "create"; day: DayKey; minutes: number } | { mode: "edit"; item: PlanItem };

const toTime = (minutes: number) => format.time(atMinutes("2000-01-01", minutes));

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "That did not save. Try again.";
}

export function PlanItemDialog({ state, now, onClose, onChanged }: { state: PlanDialogState; now: Date; onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const item = state.mode === "edit" ? state.item : null;
  const start = item ? new Date(item.startsAt) : atMinutes(state.mode === "create" ? state.day : dayKey(now), state.mode === "create" ? state.minutes : minutesOfDay(now));
  const startMinutes = minutesOfDay(start);
  const [title, setTitle] = useState(item?.title ?? "");
  const [kind, setKind] = useState<PlanKind>(item?.kind ?? "watch");
  const [date, setDate] = useState(toDmy(dayKey(start)));
  const [allDay, setAllDay] = useState(item?.allDay ?? false);
  const [from, setFrom] = useState(toTime(startMinutes));
  const [to, setTo] = useState(item?.endsAt ? format.time(new Date(item.endsAt)) : toTime(Math.min(startMinutes + 60, 23 * 60 + 59)));
  const [description, setDescription] = useState(item?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const day = fromDmy(date);
    if (!day) {
      setError("Enter the date as dd/mm/yyyy.");
      setBusy(false);
      return;
    }
    const startsAt = allDay ? atMinutes(day, 0) : new Date(`${day}T${from}`);
    const endsAt = allDay ? null : new Date(`${day}T${to}`);
    if (endsAt && endsAt <= startsAt) {
      setError("End the plan after it starts.");
      setBusy(false);
      return;
    }
    const body = { title, kind, description: description.trim() || null, startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() ?? null, allDay };
    const response = await fetch(item ? `/api/v1/plan/${item.id}` : "/api/v1/plan", { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError(response ? await errorMessage(response) : "You appear to be offline.");
    onChanged();
    onClose();
  }

  async function remove() {
    if (!item) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const response = await fetch(`/api/v1/plan/${item.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError(response ? await errorMessage(response) : "You appear to be offline.");
    onChanged();
    onClose();
  }

  const tone = item ? planTone(item, now) : null;
  // biome-ignore lint/a11y/useKeyWithClickEvents: closes on a backdrop click; Escape already closes a modal dialog.
  return <dialog ref={dialog} className="plan-dialog" aria-labelledby={titleId} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <form onSubmit={(event) => void save(event)}>
      <header>
        <h2 id={titleId}>{item ? "Plan item" : "Plan study"}</h2>
        <button type="button" className="plan-icon-button" onClick={() => dialog.current?.close()} aria-label="Close"><X aria-hidden="true" /></button>
      </header>

      {item && tone ? <section className={`plan-observer kind-${item.kind}`} aria-label="Progress">
        <div className="plan-observer-head"><Eye aria-hidden="true" /><b>{toneLabel[tone]}</b><span>{item.progressPct}%</span></div>
        <span className="plan-observer-bar"><i style={{ width: `${item.progressPct}%` }} /></span>
        <p>{item.observerNote ?? "This fills in from what you study that day. You never need to tick it off."}</p>
        {item.source === "agent" ? <small><Sparkles aria-hidden="true" /> Suggested for you</small> : null}
      </section> : null}

      <label className="plan-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="e.g. Learn polymorphism in Java" autoFocus={!item} /></label>
      <fieldset className="plan-kinds">
        <legend>Type</legend>
        {PLAN_KINDS.map((option) => <label key={option} className={`plan-kind kind-${option}`}><input type="radio" name="kind" value={option} checked={kind === option} onChange={() => setKind(option)} />{kindLabel[option]}</label>)}
      </fieldset>
      <div className="plan-field-row">
        <label className="plan-field"><span>Date</span><input value={date} onChange={(event) => setDate(event.target.value)} inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} required /></label>
        {allDay ? null : <>
          <label className="plan-field"><span>From</span><input type="time" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
          <label className="plan-field"><span>To</span><input type="time" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        </>}
      </div>
      <label className="plan-check"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /> All day</label>
      <label className="plan-field"><span>Notes</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="What should this session cover?" /></label>

      {error ? <p className="plan-dialog-error" role="alert">{error}</p> : null}
      <footer>
        {item ? <button type="button" className={`plan-button is-danger${confirmDelete ? " is-confirm" : ""}`} onClick={() => void remove()} disabled={busy}><Trash2 aria-hidden="true" />{confirmDelete ? "Confirm delete" : "Delete"}</button> : null}
        {item?.resource ? <StartStudyButton className="plan-button" resourceId={item.resource.id} origin="home" label="Open material" /> : null}
        <button type="submit" className="plan-button is-primary" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Add to plan"}</button>
      </footer>
    </form>
  </dialog>;
}

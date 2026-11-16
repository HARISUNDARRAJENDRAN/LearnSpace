"use client";

import { Eye, FileText, PenLine, PlayCircle, Sparkles, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { kindLabel } from "../../../lib/plan/kinds";
import type { PlanItem } from "../../../lib/plan/service";
import { StartStudyButton } from "../../study/StudyActions";
import { atMinutes, dayKey, format, fromDmy, minutesOfDay, toDmy, type DayKey } from "./dates";
import { planTone, toneLabel } from "./plan";

export type PlanDialogState = { mode: "create"; day: DayKey; minutes: number; allDay?: boolean } | { mode: "edit"; item: PlanItem };

// A session the learner can plan to continue: its current material decides the plan's type on the server.
type SessionOption = { id: string; title: string; status: string; progressPct: number; activeResource: { id: string; title: string; type: string } | null };

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
  const [sessions, setSessions] = useState<SessionOption[] | null>(null);
  // "own" is a free-text plan; otherwise the id of the picked session.
  const [pick, setPick] = useState<string | null>(item ? null : "pending");
  const [date, setDate] = useState(toDmy(dayKey(start)));
  const [allDay, setAllDay] = useState(item?.allDay ?? (state.mode === "create" && state.allDay === true));
  const [from, setFrom] = useState(toTime(startMinutes));
  const [to, setTo] = useState(item?.endsAt ? format.time(new Date(item.endsAt)) : toTime(Math.min(startMinutes + 60, 23 * 60 + 59)));
  const [description, setDescription] = useState(item?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // New plans start from the learner's sessions, the one in progress first, so they rarely type anything.
  useEffect(() => {
    if (item) return;
    const controller = new AbortController();
    fetch("/api/v1/study-sessions", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Sessions HTTP ${response.status}`);
        const list = (await response.json() as { sessions: SessionOption[] }).sessions.filter((session) => session.activeResource && session.status !== "abandoned").slice(0, 5);
        setSessions(list);
        setPick((current) => current === "pending" ? list[0]?.id ?? "own" : current);
      })
      .catch(() => { if (!controller.signal.aborted) { setSessions([]); setPick((current) => current === "pending" ? "own" : current); } });
    return () => controller.abort();
  }, [item]);

  const picked = sessions?.find((session) => session.id === pick) ?? null;

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
    // The type is never chosen here: the server reads it from the picked material or from the words.
    const times = { description: description.trim() || null, startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() ?? null, allDay };
    const body = item
      ? { ...times, ...(item.resource ? {} : { title }) }
      : picked?.activeResource
        ? { ...times, resourceId: picked.activeResource.id, studySessionId: picked.id }
        : { ...times, title };
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

      {item ? <>
        {item.resource
          ? <div className="plan-field"><span>Studying</span><p className="plan-material">{item.resource.type === "video" ? <PlayCircle aria-hidden="true" /> : <FileText aria-hidden="true" />}{item.resource.title}</p></div>
          : <label className="plan-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} /></label>}
        <p className={`plan-auto-kind kind-${item.kind}`}><i aria-hidden="true" />{kindLabel[item.kind]}<small>Type is set from {item.resource ? "the material" : "what you wrote"}</small></p>
      </> : <fieldset className="plan-pick">
        <legend>What to study</legend>
        {sessions === null ? <p className="plan-pick-loading">Loading your sessions…</p> : null}
        {sessions?.map((session, index) => <label key={session.id} className="plan-pick-option">
          <input type="radio" name="pick" checked={pick === session.id} onChange={() => setPick(session.id)} />
          {session.activeResource?.type === "video" ? <PlayCircle aria-hidden="true" /> : <FileText aria-hidden="true" />}
          <span><b>{session.activeResource?.title}</b><small>{index === 0 && session.status === "active" ? "Studying now · " : ""}{session.progressPct > 0 ? `${Math.round(session.progressPct)}% done` : "Not started"}</small></span>
        </label>)}
        <label className="plan-pick-option">
          <input type="radio" name="pick" checked={pick === "own"} onChange={() => setPick("own")} />
          <PenLine aria-hidden="true" /><span><b>Something else</b><small>Describe it; the type is worked out for you</small></span>
        </label>
        {pick === "own" ? <input className="plan-pick-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="e.g. Solve 5 recursion problems" aria-label="What to study" autoFocus /> : null}
      </fieldset>}
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
        <button type="submit" className="plan-button is-primary" disabled={busy || pick === "pending"}>{busy ? "Saving…" : item ? "Save changes" : "Add to plan"}</button>
      </footer>
    </form>
  </dialog>;
}

"use client";

import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { kindLabel, PLAN_KINDS } from "../../../lib/plan/kinds";
import type { PlanItem } from "../../../lib/plan/service";
import { addDays, addMonths, atMinutes, dayKey, format, isoWeek, minutesOfDay, monthGrid, rangeLabel, weekDays, type DayKey } from "./dates";
import { MonthGrid } from "./MonthGrid";
import { type PlanDialogState, PlanItemDialog } from "./PlanItemDialog";
import { TimeGrid } from "./TimeGrid";
import { useNow } from "./useNow";

type View = "day" | "week" | "month";

const views: { id: View; label: string }[] = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }];

export function PlanCalendar({ version, onChanged }: { version: number; onChanged: () => void }) {
  // The calendar renders in the browser's own time zone, so it waits for the client clock.
  const now = useNow();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<DayKey | null>(null);
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<PlanDialogState | null>(null);
  const day = anchor ?? (now ? dayKey(now) : null);
  const days = !day ? [] : view === "day" ? [day] : view === "week" ? weekDays(day) : monthGrid(day);
  const first = days[0];
  const last = days[days.length - 1];

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the refetch signal after the plan changes.
  useEffect(() => {
    if (!first || !last) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ from: atMinutes(first, 0).toISOString(), to: atMinutes(addDays(last, 1), 0).toISOString() });
    fetch(`/api/v1/plan?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Plan HTTP ${response.status}`);
        setItems((await response.json() as { items: PlanItem[] }).items);
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [first, last, version]);

  if (!now || !day) return <section className="plan-calendar is-loading" aria-label="Study plan" aria-busy="true" />;

  const step = (direction: 1 | -1) => setAnchor(view === "month" ? addMonths(day, direction) : addDays(day, direction * (view === "week" ? 7 : 1)));
  const visible = (items ?? []).filter((item) => view !== "month" || days.includes(dayKey(new Date(item.startsAt))));
  const done = visible.filter((item) => item.status === "done").length;
  const scope = view === "month" ? rangeLabel([first!, last!]) : `Week ${isoWeek(day)} · ${rangeLabel(view === "day" ? [day] : days)}`;
  const openDay = (target: DayKey) => { setAnchor(target); setView("day"); };
  const plan = (target: DayKey, minutes: number) => setDialog({ mode: "create", day: target, minutes });

  return <section className="plan-calendar" aria-label="Study plan">
    <header className="plan-header">
      <div className="plan-title">
        <h2>{format.month(day)}</h2>
        <p>{scope}{visible.length > 0 ? ` · ${done} of ${visible.length} done` : ""}</p>
      </div>
      <ul className="plan-legend" aria-label="Kinds of study">{PLAN_KINDS.map((kind) => <li key={kind} className={`kind-${kind}`}>{kindLabel[kind]}</li>)}</ul>
      <button type="button" className="plan-button" onClick={() => setAnchor(null)}>Today</button>
      <div className="plan-stepper">
        <button type="button" onClick={() => step(-1)} aria-label={`Previous ${view}`}><ArrowLeft aria-hidden="true" /></button>
        <button type="button" onClick={() => step(1)} aria-label={`Next ${view}`}><ArrowRight aria-hidden="true" /></button>
      </div>
      <div className="plan-views" role="tablist" aria-label="Calendar view">
        {views.map((option) => <button key={option.id} type="button" role="tab" aria-selected={view === option.id} onClick={() => setView(option.id)}>{option.label}</button>)}
      </div>
      <button type="button" className="plan-button is-primary" onClick={() => plan(dayKey(now), minutesOfDay(now))}><Plus aria-hidden="true" />Plan</button>
    </header>
    {failed ? <p className="plan-error" role="alert">Your plan did not load. It will retry when you change the view.</p> : null}
    {view === "month"
      ? <MonthGrid anchor={day} items={visible} now={now} onSlot={plan} onOpen={(item) => setDialog({ mode: "edit", item })} onPickDay={openDay} />
      : <TimeGrid days={days} items={visible} now={now} onSlot={plan} onOpen={(item) => setDialog({ mode: "edit", item })} onPickDay={openDay} />}
    {dialog ? <PlanItemDialog key={dialog.mode === "edit" ? dialog.item.id : `${dialog.day}-${dialog.minutes}`} state={dialog} now={now} onClose={() => setDialog(null)} onChanged={onChanged} /> : null}
  </section>;
}

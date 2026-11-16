"use client";

import { Calendar1, CalendarDays, CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlanItem } from "../../../lib/plan/service";
import { addDays, addMonths, atMinutes, calendarTitle, dayKey, minutesOfDay, monthGrid, weekDays, type DayKey } from "./dates";
import { MonthGrid } from "./MonthGrid";
import { type PlanDialogState, PlanItemDialog } from "./PlanItemDialog";
import { PlanSidebar } from "./PlanSidebar";
import { type Ticks, withTicks } from "./plan";
import { TimeGrid } from "./TimeGrid";
import { useNow } from "./useNow";

type View = "day" | "week" | "month";

const views: { id: View; label: string; icon: typeof CalendarDays }[] = [
  { id: "month", label: "Month", icon: CalendarDays },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "day", label: "Day", icon: Calendar1 },
];

export function PlanCalendar({ version, onChanged }: { version: number; onChanged: () => void }) {
  // The calendar renders in the browser's own time zone, so it waits for the client clock.
  const now = useNow();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<DayKey | null>(null);
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<PlanDialogState | null>(null);
  const [ticks, setTicks] = useState<Ticks>(new Map());
  // What the last tick check said: a failure, or why the item is not done yet.
  const [tickNote, setTickNote] = useState<{ tone: "error" | "info"; text: string } | null>(null);
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
        // Fresh items carry the saved ticks, so the optimistic ones can go.
        setTicks(new Map());
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [first, last, version]);

  if (!now || !day) return <section className="plan-calendar is-loading" aria-label="Study plan" aria-busy="true" />;

  const today = dayKey(now);
  const step = (direction: 1 | -1) => setAnchor(view === "month" ? addMonths(day, direction) : addDays(day, direction * (view === "week" ? 7 : 1)));
  const visible = withTicks(items ?? [], ticks).filter((item) => view !== "month" || days.includes(dayKey(new Date(item.startsAt))));
  const showsToday = view === "month" ? day.slice(0, 7) === today.slice(0, 7) : days.includes(today);
  const openDay = (target: DayKey) => { setAnchor(target); setView("day"); };
  const plan = (target: DayKey, minutes: number, allDay = false) => setDialog({ mode: "create", day: target, minutes, allDay });
  const open = (item: PlanItem) => setDialog({ mode: "edit", item });
  // Ticking shows at once while the server checks it against recorded study; unbacked ticks are put back with the reason.
  const toggle = async (item: PlanItem) => {
    const done = item.status !== "done";
    const set = (value: boolean | null) => setTicks((current) => {
      const next = new Map(current);
      if (value === null) next.delete(item.id);
      else next.set(item.id, value);
      return next;
    });
    set(done);
    setTickNote(null);
    const response = await fetch(`/api/v1/plan/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done }) }).catch(() => null);
    if (!response?.ok) {
      set(null);
      setTickNote({ tone: "error", text: "That to-do did not update. Try again." });
      return;
    }
    const { tick } = await response.json() as { tick: { verified: boolean; note: string } };
    if (done && !tick.verified) {
      set(null);
      setTickNote({ tone: "info", text: `“${item.title}” isn't done yet. ${tick.note}` });
    }
    onChanged();
  };

  return <section className="plan-calendar" id="calendar" aria-label="Study plan">
    <header className="plan-header">
      <div className="plan-title">
        <p>Calendar</p>
        <h2>{calendarTitle(view, days, day)}</h2>
      </div>
      <div className="plan-views" role="tablist" aria-label="Calendar view">
        {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}><Icon aria-hidden="true" />{label}</button>)}
      </div>
      <div className="plan-nav">
        <button type="button" onClick={() => step(-1)} aria-label={`Previous ${view}`}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" className={`plan-nav-today${showsToday ? " is-current" : ""}`} onClick={() => setAnchor(null)}>Today</button>
        <button type="button" onClick={() => step(1)} aria-label={`Next ${view}`}><ChevronRight aria-hidden="true" /></button>
      </div>
      <button type="button" className="plan-button is-primary plan-new" onClick={() => plan(day, day === today ? minutesOfDay(now) : 9 * 60)}><CalendarPlus aria-hidden="true" />New event</button>
    </header>
    {failed ? <p className="plan-error" role="alert">Your plan did not load. It will retry when you change the view.</p> : null}
    {tickNote ? <p className={tickNote.tone === "error" ? "plan-error" : "plan-note"} role={tickNote.tone === "error" ? "alert" : "status"}>{tickNote.text}<button type="button" onClick={() => setTickNote(null)} aria-label="Dismiss"><X aria-hidden="true" /></button></p> : null}
    <div className="plan-body">
      <PlanSidebar now={now} version={version} ticks={ticks} onOpen={open} onToggle={(item) => void toggle(item)} onCreate={plan} />
      <div className="plan-main">
        {view === "month"
          ? <MonthGrid anchor={day} items={visible} now={now} onSlot={plan} onOpen={open} onToggle={(item) => void toggle(item)} onPickDay={openDay} />
          : <TimeGrid days={days} items={visible} now={now} onSlot={plan} onOpen={open} onToggle={(item) => void toggle(item)} onPickDay={openDay} />}
      </div>
    </div>
    {dialog ? <PlanItemDialog key={dialog.mode === "edit" ? dialog.item.id : `${dialog.day}-${dialog.minutes}-${dialog.allDay}`} state={dialog} now={now} onClose={() => setDialog(null)} onChanged={onChanged} /> : null}
  </section>;
}

"use client";

import { Check, ChevronDown, ChevronUp, ListFilter, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { kindLabel, PLAN_KINDS, type PlanKind } from "../../../lib/plan/kinds";
import type { PlanItem } from "../../../lib/plan/service";
import { addDays, atMinutes, dayKey, format, relativeDay, type DayKey } from "./dates";
import { itemDay, planTone, type Ticks, toneLabel, withTicks } from "./plan";

type Tab = "todo" | "events";
// A group is one day ("2026-11-14"), unfinished items from earlier days, or everything past the coming week.
type Group = DayKey | "earlier" | "later";

// The left rail lists the plan day by day: all-day items are that day's to-dos, timed items are its events by the hour.
export function PlanSidebar({ now, version, ticks, onOpen, onToggle, onCreate }: { now: Date; version: number; ticks: Ticks; onOpen: (item: PlanItem) => void; onToggle: (item: PlanItem) => void; onCreate: (day: DayKey, minutes: number, allDay?: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("todo");
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<PlanKind[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Group[]>([]);
  const today = dayKey(now);
  // A week back is enough to catch what is still open from recent days.
  const listFrom = addDays(today, -7);
  const weekAhead = addDays(today, 7);
  // The plan API serves at most 62 days per request; 61 leaves room for a daylight-saving hour.
  const horizon = addDays(listFrom, 61);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the refetch signal after the plan changes.
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ from: atMinutes(listFrom, 0).toISOString(), to: atMinutes(horizon, 0).toISOString() });
    fetch(`/api/v1/plan?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Plan HTTP ${response.status}`);
        setItems((await response.json() as { items: PlanItem[] }).items);
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [listFrom, horizon, version]);

  // The filter menu closes on an outside click or Escape.
  useEffect(() => {
    if (!filterOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [filterOpen]);

  const groupOf = (day: DayKey): Group => day < today ? "earlier" : day < weekAhead ? day : "later";
  // Earlier days only keep what is still open; finished past items have nothing left to do.
  const inTab = withTicks(items ?? [], ticks).filter((item) => (tab === "todo") === item.allDay && (itemDay(item) >= today || item.status !== "done"));
  const listed = inTab
    .filter((item) => !hideDone || item.status !== "done")
    .filter((item) => !hiddenKinds.includes(item.kind))
    .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt));
  const hidden = inTab.length - listed.length;
  const filtering = hideDone || hiddenKinds.length > 0;
  const clearFilters = () => { setHideDone(false); setHiddenKinds([]); };
  const toggleKind = (kind: PlanKind) => setHiddenKinds((current) => current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]);
  // Today and tomorrow always show, so there is somewhere to add; other days show only when they have items.
  const groups: { id: Group; label: string; addDay: DayKey }[] = [
    { id: "earlier", label: "Still open", addDay: today },
    ...Array.from({ length: 7 }, (_, offset) => addDays(today, offset)).map((day) => ({ id: day, label: dayLabel(day), addDay: day })),
    { id: "later", label: "Later", addDay: weekAhead },
  ].filter((group) => group.id === today || group.id === addDays(today, 1) || listed.some((item) => groupOf(itemDay(item)) === group.id));
  function dayLabel(day: DayKey): string {
    const named = relativeDay(day, today);
    return named === format.short(day) ? `${format.weekday(day)}, ${named}` : named;
  }
  const toggle = (group: Group) => setCollapsed((current) => current.includes(group) ? current.filter((value) => value !== group) : [...current, group]);

  return <aside className="plan-side" aria-label="Today">
    <div className="plan-side-head">
      <h3>Today</h3>
      <div className="plan-filter" ref={filterRef}>
        <button type="button" className={`plan-icon-button${filtering ? " is-filtering" : ""}`} aria-haspopup="true" aria-expanded={filterOpen} aria-label={filtering ? "Filter, on" : "Filter"} title="Filter" onClick={() => setFilterOpen((value) => !value)}><ListFilter aria-hidden="true" /></button>
        {filterOpen ? <fieldset className="plan-filter-menu" aria-label="Filter the list">
          <label className="plan-filter-option"><input type="checkbox" checked={!hideDone} onChange={(event) => setHideDone(!event.target.checked)} />Show completed</label>
          <p>Type</p>
          {PLAN_KINDS.map((kind) => <label key={kind} className={`plan-filter-option kind-${kind}`}><input type="checkbox" checked={!hiddenKinds.includes(kind)} onChange={() => toggleKind(kind)} /><i aria-hidden="true" />{kindLabel[kind]}</label>)}
          {filtering ? <button type="button" className="plan-filter-reset" onClick={clearFilters}>Reset filters</button> : null}
        </fieldset> : null}
      </div>
    </div>
    <div className="plan-side-tabs" role="tablist" aria-label="List">
      <button type="button" role="tab" aria-selected={tab === "todo"} onClick={() => setTab("todo")}>To-do list</button>
      <button type="button" role="tab" aria-selected={tab === "events"} onClick={() => setTab("events")}>Events</button>
    </div>
    {failed ? <p className="plan-side-empty">Your list did not load.</p> : null}
    {/* A filter never hides items silently: the rail says how many are out of view. */}
    {hidden > 0 ? <p className="plan-side-hidden">{hidden} hidden by filter · <button type="button" onClick={clearFilters}>Show all</button></p> : null}
    {groups.map((group) => {
      const rows = listed.filter((item) => groupOf(itemDay(item)) === group.id);
      const open = !collapsed.includes(group.id);
      return <section key={group.id} className="plan-side-group">
        <div className="plan-side-group-head">
          <button type="button" className="plan-side-toggle" aria-expanded={open} onClick={() => toggle(group.id)}>
            {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{group.label}<span>{rows.length}</span>
          </button>
          <button type="button" className="plan-side-add" aria-label={`Add to ${group.label}`} onClick={() => onCreate(group.addDay, group.addDay === today ? Math.min(23 * 60, (now.getHours() + 1) * 60) : 9 * 60, tab === "todo")}><Plus aria-hidden="true" /></button>
        </div>
        {open ? rows.length === 0
          ? <p className="plan-side-empty">Nothing here.</p>
          : <ul>{rows.map((item) => {
            const tone = planTone(item, now);
            // Inside a day group the day is the heading, so a row shows its time (events) or its type (to-dos).
            const when = group.id === "earlier" || group.id === "later" ? relativeDay(itemDay(item), today) : item.allDay ? kindLabel[item.kind] : format.clock(new Date(item.startsAt));
            return <li key={item.id}>
              <div className={`plan-todo kind-${item.kind} is-${tone}`}>
                {/* A tick asks the observer to check now; it only sticks when recorded study backs it. */}
                <button type="button" className={`plan-todo-box${item.allDay ? "" : " is-round"}`} aria-pressed={tone === "done"} aria-label={`Done: ${item.title}`} title={tone === "done" ? "Done" : "Tick to check it against your study"} onClick={() => onToggle(item)}>{tone === "done" ? <Check aria-hidden="true" /> : null}</button>
                <button type="button" className="plan-todo-copy" onClick={() => onOpen(item)} aria-label={`${item.title}, ${when}, ${toneLabel[tone]}`}>
                  <span>{item.title}</span>
                  <small>{when}{(group.id === "earlier" || group.id === "later") && !item.allDay ? ` · ${format.clock(new Date(item.startsAt))}` : ""}{item.status !== "done" && item.progressPct > 0 ? ` · ${item.progressPct}%` : ""}</small>
                </button>
              </div>
            </li>;
          })}</ul> : null}
      </section>;
    })}
  </aside>;
}

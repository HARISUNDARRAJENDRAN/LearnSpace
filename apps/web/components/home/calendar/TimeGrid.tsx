"use client";

import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { kindLabel } from "../../../lib/plan/kinds";
import type { PlanItem } from "../../../lib/plan/service";
import { dayKey, format, fromKey, minutesOfDay, type DayKey } from "./dates";
import { itemDay, layoutDay, planTone, toneLabel } from "./plan";

const hourHeight = 56;
const snapMinutes = 30;
const hours = Array.from({ length: 24 }, (_, hour) => hour);

export function PlanChip({ item, now, onOpen }: { item: PlanItem; now: Date; onOpen: (item: PlanItem) => void }) {
  const tone = planTone(item, now);
  return <button type="button" className={`plan-chip kind-${item.kind} is-${tone}`} onClick={(event) => { event.stopPropagation(); onOpen(item); }} aria-label={`${item.title}, ${kindLabel[item.kind]}, ${toneLabel[tone]}`}>
    {item.allDay ? null : <time>{format.time(new Date(item.startsAt))}</time>}<span>{item.title}</span>
  </button>;
}

export function TimeGrid({ days, items, now, onSlot, onOpen, onPickDay }: { days: DayKey[]; items: PlanItem[]; now: Date; onSlot: (day: DayKey, minutes: number) => void; onOpen: (item: PlanItem) => void; onPickDay: (day: DayKey) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const today = dayKey(now);
  const showsToday = days.includes(today);
  const allDay = items.filter((item) => item.allDay);
  const timed = items.filter((item) => !item.allDay);

  // Open on the working part of the day: just before now on today, otherwise at 07:00.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll once per visible range, not on every clock tick.
  useLayoutEffect(() => {
    const hour = showsToday ? Math.max(0, now.getHours() - 2) : 7;
    scroller.current?.scrollTo({ top: hour * hourHeight });
  }, [days.join(), showsToday]);

  function slot(day: DayKey, event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const minutes = Math.floor(event.nativeEvent.offsetY / hourHeight * 60 / snapMinutes) * snapMinutes;
    onSlot(day, Math.min(minutes, 23 * 60));
  }

  return <div className="plan-grid" style={{ "--plan-days": days.length, "--plan-hour": `${hourHeight}px` } as CSSProperties}>
    <div className="plan-grid-row plan-grid-head">
      <span className="plan-axis-cell" />
      {days.map((day) => <button key={day} type="button" className={`plan-day-head${day === today ? " is-today" : ""}`} onClick={() => onPickDay(day)} aria-label={`Open ${format.long(day)}`}>
        <span>{format.weekday(day)}</span><b>{fromKey(day).getDate()}</b>
      </button>)}
    </div>
    <div className="plan-grid-row plan-allday">
      <span className="plan-axis-cell">All day</span>
      {days.map((day) => <div key={day} className="plan-allday-cell">
        {allDay.filter((item) => itemDay(item) === day).map((item) => <PlanChip key={item.id} item={item} now={now} onOpen={onOpen} />)}
      </div>)}
    </div>
    <div className="plan-grid-scroll" ref={scroller}>
      <div className="plan-grid-body">
        <div className="plan-axis" aria-hidden="true">{hours.slice(1).map((hour) => <span key={hour} style={{ top: hour * hourHeight }}>{format.hour(hour)}</span>)}</div>
        {days.map((day) => {
          const placed = layoutDay(timed.filter((item) => itemDay(item) === day).map((item) => {
            const start = minutesOfDay(new Date(item.startsAt));
            // An item that runs past midnight is drawn to the end of its first day.
            const end = item.endsAt && dayKey(new Date(item.endsAt)) === day ? minutesOfDay(new Date(item.endsAt)) : 24 * 60;
            return { item, start, end: Math.max(end, start + 20) };
          }));
          // biome-ignore lint/a11y/noStaticElementInteractions: a mouse shortcut; the Plan button is the keyboard path.
          return <div key={day} className={`plan-day-col${day === today ? " is-today" : ""}`} onClick={(event) => slot(day, event)} role="presentation">
            {placed.map(({ item, start, end, column, columns }) => {
              const tone = planTone(item, now);
              const height = (end - start) / 60 * hourHeight;
              return <button key={item.id} type="button" className={`plan-event kind-${item.kind} is-${tone}${height < 44 ? " is-short" : height < 80 ? " is-compact" : ""}`} onClick={() => onOpen(item)}
                style={{ top: start / 60 * hourHeight, height: height - 2, left: `calc(${column / columns * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)` }}>
                <b>{item.title}</b>
                <time>{format.time(new Date(item.startsAt))}{item.endsAt ? ` – ${format.time(new Date(item.endsAt))}` : ""}</time>
                <span className="plan-event-status">{toneLabel[tone]}{tone === "done" || item.progressPct === 0 ? "" : ` · ${item.progressPct}%`}</span>
                {item.progressPct > 0 && tone !== "done" ? <i className="plan-event-progress" style={{ width: `${item.progressPct}%` }} aria-hidden="true" /> : null}
              </button>;
            })}
            {day === today ? <span className="plan-now" style={{ top: minutesOfDay(now) / 60 * hourHeight }} aria-hidden="true" /> : null}
          </div>;
        })}
      </div>
    </div>
  </div>;
}

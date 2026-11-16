"use client";

import { Check } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { kindLabel } from "../../../lib/plan/kinds";
import type { PlanItem } from "../../../lib/plan/service";
import { dayKey, format, fromKey, minutesOfDay, utcOffset, type DayKey } from "./dates";
import { itemDay, layoutDay, planTone, toneLabel } from "./plan";

const hourHeight = 88;
const snapMinutes = 30;
const minVisibleMinutes = 60;
const hours = Array.from({ length: 24 }, (_, hour) => hour);

// All-day items are the learner's to-dos: their ring is a checkbox. Timed items are ticked off by the observer.
export function PlanChip({ item, now, onOpen, onToggle }: { item: PlanItem; now: Date; onOpen: (item: PlanItem) => void; onToggle: (item: PlanItem) => void }) {
  const tone = planTone(item, now);
  const done = tone === "done";
  const mark = <span className="plan-chip-mark" aria-hidden="true">{done ? <Check /> : null}</span>;
  return <div className={`plan-chip kind-${item.kind} is-${tone}`}>
    {item.allDay
      ? <button type="button" className="plan-chip-toggle" aria-pressed={done} aria-label={`Done: ${item.title}`} onClick={(event) => { event.stopPropagation(); onToggle(item); }}>{mark}</button>
      : mark}
    <button type="button" className="plan-chip-open" onClick={(event) => { event.stopPropagation(); onOpen(item); }} aria-label={`${item.title}, ${kindLabel[item.kind]}, ${toneLabel[tone]}`}>
      {item.allDay ? null : <time>{format.clock(new Date(item.startsAt))}</time>}<span className="plan-chip-title">{item.title}</span>
    </button>
  </div>;
}

export function TimeGrid({ days, items, now, onSlot, onOpen, onToggle, onPickDay }: { days: DayKey[]; items: PlanItem[]; now: Date; onSlot: (day: DayKey, minutes: number) => void; onOpen: (item: PlanItem) => void; onToggle: (item: PlanItem) => void; onPickDay: (day: DayKey) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const today = dayKey(now);
  const showsToday = days.includes(today);
  const allDay = items.filter((item) => item.allDay);
  const timed = items.filter((item) => !item.allDay);

  // Open on the working part of the day: just before now on today, otherwise at 07:00.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll once per visible range, not on every clock tick.
  useLayoutEffect(() => {
    const hour = showsToday ? Math.max(0, now.getHours() - 1) : 7;
    scroller.current?.scrollTo({ top: hour * hourHeight });
  }, [days.join(), showsToday]);

  function slot(day: DayKey, event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const minutes = Math.floor(event.nativeEvent.offsetY / hourHeight * 60 / snapMinutes) * snapMinutes;
    onSlot(day, Math.min(minutes, 23 * 60));
  }

  // The header rows scroll with the body (and stick to the top), so a scrollbar narrows every row alike and columns stay aligned.
  return <div className="plan-grid" style={{ "--plan-days": days.length, "--plan-hour": `${hourHeight}px` } as CSSProperties}>
    <div className="plan-grid-scroll" ref={scroller}>
    <div className="plan-grid-sticky">
    <div className="plan-grid-row plan-grid-head">
      <span className="plan-axis-cell"><span className="plan-zone" title="Your time zone">{utcOffset(now)}</span></span>
      {days.map((day) => <button key={day} type="button" className={`plan-day-head${day === today ? " is-today" : ""}`} onClick={() => onPickDay(day)} aria-label={`Open ${format.long(day)}`}>
        <b>{fromKey(day).getDate()}</b><span>{format.weekday(day)}</span>
      </button>)}
    </div>
    <div className="plan-grid-row plan-allday">
      <span className="plan-axis-cell">All day</span>
      {days.map((day) => <div key={day} className={`plan-allday-cell${day === today ? " is-today" : ""}`}>
        {allDay.filter((item) => itemDay(item) === day).map((item) => <PlanChip key={item.id} item={item} now={now} onOpen={onOpen} onToggle={onToggle} />)}
      </div>)}
    </div>
    </div>
      <div className="plan-grid-body">
        <div className="plan-axis" aria-hidden="true">{hours.slice(1).map((hour) => <span key={hour} style={{ top: hour * hourHeight }}>{format.hour12(hour)}</span>)}</div>
        {days.map((day) => {
          const placed = layoutDay(timed.filter((item) => itemDay(item) === day).map((item) => {
            const start = minutesOfDay(new Date(item.startsAt));
            // An item that runs past midnight is drawn to the end of its first day; short ones still fill an hour so their time and title fit.
            const end = item.endsAt && dayKey(new Date(item.endsAt)) === day ? minutesOfDay(new Date(item.endsAt)) : 24 * 60;
            // Late items keep their full hour by ending the box at midnight instead of shrinking.
            const drawnEnd = Math.max(end, start + minVisibleMinutes);
            return drawnEnd <= 24 * 60 ? { item, start, end: drawnEnd } : { item, start: Math.max(0, 24 * 60 - minVisibleMinutes), end: 24 * 60 };
          }));
          // biome-ignore lint/a11y/noStaticElementInteractions: a mouse shortcut; the New event button is the keyboard path.
          return <div key={day} className={`plan-day-col${day === today ? " is-today" : ""}`} onClick={(event) => slot(day, event)} role="presentation">
            {placed.map(({ item, start, end, column, columns }) => {
              const tone = planTone(item, now);
              const height = (end - start) / 60 * hourHeight;
              const startsAt = new Date(item.startsAt);
              const minutes = item.endsAt ? (new Date(item.endsAt).getTime() - startsAt.getTime()) / 60_000 : null;
              const past = (item.endsAt ? new Date(item.endsAt) : startsAt) < now;
              const status = `${toneLabel[tone]}${tone === "done" || item.progressPct === 0 ? "" : ` · ${item.progressPct}%`}`;
              return <button key={item.id} type="button" className={`plan-event kind-${item.kind} is-${tone}${past ? " is-past" : ""}${height < 46 ? " is-short" : height < 104 ? " is-compact" : ""}`} onClick={() => onOpen(item)}
                aria-label={`${item.title}, ${kindLabel[item.kind]}, ${format.clock(startsAt)}${minutes ? `, ${format.duration(minutes)}` : ""}, ${status}`}
                style={{ top: start / 60 * hourHeight + 1, height: height - 3, left: `calc(${column / columns * 100}% + 3px)`, width: `calc(${100 / columns}% - 6px)` }}>
                <span className="plan-event-meta"><i className="plan-dot" aria-hidden="true" /><time>{format.clock(startsAt)}{minutes ? ` · ${format.duration(minutes)}` : ""}</time></span>
                <b>{item.title}</b>
                <span className="plan-event-status">{tone === "done" ? <Check aria-hidden="true" /> : null}{item.resource?.title ?? status}</span>
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

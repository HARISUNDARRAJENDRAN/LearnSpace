"use client";

import type { PlanItem } from "../../../lib/plan/service";
import { dayKey, format, fromKey, monthGrid, weekDays, type DayKey } from "./dates";
import { itemDay } from "./plan";
import { PlanChip } from "./TimeGrid";

const maxChips = 3;

export function MonthGrid({ anchor, items, now, onSlot, onOpen, onPickDay }: { anchor: DayKey; items: PlanItem[]; now: Date; onSlot: (day: DayKey, minutes: number) => void; onOpen: (item: PlanItem) => void; onPickDay: (day: DayKey) => void }) {
  const today = dayKey(now);
  const month = anchor.slice(0, 7);
  return <div className="plan-month">
    <div className="plan-month-head" aria-hidden="true">{weekDays(anchor).map((day) => <span key={day}>{format.weekday(day)}</span>)}</div>
    <div className="plan-month-grid">
      {monthGrid(anchor).map((day) => {
        const dayItems = items.filter((item) => itemDay(item) === day);
        // biome-ignore lint/a11y/noStaticElementInteractions: a mouse shortcut; the Plan button is the keyboard path.
        return <div key={day} className={`plan-month-cell${day.startsWith(month) ? "" : " is-outside"}`} onClick={(event) => { if (event.target === event.currentTarget) onSlot(day, 18 * 60); }} role="presentation">
          <button type="button" className={`plan-month-day${day === today ? " is-today" : ""}`} onClick={() => onPickDay(day)} aria-label={`Open ${format.long(day)}`}>{fromKey(day).getDate()}</button>
          {dayItems.slice(0, maxChips).map((item) => <PlanChip key={item.id} item={item} now={now} onOpen={onOpen} />)}
          {dayItems.length > maxChips ? <button type="button" className="plan-month-more" onClick={() => onPickDay(day)}>+{dayItems.length - maxChips} more</button> : null}
        </div>;
      })}
    </div>
  </div>;
}

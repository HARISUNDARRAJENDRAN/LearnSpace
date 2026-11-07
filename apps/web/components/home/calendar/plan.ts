import type { PlanItem } from "../../../lib/plan/service";
import { atMinutes, dayKey, type DayKey } from "./dates";

export type PlanTone = "planned" | "active" | "done" | "partial" | "missed";

// The learner never ticks items off; the tone shows what the observer saw.
export function planTone(item: PlanItem, now: Date): PlanTone {
  if (item.status === "done") return "done";
  // All-day items (and items without an end) stay open until their day is over.
  const end = item.endsAt && !item.allDay ? new Date(item.endsAt) : atMinutes(itemDay(item), 24 * 60);
  if (end < now) return item.progressPct > 0 ? "partial" : "missed";
  return item.progressPct > 0 ? "active" : "planned";
}

export const toneLabel: Record<PlanTone, string> = {
  planned: "Planned",
  active: "In progress",
  done: "Done",
  partial: "Partly done",
  missed: "Missed",
};

export function itemDay(item: PlanItem): DayKey {
  return dayKey(new Date(item.startsAt));
}

export type Positioned = { item: PlanItem; start: number; end: number; column: number; columns: number };

// Overlapping items share the width: each cluster of transitive overlap gets the fewest columns that avoid collisions.
export function layoutDay(items: { item: PlanItem; start: number; end: number }[]): Positioned[] {
  const sorted = items.toSorted((left, right) => left.start - right.start || right.end - left.end);
  const out: Positioned[] = [];
  let cluster: { entry: (typeof items)[number]; column: number }[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];
  const flush = () => {
    for (const { entry, column } of cluster) out.push({ ...entry, column, columns: columnEnds.length });
    cluster = [];
    columnEnds = [];
  };
  for (const entry of sorted) {
    if (entry.start >= clusterEnd && cluster.length) flush();
    let column = columnEnds.findIndex((end) => end <= entry.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(entry.end);
    } else {
      columnEnds[column] = entry.end;
    }
    cluster.push({ entry, column });
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  if (cluster.length) flush();
  return out;
}

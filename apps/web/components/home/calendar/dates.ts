// Calendar days are "YYYY-MM-DD" keys in the browser's local time; weeks start on Monday.
export type DayKey = string;

const pad = (value: number) => String(value).padStart(2, "0");

export function dayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(day: DayKey): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!);
}

// The plan dialog shows dates as dd/mm/yyyy.
export const toDmy = (day: DayKey) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export function fromDmy(text: string): DayKey | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`;
  // Round-tripping rejects dates that do not exist, such as 31/02.
  return dayKey(fromKey(day)) === day ? day : null;
}

export function addDays(day: DayKey, amount: number): DayKey {
  const date = fromKey(day);
  date.setDate(date.getDate() + amount);
  return dayKey(date);
}

export function addMonths(day: DayKey, amount: number): DayKey {
  const date = fromKey(day);
  return dayKey(new Date(date.getFullYear(), date.getMonth() + amount, 1));
}

export function weekStart(day: DayKey): DayKey {
  return addDays(day, -((fromKey(day).getDay() + 6) % 7));
}

export function weekDays(day: DayKey): DayKey[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

// Six full weeks so every month keeps the same grid height.
export function monthGrid(day: DayKey): DayKey[] {
  const start = weekStart(`${day.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function isoWeek(day: DayKey): number {
  const date = fromKey(day);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function atMinutes(day: DayKey, minutes: number): Date {
  const date = fromKey(day);
  date.setMinutes(minutes);
  return date;
}

export const format = {
  month: (day: DayKey) => fromKey(day).toLocaleDateString("en", { month: "long", year: "numeric" }).replace(" ", ", "),
  short: (day: DayKey) => fromKey(day).toLocaleDateString("en", { month: "short", day: "numeric" }),
  weekday: (day: DayKey) => fromKey(day).toLocaleDateString("en", { weekday: "short" }),
  long: (day: DayKey) => fromKey(day).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }),
  time: (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  hour: (hour: number) => `${pad(hour)}:00`,
};

export function rangeLabel(days: DayKey[]): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (first === last) return format.long(first);
  return first.slice(0, 7) === last.slice(0, 7) ? `${format.short(first)} – ${fromKey(last).getDate()}` : `${format.short(first)} – ${format.short(last)}`;
}

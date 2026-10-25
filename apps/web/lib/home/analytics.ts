import type { HomeActivityDay, LearnHomeData } from "./service";

export type HomeRhythmPeriod = "week" | "month" | "all";
export type HomeStats = { studySeconds: number; activeDays: number; started: number; completed: number };
export type HomeBucket = { start: string; stats: HomeStats };
export type HomePeriod = { score: number; previousScore: number | null; days: number; current: HomeStats; previous: HomeStats | null; series: HomeBucket[] };
export type HomeMixItem = { label: string; seconds: number; percent: number };
export type HomePulse = {
  periods: Record<HomeRhythmPeriod, HomePeriod>;
  streak: number;
  totals: { started: number; completed: number; inProgress: number; studySeconds: number };
  firstDay: string | null;
  today: string;
  formats: HomeMixItem[];
};

function studySeconds(day: HomeActivityDay): number {
  return day.focusSeconds + day.practiceSeconds + day.researchSeconds;
}

// These ISO calendar dates already reflect the learner's timezone.
function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function addMonths(day: string, amount: number): string {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function createHomePulse(home: LearnHomeData): HomePulse {
  const { today } = home.activity;
  const days = home.activity.days.filter((day) => day.day <= today).toSorted((left, right) => left.day.localeCompare(right.day));
  const byDay = new Map(days.map((day) => [day.day, day]));
  const secondsOn = (day: string) => { const entry = byDay.get(day); return entry ? studySeconds(entry) : 0; };
  const sum = (list: HomeActivityDay[], value: (day: HomeActivityDay) => number) => list.reduce((total, day) => total + value(day), 0);
  const stats = (from: string, to: string): HomeStats => {
    const list = days.filter((day) => day.day >= from && day.day <= to);
    return { studySeconds: sum(list, studySeconds), activeDays: list.filter((day) => studySeconds(day) > 0).length, started: sum(list, (day) => day.resources), completed: sum(list, (day) => day.completed) };
  };
  // The previous span covers the same number of elapsed days, so a half-finished week compares fairly.
  const daily = (from: string, count: number): HomeBucket[] => Array.from({ length: count }, (_, index) => { const day = addDays(from, index); return { start: day, stats: stats(day, day) }; });
  const period = (from: string, series: HomeBucket[], previousFrom?: string): HomePeriod => {
    const length = daysBetween(from, today) + 1;
    const current = stats(from, today);
    if (!previousFrom) return { score: Math.round(current.activeDays / length * 100), previousScore: null, days: length, current, previous: null, series };
    const end = addDays(previousFrom, length - 1);
    // A short previous month must not run into this one (31 March vs February).
    const previousTo = end < from ? end : addDays(from, -1);
    const previous = stats(previousFrom, previousTo);
    return { score: Math.round(current.activeDays / length * 100), previousScore: Math.round(previous.activeDays / (daysBetween(previousFrom, previousTo) + 1) * 100), days: length, current, previous, series };
  };

  const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const first = days.find((day) => studySeconds(day) > 0 || day.resources > 0)?.day ?? null;
  // All time shows at most the last twelve months, one bucket per month.
  const months: HomeBucket[] = [];
  const oldest = addMonths(monthStart, -11);
  for (let start = first && first > oldest ? `${first.slice(0, 7)}-01` : oldest; start <= monthStart; start = addMonths(start, 1)) months.push({ start, stats: stats(start, addDays(addMonths(start, 1), -1)) });

  // A streak survives until the day ends, so an unstudied today still counts yesterday's run.
  let streak = 0;
  for (let day = secondsOn(today) > 0 ? today : addDays(today, -1); secondsOn(day) > 0; day = addDays(day, -1)) streak++;

  const formatTotals: [string, number][] = [["Videos", sum(days, (day) => day.videoSeconds)], ["Papers", sum(days, (day) => day.paperSeconds)], ["Practice", sum(days, (day) => day.practiceSeconds)], ["Other study", sum(days, (day) => day.otherSeconds)]];
  const formatSum = formatTotals.reduce((total, [, seconds]) => total + seconds, 0);
  const started = sum(days, (day) => day.resources);
  const completed = sum(days, (day) => day.completed);

  return {
    periods: {
      week: period(weekStart, daily(weekStart, 7), addDays(weekStart, -7)),
      month: period(monthStart, daily(monthStart, daysBetween(monthStart, today) + 1), addMonths(monthStart, -1)),
      all: first ? period(first, months) : { score: 0, previousScore: null, days: 0, current: { studySeconds: 0, activeDays: 0, started: 0, completed: 0 }, previous: null, series: months },
    },
    streak,
    totals: { started, completed, inProgress: Math.max(0, started - completed), studySeconds: sum(days, studySeconds) },
    firstDay: first,
    today,
    formats: formatTotals.filter(([, seconds]) => seconds > 0).map(([label, seconds]) => ({ label, seconds, percent: seconds / formatSum * 100 })),
  };
}

import type { HomeActivityDay, LearnHomeData } from "./service";

export type AnalyticsTone = "lavender" | "light-lavender" | "green" | "pink" | "yellow";
export type TrendPeriod = "Day" | "Month" | "Year";
export type TrendPoint = { label: string; title: string; seconds: number; segments: number[]; resources: number; completed: number };
export type HomeAnalyticsData = {
  learningOverview: { seconds: number; activeDays: number; changePct: number | null; bars: { label: string; seconds: number }[] };
  studyDistribution: { label: string; percent: number; seconds: number; tone: AnalyticsTone }[];
  continueWatching: LearnHomeData["continueWatching"];
  weeklyProgress: { label: string; seconds: number; resources: number; completed: number; segments: number[] }[];
  activityTrends: Record<TrendPeriod, TrendPoint[]>;
};

function seconds(day: HomeActivityDay): number {
  return day.focusSeconds + day.practiceSeconds + day.researchSeconds;
}

function summarize(days: HomeActivityDay[]) {
  const sum = (key: keyof Omit<HomeActivityDay, "day">) => days.reduce((total, day) => total + day[key], 0);
  const segments = [sum("focusSeconds"), sum("practiceSeconds"), sum("researchSeconds")];
  return { seconds: segments.reduce((total, value) => total + value, 0), segments, resources: sum("resources"), completed: sum("completed") };
}

// These ISO calendar dates already reflect the learner's timezone.
function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function labelDate(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

function trendPoints(days: HomeActivityDay[], today: string, period: TrendPeriod): TrendPoint[] {
  const keys = [...new Set(days.map((day) => period === "Day" ? day.day : period === "Month" ? day.day.slice(0, 7) : day.day.slice(0, 4)))];
  const current = period === "Day" ? today : period === "Month" ? today.slice(0, 7) : today.slice(0, 4);
  const first = keys[0];
  if (!first) return [];
  const buckets: string[] = [];
  if (period === "Day") {
    for (let day = first > addDays(today, -6) ? first : addDays(today, -6); day <= today; day = addDays(day, 1)) buckets.push(day);
  } else if (period === "Month") {
    const date = new Date(`${current}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 11);
    for (let month = date.toISOString().slice(0, 7); month <= current; date.setUTCMonth(date.getUTCMonth() + 1), month = date.toISOString().slice(0, 7)) {
      if (month >= first) buckets.push(month);
    }
  } else {
    for (let year = Number(first); year <= Number(current); year++) buckets.push(String(year));
  }
  return buckets.map((bucket) => {
    const date = period === "Day" ? bucket : period === "Month" ? `${bucket}-01` : `${bucket}-01-01`;
    return {
      label: period === "Year" ? bucket : labelDate(date, period === "Day" ? { weekday: "short" } : { month: "short" }),
      title: period === "Year" ? bucket : labelDate(date, period === "Day" ? { month: "short", day: "numeric", year: "numeric" } : { month: "long", year: "numeric" }),
      ...summarize(days.filter((day) => day.day.startsWith(bucket))),
    };
  });
}

export function createHomeAnalytics(home: LearnHomeData): HomeAnalyticsData {
  const { today } = home.activity;
  const days = home.activity.days.filter((day) => day.day <= today).toSorted((left, right) => left.day.localeCompare(right.day));
  const totals = summarize(days);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday + 6) % 7));
  const lastWeekStart = addDays(weekStart, -7);
  const thisWeek = summarize(days.filter((day) => day.day >= weekStart));
  const lastWeek = summarize(days.filter((day) => day.day >= lastWeekStart && day.day < weekStart));
  const bars = Array.from({ length: 4 }, (_, index) => {
    const start = addDays(weekStart, (index - 3) * 7);
    const end = addDays(start, 7);
    return { label: index === 3 ? "This week" : `Week of ${labelDate(start, { month: "short", day: "numeric" })}`, seconds: summarize(days.filter((day) => day.day >= start && day.day < end)).seconds };
  });
  const distribution = [
    { label: "Videos", seconds: days.reduce((sum, day) => sum + day.videoSeconds, 0), tone: "lavender" },
    { label: "Research", seconds: days.reduce((sum, day) => sum + day.paperSeconds, 0), tone: "green" },
    { label: "Practice", seconds: totals.segments[1] ?? 0, tone: "pink" },
    { label: "Other study", seconds: days.reduce((sum, day) => sum + day.otherSeconds, 0), tone: "yellow" },
  ] as const;
  return {
    learningOverview: {
      seconds: totals.seconds,
      activeDays: days.filter((day) => seconds(day) > 0).length,
      changePct: lastWeek.seconds > 0 ? Math.round((thisWeek.seconds - lastWeek.seconds) / lastWeek.seconds * 100) : null,
      bars: bars.filter((bar) => bar.seconds > 0).length >= 2 ? bars : [],
    },
    studyDistribution: distribution.filter((item) => item.seconds > 0).map((item) => ({ ...item, percent: item.seconds / totals.seconds * 100 })),
    continueWatching: home.continueWatching,
    weeklyProgress: [
      { label: "Weekly", ...thisWeek }, { label: "Last week", ...lastWeek },
      { label: "Monthly", ...summarize(days.filter((day) => day.day.startsWith(today.slice(0, 7)))) },
    ],
    activityTrends: { Day: trendPoints(days, today, "Day"), Month: trendPoints(days, today, "Month"), Year: trendPoints(days, today, "Year") },
  };
}

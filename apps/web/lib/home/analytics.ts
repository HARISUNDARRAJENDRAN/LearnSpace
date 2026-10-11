import type { HomeActivityDay, LearnHomeData } from "./service";

export type ActivityPeriod = "This Week" | "Last Week" | "This Month";
export type ActivityPoint = { day: string; label: string; seconds: number };

function seconds(day: HomeActivityDay): number {
  return day.focusSeconds + day.practiceSeconds + day.researchSeconds;
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function createHomeAnalytics(home: LearnHomeData) {
  const { today } = home.activity;
  const days = home.activity.days.filter((day) => day.day <= today);
  const byDate = new Map(days.map((day) => [day.day, seconds(day)]));
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday + 6) % 7));
  const periods = Object.fromEntries((["This Week", "Last Week", "This Month"] as const).map((period) => {
    const start = period === "This Month" ? `${today.slice(0, 7)}-01` : period === "Last Week" ? addDays(weekStart, -7) : weekStart;
    const month = new Date(`${start}T00:00:00Z`);
    month.setUTCMonth(month.getUTCMonth() + 1);
    const end = period === "This Month" ? month.toISOString().slice(0, 10) : addDays(start, 7);
    const points: ActivityPoint[] = [];
    for (let day = start; day < end; day = addDays(day, 1)) {
      const date = new Date(`${day}T00:00:00Z`);
      points.push({ day, label: period === "This Month" ? String(date.getUTCDate()) : new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(date), seconds: byDate.get(day) ?? 0 });
    }
    return [period, points];
  })) as Record<ActivityPeriod, ActivityPoint[]>;
  let streak = 0;
  // Yesterday's streak remains current until the learner studies today.
  for (let day = (byDate.get(today) ?? 0) > 0 ? today : addDays(today, -1); (byDate.get(day) ?? 0) > 0; day = addDays(day, -1)) streak++;
  return {
    seconds: days.reduce((sum, day) => sum + seconds(day), 0),
    completed: days.reduce((sum, day) => sum + day.completed, 0),
    streak,
    periods,
  };
}

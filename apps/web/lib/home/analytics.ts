import type { HomeData } from "./load";

export type AnalyticsTone = "lavender" | "light-lavender" | "green" | "pink" | "yellow";
export type TrendPeriod = "Day" | "Month" | "Year";
export type TrendPoint = { label: string; title: string; stacks: number[]; resources: number; completed: number; hours: number };
export type HomeAnalyticsData = {
  learningOverview: { activity: number; badge: string; bars: number[] };
  studyDistribution: { label: string; percent: number; duration: string; tone: AnalyticsTone }[];
  continueWatching: HomeData["home"]["continueWatching"];
  weeklyProgress: { label: string; progress: number; shares: number[] }[];
  activityTrends: Record<TrendPeriod, TrendPoint[]>;
};

const monthStacks = [[4, 6, 2], [5, 2, 3], [6, 7, 3], [4, 9, 7], [3, 2, 4], [5, 6, 5], [7, 4, 10], [2, 5, 6], [5, 4, 3], [7, 6, 5], [3, 2, 6], [7, 4, 5]];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Explicit reference fixtures: no study-duration aggregation exists in the Home API.
// Percentages reproduce the supplied reference; distribution categories may overlap.
export const sampleHomeAnalytics: HomeAnalyticsData = {
  learningOverview: { activity: 36, badge: "↗ 14.6%", bars: [58, 68, 100, 78] },
  studyDistribution: [
    { label: "Videos", percent: 48, duration: "8h 12m", tone: "lavender" },
    { label: "Research", percent: 31, duration: "6h 46m", tone: "green" },
    { label: "Notes", percent: 15, duration: "3h 18m", tone: "pink" },
    { label: "Quizzes", percent: 12, duration: "2h 05m", tone: "yellow" },
  ],
  continueWatching: null,
  weeklyProgress: [
    { label: "Weekly", progress: 85.2, shares: [37, 42, 12] },
    { label: "Last week", progress: 69.3, shares: [31, 35, 19] },
    { label: "Monthly", progress: 78.6, shares: [34, 39, 17] },
  ],
  activityTrends: {
    Month: months.map((label, index) => ({ label, title: `${label === "Jul" ? "July" : label} 2026`, stacks: monthStacks[index] ?? [], resources: index === 6 ? 148 : 42 + index * 13, completed: index === 6 ? 24 : 8 + index * 2, hours: index === 6 ? 82 : 21 + index * 7 })),
    Day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => ({ label, title: `${label} · sample week`, stacks: [3 + index % 4, 5 + index % 3, 2 + index % 5], resources: 8 + index * 2, completed: 2 + index, hours: 2 + index / 2 })),
    Year: ["2021", "2022", "2023", "2024", "2025", "2026"].map((label, index) => ({ label, title: label, stacks: [3 + index, 4 + index, 2 + index], resources: 120 + index * 81, completed: 32 + index * 19, hours: 180 + index * 64 })),
  },
};

export function createHomeAnalytics(home: HomeData["home"]): HomeAnalyticsData {
  return { ...sampleHomeAnalytics, continueWatching: home.continueWatching };
}

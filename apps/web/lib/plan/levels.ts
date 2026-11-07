// XP is derived from recorded study evidence, never stored, so it cannot drift from what the learner did.
// Each activity earns its own points; changing a rule re-scores everyone consistently.
export const ACTIVITIES = ["watch", "read", "finish_video", "finish_paper", "question", "plan_watch", "plan_read", "plan_practice", "plan_review"] as const;
export type Activity = (typeof ACTIVITIES)[number];

// amount is minutes for watch/read, completed items' worth for plan kinds (0.5 = half done), and a count otherwise.
export type ActivityDay = { day: string; activity: Activity; amount: number };

export type XpRule = { label: string; xp: number; per: string; dailyCap?: number };

export const XP_RULES: Record<Activity, XpRule> = {
  watch: { label: "Watch a video", xp: 1, per: "focused minute" },
  // Papers are denser, so a reading minute is worth more than a watching minute.
  read: { label: "Read a paper or article", xp: 2, per: "focused minute" },
  finish_video: { label: "Finish a video", xp: 50, per: "video" },
  finish_paper: { label: "Finish a paper", xp: 100, per: "paper" },
  // Capped so asking filler questions cannot farm XP.
  question: { label: "Ask the tutor a question", xp: 5, per: "question", dailyCap: 10 },
  plan_watch: { label: "Complete a Watch plan item", xp: 20, per: "completed item" },
  plan_read: { label: "Complete a Read plan item", xp: 30, per: "completed item" },
  // Practice has no evidence of its own besides the plan, so completing it carries more weight.
  plan_practice: { label: "Complete a Practice plan item", xp: 40, per: "completed item" },
  plan_review: { label: "Complete a Review plan item", xp: 30, per: "completed item" },
};

// Every study day that continues a streak earns this on top.
export const STREAK_BONUS_XP = 10;

export type XpEarned = Record<Activity | "streak", number>;

export const RANKS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"] as const;
export type Rank = (typeof RANKS)[number];

// XP needed to reach each of the 25 levels; every five levels is a rank.
export const LEVEL_XP = [
  0, 100, 250, 500, 750,
  1000, 1500, 2000, 2500, 3000,
  4000, 5000, 6000, 7000, 8000,
  10000, 12000, 14000, 16000, 18000,
  21000, 24000, 27000, 30000, 35000,
] as const;

export type Progression = {
  xp: number;
  level: number;
  rank: Rank;
  levelXp: number;
  nextLevelXp: number | null;
  weekXp: number;
  todayXp: number;
  streak: number;
  earned: XpEarned;
};

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function levelFor(xp: number): { level: number; rank: Rank; levelXp: number; nextLevelXp: number | null } {
  const index = LEVEL_XP.findLastIndex((threshold) => xp >= threshold);
  return { level: index + 1, rank: RANKS[Math.floor(index / 5)]!, levelXp: LEVEL_XP[index]!, nextLevelXp: LEVEL_XP[index + 1] ?? null };
}

export function activityXp({ activity, amount }: Pick<ActivityDay, "activity" | "amount">): number {
  const rule = XP_RULES[activity];
  return Math.floor(Math.min(amount, rule.dailyCap ?? Number.POSITIVE_INFINITY) * rule.xp);
}

// Days are calendar days in the learner's timezone; today's earlier days count for the week and streak.
export function progression(days: ActivityDay[], today: string): Progression {
  const byDay = new Map<string, number>();
  const earned = Object.fromEntries([...ACTIVITIES, "streak"].map((key) => [key, 0])) as XpEarned;
  for (const entry of days) {
    if (entry.day > today) continue;
    const xp = activityXp(entry);
    byDay.set(entry.day, (byDay.get(entry.day) ?? 0) + xp);
    earned[entry.activity] += xp;
  }
  // The streak bonus rides on activity XP only, so it never feeds itself.
  for (const [day, xp] of [...byDay]) {
    if (xp <= 0 || (byDay.get(addDays(day, -1)) ?? 0) <= 0) continue;
    byDay.set(day, xp + STREAK_BONUS_XP);
    earned.streak += STREAK_BONUS_XP;
  }
  const xp = [...byDay.values()].reduce((total, value) => total + value, 0);
  const weekStart = addDays(today, -6);
  const weekXp = [...byDay].filter(([day]) => day >= weekStart).reduce((total, [, value]) => total + value, 0);
  // A streak survives until the day ends, so an unstudied today still counts yesterday's run.
  let streak = 0;
  for (let day = (byDay.get(today) ?? 0) > 0 ? today : addDays(today, -1); (byDay.get(day) ?? 0) > 0; day = addDays(day, -1)) streak++;
  return { xp, ...levelFor(xp), weekXp, todayXp: byDay.get(today) ?? 0, streak, earned };
}

export type LearnerStats = { activeDays: number; longestStreak: number; focusMinutes: number; lessonsFinished: number; planDone: number; questions: number };

export function learnerStats(days: ActivityDay[], today: string): LearnerStats {
  const past = days.filter((entry) => entry.day <= today);
  const total = (...activities: Activity[]) => past.filter((entry) => activities.includes(entry.activity)).reduce((sum, entry) => sum + entry.amount, 0);
  const active = [...new Set(past.filter((entry) => activityXp(entry) > 0).map((entry) => entry.day))].toSorted();
  let longestStreak = 0;
  let run = 0;
  active.forEach((day, index) => {
    run = index > 0 && addDays(active[index - 1]!, 1) === day ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  });
  return {
    activeDays: active.length,
    longestStreak,
    focusMinutes: total("watch", "read"),
    lessonsFinished: total("finish_video", "finish_paper"),
    planDone: total("plan_watch", "plan_read", "plan_practice", "plan_review"),
    questions: total("question"),
  };
}

export type Achievement = { id: string; title: string; detail: string; value: number; target: number; unlocked: boolean };

// Milestones over the same evidence as XP, so they unlock on their own and never need a separate record.
const milestones: { id: string; title: string; detail: string; target: number; value: (progress: Progression, stats: LearnerStats) => number }[] = [
  { id: "first-steps", title: "First steps", detail: "Earn your first XP", target: 1, value: (progress) => progress.xp },
  { id: "finisher", title: "Finisher", detail: "Finish a lesson", target: 1, value: (_, stats) => stats.lessonsFinished },
  { id: "ten-down", title: "Ten down", detail: "Finish 10 lessons", target: 10, value: (_, stats) => stats.lessonsFinished },
  { id: "deep-focus", title: "Deep focus", detail: "Study for 10 focused hours", target: 600, value: (_, stats) => stats.focusMinutes },
  { id: "curious", title: "Curious mind", detail: "Ask the tutor 25 questions", target: 25, value: (_, stats) => stats.questions },
  { id: "planner", title: "Planner", detail: "Complete 10 plan items", target: 10, value: (_, stats) => stats.planDone },
  { id: "on-a-roll", title: "On a roll", detail: "Study 7 days in a row", target: 7, value: (_, stats) => stats.longestStreak },
  { id: "unstoppable", title: "Unstoppable", detail: "Study 30 days in a row", target: 30, value: (_, stats) => stats.longestStreak },
  { id: "silver", title: "Silver", detail: "Reach the Silver rank", target: 6, value: (progress) => progress.level },
  { id: "gold", title: "Gold", detail: "Reach the Gold rank", target: 11, value: (progress) => progress.level },
  { id: "diamond", title: "Diamond", detail: "Reach the Diamond rank", target: 21, value: (progress) => progress.level },
];

export function achievements(progress: Progression, stats: LearnerStats): Achievement[] {
  return milestones.map(({ value, ...milestone }) => {
    const reached = value(progress, stats);
    return { ...milestone, value: Math.min(reached, milestone.target), unlocked: reached >= milestone.target };
  });
}

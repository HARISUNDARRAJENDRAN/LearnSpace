import { withUserTransaction } from "@learnspace/db";
import { localToday, loadTimezone, loadActivityDays } from "../home/service";
import { type Achievement, achievements, learnerStats, type LearnerStats, type Progression, progression } from "../plan/levels";

export type LearnerProfile = { timezone: string; progression: Progression; stats: LearnerStats; achievements: Achievement[] };

export async function getLearnerProfile(userId: string): Promise<LearnerProfile> {
  return withUserTransaction(userId, async (tx) => {
    const timezone = await loadTimezone(tx, userId);
    const today = localToday(timezone);
    const days = await loadActivityDays(tx, userId, timezone);
    const progress = progression(days, today);
    const stats = learnerStats(days, today);
    return { timezone, progression: progress, stats, achievements: achievements(progress, stats) };
  });
}

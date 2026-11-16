import { consumeRateLimit } from "../auth/rate-limit";

/** Runs and submissions each start sandbox containers: a few a minute is plenty to work, and bounds a script hammering the grader. */
export async function admitCodeRun(userId: string): Promise<void> {
  const windows = await Promise.allSettled([
    consumeRateLimit(`learnspace:coding:run:minute:${userId}`, 20, 60),
    consumeRateLimit(`learnspace:coding:run:hour:${userId}`, 300, 3_600),
  ]);
  for (const window of windows) if (window.status === "rejected") throw window.reason;
}

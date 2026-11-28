import { withUserTransaction } from "@learnspace/db";
import { activityEvents, focusSessions, sessionResources, studySessions, userResourceProgress } from "@learnspace/db/schema";
import { studySessionIdSchema } from "@learnspace/shared";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { projectStudyBehavior } from "../discovery/service";
import { invalidateHomeDashboardCache } from "../home/service";
import { AuthError } from "../auth/errors";

export const studyFocusIntervalSchema = z.object({
  id: z.string().uuid(),
  resourceId: z.string().uuid(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
}).strict().refine((value) => value.endedAt > value.startedAt && value.endedAt - value.startedAt <= 90_000, "Send an active study interval of at most 90 seconds.");

export type StudyFocusInterval = z.infer<typeof studyFocusIntervalSchema>;

export async function recordStudyFocus(userId: string, sessionId: string, input: StudyFocusInterval): Promise<{ seconds: number }> {
  const normalizedSessionId = studySessionIdSchema.parse(sessionId);
  const interval = studyFocusIntervalSchema.parse(input);
  const now = Date.now();
  if (interval.startedAt < now - 180_000 || interval.endedAt > now + 1_000) throw new AuthError("INVALID_STUDY_INTERVAL", "Record recent active study time.", 422);
  const recorded = await withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study-time:${userId}`}, 0))`);
    const [previous] = await tx.select({ seconds: focusSessions.durationSec }).from(focusSessions).where(and(eq(focusSessions.userId, userId), eq(focusSessions.id, interval.id)));
    if (previous) return { seconds: previous.seconds ?? 0 };
    const [session] = await tx.select({ mode: studySessions.mode, startedAt: studySessions.startedAt, metadata: studySessions.metadata })
      .from(studySessions).innerJoin(sessionResources, eq(sessionResources.studySessionId, studySessions.id))
      .where(and(eq(studySessions.id, normalizedSessionId), eq(studySessions.userId, userId), eq(sessionResources.resourceId, interval.resourceId), ne(studySessions.status, "abandoned")));
    if (!session) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That study material is not available in this session.", 404);
    const endedAt = new Date(Math.min(interval.endedAt, now));
    const startedAt = new Date(Math.max(interval.startedAt, session.startedAt.getTime()));
    const overlaps = await tx.select({ startedAt: focusSessions.startedAt, endedAt: focusSessions.endedAt }).from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), gt(focusSessions.endedAt, startedAt), lt(focusSessions.startedAt, endedAt)))
      .orderBy(focusSessions.startedAt);
    // Count the union of active time, including out-of-order heartbeats, once.
    let cursor = startedAt.getTime();
    let uncoveredMs = 0;
    for (const overlap of overlaps) {
      uncoveredMs += Math.max(0, Math.min(overlap.startedAt.getTime(), endedAt.getTime()) - cursor);
      cursor = Math.max(cursor, Math.min(overlap.endedAt?.getTime() ?? cursor, endedAt.getTime()));
    }
    uncoveredMs += Math.max(0, endedAt.getTime() - cursor);
    const seconds = Math.floor(uncoveredMs / 1_000);
    if (!seconds) return { seconds: 0 };
    await tx.insert(focusSessions).values({ id: interval.id, userId, studySessionId: normalizedSessionId, resourceId: interval.resourceId, mode: session.mode, startedAt, endedAt, durationSec: seconds, completed: true });
    const [time] = await tx.select({ seconds: sql<number>`COALESCE(sum(${focusSessions.durationSec}), 0)::int` }).from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.resourceId, interval.resourceId), eq(focusSessions.studySessionId, normalizedSessionId)));
    const [progress] = await tx.select({ completedAt: userResourceProgress.completedAt, progressPct: userResourceProgress.progressPct }).from(userResourceProgress)
      .where(and(eq(userResourceProgress.userId, userId), eq(userResourceProgress.resourceId, interval.resourceId)));
    const attribution = session.metadata.recommendationRuns as Record<string, string> | undefined;
    const [event] = await tx.insert(activityEvents).values({ schemaVersion: 1, userId, studySessionId: normalizedSessionId, resourceId: interval.resourceId,
      eventType: "resource.consumed", actorType: "user", source: "web", idempotencyKey: `study:consumed:${interval.id}`, occurredAt: endedAt,
      payload: { durationSeconds: seconds, watchedSeconds: Number(time?.seconds ?? 0), progressPct: progress?.progressPct ?? 0, rewatch: Boolean(progress?.completedAt && session.startedAt >= progress.completedAt), runId: attribution?.[interval.resourceId] ?? null },
    }).onConflictDoNothing().returning();
    if (event) await projectStudyBehavior(tx, event);
    return { seconds };
  });
  if (recorded.seconds > 0) await invalidateHomeDashboardCache(userId);
  return recorded;
}

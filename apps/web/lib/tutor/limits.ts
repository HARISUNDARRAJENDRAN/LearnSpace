import type { Transaction } from "@learnspace/db";
import { sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { consumeRateLimit } from "../auth/rate-limit";
import { TUTOR_MODEL } from "../ai/tutor-model";

const dollars = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/**
 * Defaults assume under $0.002 a turn on average (≈6K evidence tokens in, ≈500 answer tokens out; the few questions that
 * need reasoning add a few thousand reasoning tokens): a learner's $0.40 is ~200 turns a day, and the $10 global cap stops a runaway month at ~$300.
 */
export function tutorLimits() {
  return {
    perMinute: 6,
    perHour: 60,
    interactionsPerMinute: 30,
    // A check is a start and a few graded answers; its own counter, so chatting with the tutor never blocks it.
    masteryPerMinute: 12,
    userDailyUsd: dollars("TUTOR_USER_DAILY_USD", 0.4),
    globalDailyUsd: dollars("TUTOR_GLOBAL_DAILY_USD", 10),
    // A pending answer older than this died with its server; it no longer blocks the learner.
    pendingStaleSeconds: Math.ceil(TUTOR_MODEL.timeoutMs / 1_000) + 30,
  };
}

export const GLOBAL_USAGE_PROVIDER = `tutor:${TUTOR_MODEL.id}`;

/** Request-frequency limits, checked before any database or model work. */
export async function admitTutorRequest(userId: string): Promise<void> {
  const limits = tutorLimits();
  await consumeRateLimit(`learnspace:tutor:minute:${userId}`, limits.perMinute, 60);
  await consumeRateLimit(`learnspace:tutor:hour:${userId}`, limits.perHour, 3_600);
}

export async function admitTutorInteraction(userId: string): Promise<void> {
  await consumeRateLimit(`learnspace:tutor:interaction:${userId}`, tutorLimits().interactionsPerMinute, 60);
}

export async function admitMasteryRequest(userId: string): Promise<void> {
  await consumeRateLimit(`learnspace:mastery:minute:${userId}`, tutorLimits().masteryPerMinute, 60);
}

const untilUtcMidnight = () => Math.max(60, Math.ceil((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1_000));

/** One answer at a time per learner, and no new spending once the learner's or everyone's daily budget (tutor and mastery checks) is used. Holds the learner's lock. */
export async function admitTutorGeneration(tx: Transaction, userId: string): Promise<void> {
  const limits = tutorLimits();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.tutor:${userId}`}, 0))`);
  await tx.execute(sql`
    UPDATE study.tutor_messages m SET status = 'failed', content = m.content || '{"failure":"interrupted"}'::jsonb
    FROM study.tutor_threads t
    WHERE t.id = m.thread_id AND t.user_id = ${userId} AND m.status = 'pending' AND m.created_at < now() - make_interval(secs => ${limits.pendingStaleSeconds})`);
  const [pending] = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM study.tutor_messages m JOIN study.tutor_threads t ON t.id = m.thread_id
    WHERE t.user_id = ${userId} AND m.status = 'pending'`);
  if ((pending?.count ?? 0) > 0) throw new AuthError("TUTOR_BUSY", "The tutor is still answering your last question.", 429, 10);
  const [spent] = await tx.execute<{ usd: string }>(sql`
    SELECT coalesce(sum(mi.estimated_cost_usd), 0)::text AS usd
    FROM agent.agent_runs r JOIN agent.model_invocations mi ON mi.agent_run_id = r.id
    WHERE r.user_id = ${userId} AND r.purpose IN ('video_tutor', 'mastery_check') AND r.created_at >= (now() AT TIME ZONE 'UTC')::date`);
  if (Number(spent?.usd ?? 0) >= limits.userDailyUsd) throw new AuthError("TUTOR_DAILY_LIMIT", "You've reached today's tutor limit. It resets at midnight UTC.", 429, untilUtcMidnight());
  const [global] = await tx.execute<{ units: string }>(sql`
    SELECT units::text FROM ops.api_usage_daily WHERE provider = ${GLOBAL_USAGE_PROVIDER} AND usage_date = (now() AT TIME ZONE 'UTC')::date`);
  if (Number(global?.units ?? 0) / 1e6 >= limits.globalDailyUsd) throw new AuthError("TUTOR_CAPACITY", "The tutor has reached today's capacity. Please try again tomorrow.", 503, untilUtcMidnight());
}

/** Adds a call's cost, in micro-dollars, to today's shared counter. */
export async function recordGlobalSpend(tx: Transaction, usd: number): Promise<void> {
  const units = Math.ceil(usd * 1e6);
  if (units <= 0) return;
  await tx.execute(sql`
    INSERT INTO ops.api_usage_daily (provider, usage_date, units) VALUES (${GLOBAL_USAGE_PROVIDER}, (now() AT TIME ZONE 'UTC')::date, ${units})
    ON CONFLICT (provider, usage_date) DO UPDATE SET units = ops.api_usage_daily.units + EXCLUDED.units`);
}

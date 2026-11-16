import { isUuid, type Transaction } from "@learnspace/db";
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
    // Talking with Luny is a turn per spoken utterance, ended by a pause of a fifth of a second, and an interrupted turn is
    // asked again with the next one.
    notesPerMinute: 40,
    notesPerHour: 1_000,
    userDailyUsd: dollars("TUTOR_USER_DAILY_USD", 0.4),
    globalDailyUsd: dollars("TUTOR_GLOBAL_DAILY_USD", 10),
    // A pending answer older than this died with its server; it no longer blocks the learner.
    pendingStaleSeconds: Math.ceil(TUTOR_MODEL.depths.deep.timeoutMs / 1_000) + 30,
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

/**
 * Starting a voice conversation or a scribe pass; spending is admitted separately. Both windows are counted at once, on
 * two pooled connections, so admission costs one database round trip instead of two; either window's 429 rejects it.
 */
export async function admitNotesRequest(userId: string): Promise<void> {
  const limits = tutorLimits();
  // Settled first, so a rejected window never leaves the other's rejection unhandled; the minute's 429 is the one reported.
  const windows = await Promise.allSettled([
    consumeRateLimit(`learnspace:notes:minute:${userId}`, limits.notesPerMinute, 60),
    consumeRateLimit(`learnspace:notes:hour:${userId}`, limits.notesPerHour, 3_600),
  ]);
  for (const window of windows) if (window.status === "rejected") throw window.reason;
}

export async function admitMasteryRequest(userId: string): Promise<void> {
  await consumeRateLimit(`learnspace:mastery:minute:${userId}`, tutorLimits().masteryPerMinute, 60);
}

const untilUtcMidnight = () => Math.max(60, Math.ceil((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1_000));

/** A run to record as soon as its generation is admitted: in the admission's own statement, so it costs no query of its own. */
export type AdmittedRun = { studySessionId: string; purpose: string; goal: string; policyVersion: string; maxIterations: number; maxToolCalls: number; maxTokens: number };

/**
 * One answer at a time per learner, and no new spending once the learner's or everyone's daily budget (tutor, mastery checks and Luny) is used. Holds the learner's lock.
 * Once the lock is held, every check is one statement, so admission waits on two queries instead of five.
 */
export async function admitTutorGeneration(tx: Transaction, userId: string): Promise<void> {
  await admit(tx, userId, null);
}

/** Admits a generation as `admitTutorGeneration` does, and records its run in the same statement, only if admitted. */
export async function admitTutorRun(tx: Transaction, userId: string, run: AdmittedRun): Promise<string> {
  const id = await admit(tx, userId, run);
  if (!id) throw new Error("The run was not recorded.");
  return id;
}

async function admit(tx: Transaction, userId: string, run: AdmittedRun | null): Promise<string | null> {
  const limits = tutorLimits();
  // The same lock as ever; a UUID goes in as a literal, saving a round trip (see isUuid).
  await tx.execute(isUuid(userId)
    ? sql.raw(`SELECT pg_advisory_xact_lock(hashtextextended('study.tutor:${userId}', 0))`)
    : sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.tutor:${userId}`}, 0))`);
  // A pending answer older than the stale limit died with its server: it is marked failed, and does not count. The
  // statement's snapshot predates its own update, so the rows it marks are left out of the count explicitly.
  const [admission] = await tx.execute<{ pending: number; usd: string; units: string | null; run_id: string | null }>(sql`
    WITH stale AS (
      UPDATE study.tutor_messages m SET status = 'failed', content = m.content || '{"failure":"interrupted"}'::jsonb
      FROM study.tutor_threads t
      WHERE t.id = m.thread_id AND t.user_id = ${userId} AND m.status = 'pending' AND m.created_at < now() - make_interval(secs => ${limits.pendingStaleSeconds})
      RETURNING m.id
    ), checks AS (
      SELECT
        (SELECT count(*)::int FROM study.tutor_messages m JOIN study.tutor_threads t ON t.id = m.thread_id
          WHERE t.user_id = ${userId} AND m.status = 'pending' AND m.id NOT IN (SELECT id FROM stale)) AS pending,
        (SELECT coalesce(sum(mi.estimated_cost_usd), 0)
          FROM agent.agent_runs r JOIN agent.model_invocations mi ON mi.agent_run_id = r.id
          WHERE r.user_id = ${userId} AND r.purpose IN ('video_tutor', 'mastery_check', 'voice_notes') AND r.created_at >= (now() AT TIME ZONE 'UTC')::date) AS usd,
        (SELECT units FROM ops.api_usage_daily WHERE provider = ${GLOBAL_USAGE_PROVIDER} AND usage_date = (now() AT TIME ZONE 'UTC')::date) AS units
    ), run AS (
      INSERT INTO agent.agent_runs (user_id, study_session_id, purpose, status, goal, policy_version, max_iterations, max_tool_calls, max_tokens, correlation_id, started_at)
      SELECT ${userId}, ${run?.studySessionId ?? null}, ${run?.purpose ?? null}, 'executing', ${run?.goal ?? null}, ${run?.policyVersion ?? null},
        ${run?.maxIterations ?? null}, ${run?.maxToolCalls ?? null}, ${run?.maxTokens ?? null}, gen_random_uuid(), now()
      FROM checks
      WHERE ${run !== null} AND checks.pending = 0 AND checks.usd < ${limits.userDailyUsd} AND coalesce(checks.units, 0) / 1e6 < ${limits.globalDailyUsd}
      RETURNING id
    )
    SELECT pending, usd::text AS usd, units::text AS units, (SELECT id FROM run) AS run_id FROM checks`);
  if ((admission?.pending ?? 0) > 0) throw new AuthError("TUTOR_BUSY", "The tutor is still answering your last question.", 429, 10);
  if (Number(admission?.usd ?? 0) >= limits.userDailyUsd) throw new AuthError("TUTOR_DAILY_LIMIT", "You've reached today's tutor limit. It resets at midnight UTC.", 429, untilUtcMidnight());
  if (Number(admission?.units ?? 0) / 1e6 >= limits.globalDailyUsd) throw new AuthError("TUTOR_CAPACITY", "The tutor has reached today's capacity. Please try again tomorrow.", 503, untilUtcMidnight());
  return admission?.run_id ?? null;
}

/** Adds a call's cost, in micro-dollars, to today's shared counter. */
export async function recordGlobalSpend(tx: Transaction, usd: number): Promise<void> {
  const units = Math.ceil(usd * 1e6);
  if (units <= 0) return;
  await tx.execute(sql`
    INSERT INTO ops.api_usage_daily (provider, usage_date, units) VALUES (${GLOBAL_USAGE_PROVIDER}, (now() AT TIME ZONE 'UTC')::date, ${units})
    ON CONFLICT (provider, usage_date) DO UPDATE SET units = ops.api_usage_daily.units + EXCLUDED.units`);
}

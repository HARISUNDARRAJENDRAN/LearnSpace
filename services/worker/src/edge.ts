import { timingSafeEqual } from "node:crypto";
import { drainDiscoveryQueue } from "./discovery.js";

function authorized(request: Request): boolean {
  const secret = process.env.WORKER_TRIGGER_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * HTTP entry for the serverless worker. Postgres (pg_net) calls it when a discovery request commits and
 * pg_cron calls it with `{"housekeeping":true}`. It answers at once and drains the queue in the background,
 * so the caller's short HTTP timeout never cuts a job short.
 */
export async function handleWorkerRequest(request: Request, waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!authorized(request)) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => ({})) as { housekeeping?: unknown };
  waitUntil(drainDiscoveryQueue({ housekeeping: body?.housekeeping === true })
    .then((result) => console.info(JSON.stringify({ metric: "discovery_drain", ...result })))
    .catch((error) => console.warn(JSON.stringify({ metric: "discovery_drain_failure", error: error instanceof Error ? error.message : "drain failed" }))));
  return new Response(null, { status: 202 });
}

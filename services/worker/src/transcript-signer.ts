import postgres from "postgres";
import { signCaptions } from "./transcripts.js";

// Runs on a home machine: signs caption URLs from a residential IP so learners' browsers can download the captions.
// It never logs in or sends cookies, paces itself, and stops for hours at the first sign YouTube is pushing back.
const PACE_MS = 10_000;
const IDLE_MS = 5_000;
const DAILY_CAP = 500;
const BACKOFF_MS = 6 * 3_600_000;

if (!process.env.DATABASE_WORKER_URL) throw new Error("DATABASE_WORKER_URL is required");
const sql = postgres(process.env.DATABASE_WORKER_URL, { max: 1, prepare: false });
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
const sleep = (ms: number) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  stop.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});
const log = (entry: Record<string, unknown>) => console.info(JSON.stringify({ at: new Date().toISOString(), ...entry }));

let day = new Date().toDateString();
let signedToday = 0;
try {
  log({ signer: "started", paceMs: PACE_MS, dailyCap: DAILY_CAP });
  while (!stop.signal.aborted) {
    if (new Date().toDateString() !== day) { day = new Date().toDateString(); signedToday = 0; }
    if (signedToday >= DAILY_CAP) { await sleep(600_000); continue; }
    // attempts = 0 keeps a video the signer could not sign for Firecrawl, instead of asking YouTube again.
    const [request] = await sql<{ resource_id: string; youtube_id: string }[]>`
      SELECT resource_id, youtube_id FROM ops.transcript_requests
      WHERE status = 'queued' AND attempts = 0 ORDER BY requested_at LIMIT 1`;
    if (!request) { await sleep(IDLE_MS); continue; }
    const outcome = await signCaptions(request.youtube_id);
    if (outcome.kind === "blocked") {
      log({ signer: "paused", youtubeId: request.youtube_id, detail: outcome.detail, resumesAt: new Date(Date.now() + BACKOFF_MS).toISOString() });
      await sleep(BACKOFF_MS);
      continue;
    }
    signedToday += 1;
    if (outcome.kind === "signed") {
      await sql`UPDATE ops.transcript_requests SET status = 'signed', caption_url = ${outcome.captionUrl}, language = ${outcome.language}, expires_at = ${outcome.expiresAt}, attempts = attempts + 1, detail = NULL, updated_at = now() WHERE resource_id = ${request.resource_id}`;
    } else {
      // Unavailable is final; needs_fallback stays queued for the worker's Firecrawl pass.
      await sql`UPDATE ops.transcript_requests SET status = ${outcome.kind === "unavailable" ? "unavailable" : "queued"}, attempts = attempts + 1, detail = ${outcome.detail}, updated_at = now() WHERE resource_id = ${request.resource_id}`;
    }
    log({ signer: outcome.kind, youtubeId: request.youtube_id, ...(outcome.kind === "signed" ? { language: outcome.language } : { detail: outcome.detail }) });
    await sleep(PACE_MS);
  }
} finally {
  await sql.end({ timeout: 5 });
}

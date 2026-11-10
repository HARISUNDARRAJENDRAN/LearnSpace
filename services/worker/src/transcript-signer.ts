import postgres from "postgres";
import { embeddingProvider } from "./embeddings.js";
import { embedTranscriptChunks, firecrawlNext, publishSubmissions, signCaptions } from "./transcripts.js";

// Runs on a home machine: signs caption URLs from a residential IP so learners' browsers can download the captions,
// then publishes the first download and embeds it. Only signing talks to YouTube: it never logs in or sends cookies,
// paces itself, and stops for hours at the first sign YouTube is pushing back. Publishing never waits on that.
// When no learner's copy arrives soon after signing (their network may be the one YouTube is refusing), Firecrawl
// fetches the transcript from its own servers.
const TICK_MS = 2_000;
const PACE_MS = 10_000;
const DAILY_CAP = 500;
const BACKOFF_MS = 6 * 3_600_000;
// Every chunk of a fresh transcript, so the tutor can rank by meaning from its first question.
const EMBED_LIMIT = 5_000;
// A browser downloads within seconds of signing; this long without a copy means it will not come.
const RESCUE_AFTER = "15 seconds";
const FIRECRAWL_DAILY_CAP = 100;
const FIRECRAWL_BACKOFF_MS = 10 * 60_000;
const firecrawlKey = process.env.FIRECRAWL_API_KEY;

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
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

let day = new Date().toDateString();
let signedToday = 0;
let nextSignAt = 0;
let rescuedToday = 0;
let nextRescueAt = 0;
let rescuing = false;

// The transcript is already answerable by its words; a failed embedding is retried by worker housekeeping.
async function embed(versions: string[]) {
  const embedded = await embedTranscriptChunks(sql, embeddingProvider(), EMBED_LIMIT, versions).catch((error) => { log({ signer: "embedding_failed", error: message(error) }); return 0; });
  log({ signer: "embedded", chunks: embedded });
}

async function publish() {
  const versions = await publishSubmissions(sql);
  if (versions.length === 0) return;
  log({ signer: "published", versions: versions.length });
  await embed(versions);
}

async function rescue() {
  if (!firecrawlKey || rescuedToday >= FIRECRAWL_DAILY_CAP || Date.now() < nextRescueAt) return;
  try {
    const rescued = await firecrawlNext(sql, firecrawlKey, RESCUE_AFTER);
    if (!rescued) return;
    rescuedToday += 1;
    log({ signer: "firecrawl", youtubeId: rescued.youtubeId, found: rescued.found });
    if (rescued.versionId) await embed([rescued.versionId]);
  } catch (error) {
    // Out of credits or Firecrawl down: housekeeping keeps trying, and so does the signer after a pause.
    nextRescueAt = Date.now() + FIRECRAWL_BACKOFF_MS;
    log({ signer: "firecrawl_failed", error: message(error) });
  }
}

async function sign() {
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); signedToday = 0; rescuedToday = 0; }
  if (signedToday >= DAILY_CAP || Date.now() < nextSignAt) return;
  // attempts = 0 keeps a video the signer could not sign for Firecrawl, instead of asking YouTube again.
  const [request] = await sql<{ resource_id: string; youtube_id: string }[]>`
    SELECT resource_id, youtube_id FROM ops.transcript_requests
    WHERE status = 'queued' AND attempts = 0 ORDER BY requested_at LIMIT 1`;
  if (!request) return;
  const outcome = await signCaptions(request.youtube_id);
  nextSignAt = Date.now() + PACE_MS;
  if (outcome.kind === "blocked") {
    nextSignAt = Date.now() + BACKOFF_MS;
    log({ signer: "paused", youtubeId: request.youtube_id, detail: outcome.detail, resumesAt: new Date(nextSignAt).toISOString() });
    return;
  }
  signedToday += 1;
  if (outcome.kind === "signed") {
    await sql`UPDATE ops.transcript_requests SET status = 'signed', caption_url = ${outcome.captionUrl}, language = ${outcome.language}, expires_at = ${outcome.expiresAt}, attempts = attempts + 1, detail = NULL, updated_at = now() WHERE resource_id = ${request.resource_id}`;
  } else {
    // Unavailable is final; needs_fallback stays queued for the worker's Firecrawl pass.
    await sql`UPDATE ops.transcript_requests SET status = ${outcome.kind === "unavailable" ? "unavailable" : "queued"}, attempts = attempts + 1, detail = ${outcome.detail}, updated_at = now() WHERE resource_id = ${request.resource_id}`;
  }
  log({ signer: outcome.kind, youtubeId: request.youtube_id, ...(outcome.kind === "signed" ? { language: outcome.language } : { detail: outcome.detail }) });
}

try {
  log({ signer: "started", tickMs: TICK_MS, paceMs: PACE_MS, dailyCap: DAILY_CAP });
  while (!stop.signal.aborted) {
    // A database hiccup skips one tick instead of ending the signer.
    await publish().catch((error) => log({ signer: "publish_failed", error: message(error) }));
    await sign().catch((error) => log({ signer: "sign_failed", error: message(error) }));
    // A scrape takes seconds, so it runs beside the ticks instead of holding up other videos' publishing.
    if (!rescuing) { rescuing = true; void rescue().finally(() => { rescuing = false; }); }
    await sleep(TICK_MS);
  }
} finally {
  await sql.end({ timeout: 5 });
}

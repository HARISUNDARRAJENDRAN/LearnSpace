/**
 * Server-side latency of the Notes session: one spoken turn with Luny and one scribe pass, against the local Postgres
 * reached through a proxy that adds a fixed network round trip, with a stand-in model whose timings are fixed. The model
 * is the same in every run, so what is measured is everything LearnSpace does around it.
 *
 *   DATABASE_MIGRATOR_URL=… DATABASE_URL=… DATABASE_AUTH_URL=… \
 *     pnpm exec tsx --tsconfig tsconfig.test.json scripts/benchmark-notes-latency.ts [--rtt 2,20,60] [--turns 12] [--pool 10] [--out file.json]
 *
 * Measured per voice turn, from the call: until the model is asked (`toModelMs`), until Luny's whole reply can be spoken
 * (`toLastWordsMs`: the event that releases her last sentence to the voice: the final say, or done before it existed), and until the turn is done (`toDoneMs`).
 * Per scribe pass: until the first edit can be shown (`toFirstEditMs`) and until the notebook is saved (`toSavedMs`).
 * Before each, the check every request passes first (`gateMs`: the signed-in session and finished onboarding, as
 * requireCompletedSession makes it, from the session token); `requestToModelMs` is that plus `toModelMs`.
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import type { NoteOp, VoiceTurnEvent } from "@learnspace/shared/notes";
import type { TutorModel } from "../lib/ai/tutor-model";
import { appModules, createLearner, createLesson, gateOf, latencyProxy, removeFixture, through } from "./benchmark-notes-fixture";

const arg = (name: string, fallback: string) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] ?? fallback : fallback; };
const RTTS = arg("rtt", "2,20,60").split(",").map(Number);
const TURNS = Number(arg("turns", "12"));
const OUT = arg("out", "");
// The app's connection pool (DB_POOL_MAX), 10 by default as in production. Drizzle's queries are never prepared, so
// postgres.js describes each bound query before running it: two round trips per query, one query at a time per connection.
const POOL = arg("pool", "10");
process.env.DB_POOL_MAX = POOL;
// The model's own timings, from agent.model_invocations on the dev database (talk first output p50 ≈ 1.08 s). They are
// constants here so the comparison isolates LearnSpace's own work; shortened so a run stays quick.
const MODEL_FIRST_MS = 300;
const TOKEN_MS = 12;
const SCRIBE_FIRST_MS = 400;
const SCRIBE_CHUNK_MS = 25;
const usage = { inputTokens: 6_000, cachedTokens: 5_000, cacheWriteTokens: 0, outputTokens: 60, reasoningTokens: 0, fast: true };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const REPLY = ["Right", " —", " a", " big", " step", " jumps", " past", " the", " minimum", ".", " What", " do", " you", " think", " happens", " to", " the", " loss", " then", "?"];

const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? NaN; };
const summary = (values: number[]) => ({ p50: Math.round(percentile(values, 0.5)), p90: Math.round(percentile(values, 0.9)), mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length) });

async function main() {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  const appUrl = process.env.DATABASE_URL;
  const authUrl = process.env.DATABASE_AUTH_URL;
  if (!migratorUrl || !appUrl || !authUrl) throw new Error("DATABASE_MIGRATOR_URL, DATABASE_URL and DATABASE_AUTH_URL are required (the local database)");
  const target = new URL(appUrl);
  if (!/^(localhost|127\.0\.0\.1)$/.test(target.hostname)) throw new Error("Benchmarks run against the local database only.");
  const results: Record<string, unknown> = { measuredAt: new Date().toISOString(), turns: TURNS, pool: Number(POOL), model: { firstOutputMs: MODEL_FIRST_MS, tokenMs: TOKEN_MS, scribeFirstMs: SCRIBE_FIRST_MS, scribeChunkMs: SCRIBE_CHUNK_MS }, byRtt: {} };
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const lesson = await createLesson(migrator);
  const users: string[] = [];
  const [{ closeDb }, notes, modules] = await Promise.all([import("@learnspace/db"), import("../lib/notes/service"), appModules()]);
  const gate = gateOf(modules);
  try {
    // A learner and session per round trip, made directly, so each run starts with fresh rate-limit counters.
    const learners: { userId: string; sessionId: string; token: string }[] = [];
    for (const _rtt of RTTS) {
      const learner = await createLearner(migrator, modules, lesson);
      users.push(learner.userId);
      learners.push(learner);
    }
    await closeDb();
    for (const [index, rtt] of RTTS.entries()) {
      const app = await latencyProxy({ host: "127.0.0.1", port: Number(target.port || 5432) }, rtt);
      const auth = await latencyProxy({ host: "127.0.0.1", port: Number(new URL(authUrl).port || 5432) }, rtt);
      process.env.DATABASE_URL = through(appUrl, app.port);
      process.env.DATABASE_AUTH_URL = through(authUrl, auth.port);
      const { sessionId, token } = learners[index] as { userId: string; sessionId: string; token: string };
      const user = { id: (learners[index] as { userId: string }).userId };

      const voice = { gateMs: [] as number[], requestToModelMs: [] as number[], toModelMs: [] as number[], toFirstWordsMs: [] as number[], toLastWordsMs: [] as number[], toDoneMs: [] as number[] };
      for (let turn = -1; turn < TURNS; turn++) {
        let calledAt = 0;
        const model: TutorModel = async (_request, { onText, onFirstOutput }) => {
          calledAt = performance.now();
          await sleep(MODEL_FIRST_MS);
          onFirstOutput?.();
          let text = "";
          for (const piece of REPLY) { text += piece; onText?.(text); await sleep(TOKEN_MS); }
          return { text, refusal: null, usage, firstOutputMs: MODEL_FIRST_MS, latencyMs: MODEL_FIRST_MS + REPLY.length * TOKEN_MS };
        };
        const gated = performance.now();
        await gate(token);
        const started = performance.now();
        let firstWords = 0;
        let lastWords = 0;
        let said = "";
        const emit = (event: VoiceTurnEvent) => {
          const now = performance.now();
          if (event.type === "say") { said += event.text; if (!firstWords) firstWords = now; }
          // Her last sentence goes to the voice once the reply is known to be over: on the final say if the server sends one, else on done.
          if ((event.type === "say" && event.final) || (event.type === "done" && !lastWords)) lastWords = now;
        };
        await notes.runVoiceTurn(user.id, sessionId, { utterance: `Why does a large learning rate overshoot? (${turn})`, positionMs: 600_000 + turn * 5_000, playing: false, frame: null, watchedFromMs: null }, { signal: new AbortController().signal, emit, model });
        const done = performance.now();
        if (!said.includes("minimum")) throw new Error("the reply was not streamed");
        if (turn < 0) continue; // The first turn warms the connections.
        voice.gateMs.push(started - gated);
        voice.requestToModelMs.push(calledAt - gated);
        voice.toModelMs.push(calledAt - started);
        voice.toFirstWordsMs.push(firstWords - started);
        voice.toLastWordsMs.push(lastWords - started);
        voice.toDoneMs.push(done - started);
      }

      const scribe = { gateMs: [] as number[], requestToModelMs: [] as number[], toFirstEditMs: [] as number[], toSavedMs: [] as number[], toModelMs: [] as number[] };
      const SCRIBE_PASSES = Math.max(4, Math.round(TURNS / 2));
      for (let pass = -1; pass < SCRIBE_PASSES; pass++) {
        const ops: NoteOp[] = Array.from({ length: 4 }, (_, index) => ({ action: "insert", id: `p${pass + 1}o${index}`, after: null, type: index ? "bullet" : "heading", text: `Pass ${pass} note ${index}: a learning rate that is too large overshoots the minimum, so the loss can grow.`, done: null }));
        const json = JSON.stringify({ ops });
        let calledAt = 0;
        const model: TutorModel = async (_request, { onText, onFirstOutput }) => {
          calledAt = performance.now();
          await sleep(SCRIBE_FIRST_MS);
          onFirstOutput?.();
          // About 16 characters (four tokens) at a time.
          for (let at = 16; at < json.length + 16; at += 16) { onText?.(json.slice(0, at)); await sleep(SCRIBE_CHUNK_MS); }
          return { text: json, refusal: null, usage, firstOutputMs: SCRIBE_FIRST_MS, latencyMs: SCRIBE_FIRST_MS };
        };
        const gated = performance.now();
        await gate(token);
        const started = performance.now();
        let firstEdit = 0;
        const view = await notes.runScribe(user.id, sessionId, { signal: new AbortController().signal, model, onOp: () => { if (!firstEdit) firstEdit = performance.now(); } } as never);
        const saved = performance.now();
        if (!view.blocks.some((block) => block.id === `p${pass + 1}o3`)) throw new Error("the scribe's edits were not saved");
        if (pass < 0) continue;
        scribe.gateMs.push(started - gated);
        scribe.requestToModelMs.push(calledAt - gated);
        scribe.toModelMs.push(calledAt - started);
        scribe.toFirstEditMs.push((firstEdit || saved) - started);
        scribe.toSavedMs.push(saved - started);
      }
      (results.byRtt as Record<string, unknown>)[`${rtt}ms`] = {
        voice: Object.fromEntries(Object.entries(voice).map(([key, values]) => [key, summary(values)])),
        scribe: Object.fromEntries(Object.entries(scribe).map(([key, values]) => [key, summary(values)])),
      };
      console.log(`rtt ${rtt} ms`, JSON.stringify((results.byRtt as Record<string, unknown>)[`${rtt}ms`]));
      await closeDb();
      app.close(); auth.close();
    }
  } finally {
    await removeFixture(migrator, lesson, users);
    await migrator.end({ timeout: 5 });
  }
  if (OUT) writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
  process.exit(0);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });

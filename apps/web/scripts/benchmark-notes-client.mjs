#!/usr/bin/env node
/**
 * Client-side latency of the Notes session, in headless Chromium, with the app's real on-device models (served from the
 * local transformers.js cache, so nothing is downloaded and every run sees the same files):
 *
 *  - voice: Luny's real hook (useLunaVoice) hears spoken sentences played into a fake microphone, writes them down,
 *    and answers through a stand-in server that replies at once; it reports, per turn, from the learner's last word:
 *    their words written down (heardMs), Luny's first words back (firstWordsMs) and her first sound (firstAudioMs).
 *    Two replies: "multi" (two sentences) and "single" (one sentence, which is only spoken once the reply is known to be over).
 *  - editor: the notes editor with 120 blocks (formulas, bold, timestamps) takes ten scribe passes; reports the main
 *    thread's busy time per pass (Chrome's TaskDuration) and how many of the page's block elements were rebuilt.
 *
 *   node scripts/benchmark-notes-client.mjs [--turns 6] [--only voice|editor] [--scenarios multi,single] [--reply-delay 1250] [--out file.json]
 *
 * --reply-delay <ms> holds Luny's reply back that long, standing in for the server and the tutor model.
 * --server real measures the whole path instead: each turn goes through the app's own sign-in check and voice turn against
 * the local database (DATABASE_URL, DATABASE_AUTH_URL, DATABASE_MIGRATOR_URL) with --rtt <ms> added to every round trip,
 * and a stand-in tutor model (--model-first <ms> to its first output, then a token every 15 ms). Run it with tsx:
 *   pnpm exec tsx --tsconfig tsconfig.test.json scripts/benchmark-notes-client.mjs --server real --rtt 20 --scenarios multi
 * BENCH_DEBUG=1 prints the page's console; BENCH_CHROME_FLAGS passes extra Chromium flags (e.g. "--js-flags=…").
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const esbuild = require(path.resolve(app, "../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild"));
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] ?? fallback : fallback; };
const TURNS = Number(arg("turns", "6"));
const ONLY = arg("only", "");
const OUT = arg("out", "");
const MODELS = path.join(app, "node_modules/@huggingface/transformers/.cache");
const ORT = path.join(app, "node_modules/onnxruntime-web/dist");
const work = path.join(app, "test-results/benchmark-notes-client");
mkdirSync(work, { recursive: true });

// What the learner says, one sentence per turn, each followed by enough quiet for Luny to answer in full.
const SENTENCES = [
  "I think a really big learning rate makes every step overshoot the minimum.",
  "Why does momentum help when the valley is long and narrow?",
  "So the gradient tells me the direction, and the rate tells me the size.",
];
/** Chrome plays the file once from when the microphone opens; the sentences said while the models load are not heard. */
function speechWav() {
  const file = path.join(work, `speech-${TURNS}.wav`);
  if (existsSync(file)) return file;
  const parts = [];
  SENTENCES.forEach((sentence, index) => {
    const raw = path.join(work, `s${index}.wav`);
    execFileSync("espeak-ng", ["-v", "en-us", "-s", "160", "-w", raw, sentence]);
  });
  for (let turn = 0; turn < TURNS + 3; turn++) parts.push(path.join(work, `s${turn % SENTENCES.length}.wav`));
  // 1.5 s of quiet, then each sentence followed by 9 s of quiet; 48 kHz mono, as a microphone delivers it.
  const inputs = parts.flatMap((part) => ["-i", part]);
  const filter = `${parts.map((_, index) => `[${index}:a]aresample=48000,apad=pad_dur=9[a${index}]`).join(";")};aevalsrc=0:d=1.5:s=48000[lead];[lead]${parts.map((_, index) => `[a${index}]`).join("")}concat=n=${parts.length + 1}:v=0:a=1[out]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", file]);
  return file;
}

const build = (entry) => esbuild.build({
  entryPoints: [entry], bundle: true, write: false, format: "esm", jsx: "automatic", platform: "browser", target: "chrome120", minify: true,
  define: { "process.env.NODE_ENV": '"production"' }, loader: { ".woff": "empty", ".woff2": "empty", ".ttf": "empty" },
  outdir: work, logLevel: "error",
});

// A reply streamed as the voice route streams it; a final empty say marks the reply complete, `done` follows once it is saved.
const REPLIES = {
  multi: ["Right", " —", " a", " big", " step", " jumps", " past", " the", " minimum", ".", " What", " do", " you", " think", " happens", " to", " the", " loss", "?"],
  single: ["Exactly", ",", " the", " steps", " get", " too", " big", " to", " settle", "."],
};
const SAVE_MS = 250;
// How long the server and the tutor model take before Luny's first words (0: instantly). With a realistic wait, her voice
// starts once the listener's threads have gone quiet, as it does in use; with none, the two contend for cores.
const REPLY_DELAY_MS = Number(arg("reply-delay", "0"));
const SERVER = arg("server", "mock");
const RTT_MS = Number(arg("rtt", "20"));
const MODEL_FIRST_MS = Number(arg("model-first", "1080"));
const TOKEN_MS = 15;
/** The app's own server side, in `--server real` mode. */
let backend = null;
const heard = [];

async function serve() {
  const harness = await build(path.join(here, "benchmark-notes-client/harness.tsx"));
  const files = Object.fromEntries(harness.outputFiles.map((file) => [`/${path.basename(file.path)}`, file.contents]));
  const workers = new Map();
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", "Cache-Control": "no-store" };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(200, { ...headers, "Content-Type": "text/html" });
      response.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"><script>window.__bench=${JSON.stringify({ scenario: url.searchParams.get("scenario") })}</script><div id="root"></div><script type="module" src="/harness.js"></script>`);
      return;
    }
    const worker = /^\/voice\/([a-z]+\.worker)\.ts$/.exec(url.pathname);
    if (worker) {
      if (!workers.has(worker[1])) workers.set(worker[1], build(path.join(app, `components/study/voice/${worker[1]}.ts`)).then((result) => result.outputFiles.find((file) => file.path.endsWith(".js")).contents));
      response.writeHead(200, { ...headers, "Content-Type": "text/javascript" });
      response.end(await workers.get(worker[1]));
      return;
    }
    const voice = /^\/api\/v1\/study-sessions\/([a-z]+)\/voice$/.exec(url.pathname);
    if (voice && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { utterance } = JSON.parse(body);
      response.writeHead(200, { ...headers, "Content-Type": "application/x-ndjson" });
      // Luny opens with nothing to say, so her greeting never talks over the first sentence.
      if (utterance) {
        heard.push(utterance);
        if (backend) {
          try {
            await backend.turn(voice[1], JSON.parse(body), (line) => response.write(line));
          } catch (error) {
            console.error("the voice turn failed", error);
            response.write(`${JSON.stringify({ type: "error", message: "bench" })}\n`);
          }
          response.end();
          return;
        }
        if (REPLY_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, REPLY_DELAY_MS));
        for (const piece of REPLIES[voice[1]] ?? REPLIES.multi) response.write(`${JSON.stringify({ type: "say", text: piece })}\n`);
        response.write(`${JSON.stringify({ type: "say", text: "", final: true })}\n`);
        await new Promise((resolve) => setTimeout(resolve, SAVE_MS));
      }
      response.end(`${JSON.stringify({ type: "done" })}\n`);
      return;
    }
    // Model files and ONNX Runtime's WASM, from the local copies (redirected here by routeModels).
    const local = url.pathname.startsWith("/models/") ? path.join(MODELS, decodeURIComponent(url.pathname.slice(8))) : url.pathname.startsWith("/ort/") ? path.join(ORT, path.basename(url.pathname)) : null;
    if (local?.startsWith(url.pathname.startsWith("/models/") ? MODELS : ORT) && existsSync(local) && statSync(local).isFile()) {
      response.writeHead(200, { ...headers, "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "Content-Length": statSync(local).size, "Content-Type": local.endsWith(".wasm") ? "application/wasm" : local.endsWith(".mjs") ? "text/javascript" : "application/octet-stream" });
      createReadStream(local).pipe(response);
      return;
    }
    const file = files[url.pathname];
    if (file) {
      response.writeHead(200, { ...headers, "Content-Type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" });
      response.end(file);
      return;
    }
    response.writeHead(404, headers);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Model files and ONNX Runtime's WASM come from the local copies, as the browser cache would serve them: requests for
 * them are redirected to the harness server (fulfilling hundreds of megabytes through the DevTools pipe overflows it).
 * A file not in the local cache (Supertonic's voice) is fetched as usual.
 */
async function routeModels(context, origin) {
  const cors = { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" };
  await context.route(/^https:\/\/huggingface\.co\//, async (route) => {
    const match = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/.exec(route.request().url());
    const local = match ? path.join(MODELS, match[1], match[2]) : null;
    if (local && existsSync(local) && statSync(local).isFile()) return route.fulfill({ status: 302, headers: { ...cors, Location: `${origin}/models/${match[1]}/${match[2]}` } });
    return route.continue();
  });
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@[^/]+\/dist\//, (route) => route.fulfill({ status: 302, headers: { ...cors, Location: `${origin}/ort/${path.basename(new URL(route.request().url()).pathname)}` } }));
}

const percentile = (values, p) => { const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : null; };
const summary = (values) => ({ p50: percentile(values, 0.5), p90: percentile(values, 0.9), n: values.filter((value) => typeof value === "number").length });

async function voiceRun(browser, origin, scenario) {
  heard.length = 0;
  const context = await browser.newContext();
  await routeModels(context, origin);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error" || process.env.BENCH_DEBUG) console.warn(`${scenario}:`, message.text()); });
  page.on("crash", () => console.warn(`${scenario}: the page crashed`));
  await page.goto(`${origin}/?scenario=${scenario}`);
  const loadStarted = Date.now();
  await page.waitForFunction(() => window.__voice, null, { timeout: 60_000 }).catch((error) => { throw new Error(`${scenario}: the page did not start (${errors.join("; ")})`, { cause: error }); });
  await page.evaluate(() => window.__voice.start());
  await page.waitForFunction(() => ["listening", "thinking", "speaking"].includes(document.getElementById("state")?.textContent ?? ""), null, { timeout: 300_000 });
  const loadMs = Date.now() - loadStarted;
  await page.waitForFunction((turns) => (window.__lunyTimings ?? []).filter((timing) => timing.firstAudioMs !== null).length >= turns, TURNS, { timeout: 120_000 + (TURNS + 3) * 15_000, polling: 500 });
  const timings = await page.evaluate(() => window.__lunyTimings);
  await context.close();
  if (errors.length) console.warn(`${scenario}: page errors`, errors);
  return { loadMs, timings, heard: [...heard], summary: { heardMs: summary(timings.map((t) => t.heardMs)), firstWordsMs: summary(timings.map((t) => t.firstWordsMs)), firstAudioMs: summary(timings.map((t) => t.firstAudioMs)) } };
}

async function editorRun(browser, origin) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/?scenario=editor`);
  await page.waitForFunction(() => window.__editor && document.querySelectorAll(".notes-page > *").length >= 120);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const busy = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value])).TaskDuration;
  // Every block element the page shows is watched; a pass that rebuilds one removes it.
  await page.evaluate(() => {
    window.__rebuilt = 0;
    new MutationObserver((records) => { for (const record of records) for (const node of record.removedNodes) if (node instanceof HTMLElement && node.parentElement === null && record.target.classList?.contains("notes-page")) window.__rebuilt++; })
      .observe(document.querySelector(".notes-page"), { childList: true });
  });
  const passes = [];
  for (let pass = 0; pass < 10; pass++) {
    await page.waitForTimeout(150);
    const before = await busy();
    const rebuiltBefore = await page.evaluate(() => window.__rebuilt);
    await page.evaluate(() => new Promise((resolve) => { window.__editor.scribe(3); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))); }));
    await page.waitForTimeout(100);
    passes.push({ busyMs: Math.round(((await busy()) - before) * 1_000 * 10) / 10, rebuiltBlocks: (await page.evaluate(() => window.__rebuilt)) - rebuiltBefore });
  }
  const blocks = await page.evaluate(() => window.__editor.blocks());
  await context.close();
  return { blocks, passes, summary: { busyMs: summary(passes.map((pass) => pass.busyMs)), rebuiltBlocks: summary(passes.map((pass) => pass.rebuiltBlocks)) } };
}

const wav = speechWav();
if (SERVER === "real") backend = await (await import("./benchmark-notes-backend.ts")).startBackend({ rttMs: RTT_MS, replies: REPLIES, firstOutputMs: MODEL_FIRST_MS, tokenMs: TOKEN_MS });
const { server, origin } = await serve();
// A browser per run: the fake microphone plays its file once per browser, so a second run would start near its end.
const launch = () => chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required", "--mute-audio", ...(process.env.BENCH_CHROME_FLAGS ?? "").split(" ").filter(Boolean)],
});
const results = { measuredAt: new Date().toISOString(), turns: TURNS, cpus: (await import("node:os")).cpus().length, server: SERVER === "real" ? { rttMs: RTT_MS, modelFirstOutputMs: MODEL_FIRST_MS, tokenMs: TOKEN_MS } : { replyDelayMs: REPLY_DELAY_MS } };
const run = async (task) => { const browser = await launch(); results.chromium = browser.version(); try { return await task(browser); } finally { await browser.close(); } };
try {
  if (ONLY !== "editor") for (const scenario of arg("scenarios", "multi,single").split(",")) { results[`voice-${scenario}`] = await run((browser) => voiceRun(browser, origin, scenario)); console.log(scenario, JSON.stringify(results[`voice-${scenario}`].summary), results[`voice-${scenario}`].heard); }
  if (ONLY !== "voice") { results.editor = await run((browser) => editorRun(browser, origin)); console.log("editor", JSON.stringify(results.editor.summary)); }
} finally {
  server.close();
  await backend?.close();
}
if (OUT) writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
process.exit(0);

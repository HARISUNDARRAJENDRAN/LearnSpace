import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { summary, successfulTurns } from "./stats.mjs";

const phase = process.argv[2];
assert(["baseline", "final"].includes(phase));
const directory = process.argv[3] ?? "/tmp/learnspace-perf";
const output = path.resolve(import.meta.dirname, `../../../../docs/benchmarks/perf/${phase}.json`);
const result = JSON.parse(readFileSync(output, "utf8"));
result.supplementary = {};
for (const name of ["read", "reader", "source", "tutor", "panels", "memory", "editor", "voice-video", "voice-paper", "voice-client"]) {
  const file = path.join(directory, `${phase}-${name}.json`);
  if (existsSync(file)) result.supplementary[name] = JSON.parse(readFileSync(file, "utf8"));
  else result.limitations.push(`Missing supplementary ${name}`);
}
for (const flow of Object.values(result.supplementary.tutor?.flows ?? {})) for (const cache of ["cold", "warm"]) {
  const data = flow[cache];
  const successful = successfulTurns(data.samples);
  data.failedCount = data.samples.length - successful.length;
  data.summary = Object.fromEntries(["firstBlockMs", "totalMs"].map((key) => [key, summary(successful.map((sample) => sample[key]))]));
}
const search = path.join(directory, `${phase}-search.json`);
if (existsSync(search)) {
  const narrowed = JSON.parse(readFileSync(search, "utf8"));
  if (narrowed.environment.buildId === result.environment.buildId) result.search = narrowed.search;
}
for (const flow of Object.values(result.supplementary.source?.flows ?? {})) for (const cache of ["cold", "warm"]) {
  const data = flow[cache];
  data.failedCount = data.samples.filter((sample) => sample.status !== 200 || sample.responseStatus === "failed").length;
  data.usefulCount = data.samples.filter((sample) => sample.candidates > 0).length;
}
const voiceClient = result.supplementary["voice-client"]?.["voice-single"];
if (voiceClient) voiceClient.nearestRankSummary = Object.fromEntries(["heardMs", "firstWordsMs", "firstAudioMs"].map((key) => [key, summary(voiceClient.timings.map((sample) => sample[key]))]));
const editor = result.supplementary.editor?.editor;
if (editor) editor.nearestRank = Object.fromEntries(["cold", "warm"].map((cache) => [cache, summary((cache === "cold" ? editor.passes.slice(0, 1) : editor.passes.slice(1)).map((sample) => sample.busyMs))]));
const pilot = path.join(directory, `${phase}-editor-pilot.json`);
if (editor && existsSync(pilot)) result.supplementary.editor.firstAttempt = JSON.parse(readFileSync(pilot, "utf8"));
const recheck = path.join(directory, `${phase}-paper-recheck.json`);
if (existsSync(recheck)) result.supplementary["page-recheck"] = JSON.parse(readFileSync(recheck, "utf8"));
for (const name of ["panels-recheck", "editor-isolated", "editor-followup"]) {
  const file = path.join(directory, `${phase}-${name}.json`);
  if (existsSync(file)) result.supplementary[name] = JSON.parse(readFileSync(file, "utf8"));
}
const database = existsSync(path.join(directory, `${phase}-database.json`)) ? path.join(directory, `${phase}-database.json`) : path.join(directory, "database.json");
if (existsSync(database)) result.database = JSON.parse(readFileSync(database, "utf8"));
const tickHz = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const serverStats = (samples) => ({ rssBytes: summary(samples.map((s) => s.rssBytes)), maxRssBytes: samples.length ? Math.max(...samples.map((s) => s.rssBytes)) : null, cpuOneCorePercent: summary(samples.slice(1).map((s, i) => (s.cpuTicks - samples[i].cpuTicks) / tickHz / ((s.at - samples[i].at) / 1000) * 100)), tickHz });
result.serverSummary = serverStats(result.server);
if (result.supplementary.memory) result.supplementary.memory.serverSummary = serverStats(result.supplementary.memory.server);
result.limitations = [...new Set([...result.limitations,
  "Shared desktop and changing local data; no CPU, DB, OS-cache, or upstream-provider isolation.",
  "CWV is a short laboratory observation, not field INP or late-reader LCP.",
  "Resource Timing totals cover initial page observations; worker-internal and opaque cross-origin traffic can be omitted.",
  "Live tutor/audio sample sizes are small; provider errors and rate limits are retained separately.",
  "Ingestion timings are three stored worker observations, not controlled cold/warm trials.",
  "Memory uses natural GC and accumulating messages; the baseline memory trace uses the inherited production build.",
  "Physical-device voice, barge-in, production concurrency, and React Profiler commit timings were not measured.",
])];
result.assembledAt = new Date().toISOString();
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Assembled ${phase}: ${Object.keys(result.pages).length} pages, ${Object.keys(result.supplementary).length} supplementary reports`);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chromium, request } from "@playwright/test";
import { summary, successfulTurns } from "./stats.mjs";

const arg = (key, fallback) => process.argv.includes(`--${key}`) ? process.argv[process.argv.indexOf(`--${key}`) + 1] : fallback;
const baseURL = arg("url", "http://localhost:3100");
assert(["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname));
const phase = arg("phase", "baseline");
const only = arg("only", "read");
assert(["read", "source", "tutor", "panels", "reader"].includes(only));
const iterations = Number(arg("iterations", "10"));
assert(Number.isInteger(iterations) && iterations > 0);
const paperId = arg("paper", "e29b96ef-03f4-4f81-8479-9685bdc6d1c0");
const resourceId = arg("resource", "e5a565d3-380c-467b-8876-48b247628885");
const result = { phase, measuredAt: new Date().toISOString(), mode: "production", method: "Local production HTTP; connection/browser-cold then repeated warm request. DB/OS caches retained; model and source-provider settings unchanged.", flows: {}, limitations: [] };
const api = await request.newContext({ baseURL, timeout: 150_000 });
const login = await api.post("/api/auth/login", { data: { email: process.env.PERF_EMAIL ?? "research-ui@learnspace.local", password: process.env.PERF_PASSWORD ?? "research-ui-password-1" } });
assert.equal(login.status(), 200, "Login failed");
if (["reader", "panels"].includes(only)) assert.equal((await api.patch(`/api/v1/study-sessions/${paperId}/workspace`, { data: { panel: null } })).status(), 204);
const state = await api.storageState();
let browser;
const collect = (samples, keys) => ({ samples, summary: Object.fromEntries(keys.map((key) => [key, summary(samples.map((sample) => sample[key]))])) });
try {
  if (only === "read") {
    const paths = { "paper-content": `/api/v1/papers/${resourceId}/content`, "notes-load": `/api/v1/study-sessions/${paperId}/notes`, "session-data": `/api/v1/study-sessions/${paperId}`, "sidebar-sessions": "/api/v1/study-sessions" };
    for (const [name, route] of Object.entries(paths)) {
      const samples = { cold: [], warm: [] };
      for (let i = 0; i < iterations; i++) {
        const client = await request.newContext({ baseURL, storageState: state });
        for (const cache of ["cold", "warm"]) {
          const start = performance.now();
          const response = await client.get(route);
          const body = await response.body();
          assert.equal(response.status(), 200, `${route}: ${response.status()}`);
          samples[cache].push({ elapsedMs: performance.now() - start, bytes: body.length });
        }
        await client.dispose();
      }
      result.flows[name] = Object.fromEntries(Object.entries(samples).map(([cache, values]) => [cache, collect(values, ["elapsedMs", "bytes"])]));
    }
  }
  if (only === "source") {
    const samples = { cold: [], warm: [] };
    for (let i = 0; i < iterations; i++) {
      // Different useful queries avoid measuring a cached provider response as a cold lookup.
      const query = ["attention mechanisms in transformers", "Adam stochastic optimization", "energy based recurrent reasoning", "graph neural networks", "diffusion transformer models"][i % 5];
      for (const cache of ["cold", "warm"]) {
        const start = performance.now();
        const response = await api.post("/api/v1/source-discovery/search", { data: { mode: "research", query, correlationId: randomUUID() } });
        let body = await response.json();
        const responseMs = performance.now() - start;
        let firstResultsMs = body.candidates?.length ? responseMs : null;
        let polls = 0;
        while (body.status === "searching" && body.runId && polls++ < 20) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const poll = await api.get(`/api/v1/source-discovery/runs/${body.runId}`);
          if (!poll.ok()) break;
          body = await poll.json();
          if (body.candidates?.length && firstResultsMs === null) firstResultsMs = performance.now() - start;
        }
        samples[cache].push({ elapsedMs: performance.now() - start, responseMs, firstResultsMs, polls, status: response.status(), candidates: body.candidates?.length ?? 0, timings: body.timings, serverTiming: response.headers()["server-timing"], responseStatus: body.status, runId: body.runId, failures: body.partialFailures ?? body.failures ?? body.refreshError ?? body.error ?? null });
      }
    }
    result.flows["full-research-search"] = Object.fromEntries(Object.entries(samples).map(([cache, values]) => [cache, collect(values, ["elapsedMs", "responseMs", "firstResultsMs"])]));
  }
  if (only === "tutor") {
    const video = await api.post("/api/v1/study-sessions", { data: { resourceId: "7c8d9b63-3d3b-40b8-a755-bff1e48d2ac4", origin: "home", idempotencyKey: randomUUID() } });
    assert.equal(video.status(), 200);
    const videoId = (await video.json()).sessionId;
    result.videoSessionId = videoId;
    for (const [kind, id] of [["paper", paperId], ["video", videoId]]) {
      const samples = { cold: [], warm: [] };
      for (let i = 0; i < iterations; i++) for (const cache of ["cold", "warm"]) {
        const start = performance.now();
        const response = await fetch(`${baseURL}/api/v1/study-sessions/${id}/tutor`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: state.cookies.map(({ name, value }) => `${name}=${value}`).join("; ") }, body: JSON.stringify({ question: `Briefly explain the main idea in one paragraph. (${phase} ${i} ${cache})`, ...(kind === "paper" ? { anchor: { kind: "paper", page: 1 } } : { positionMs: 60_000 }), idempotencyKey: randomUUID() }), signal: AbortSignal.timeout(150_000) });
        const decoder = new TextDecoder();
        let firstBlockMs = null, messageStatus = null, bytes = 0, failure = null, buffer = "";
        if (response.ok && response.body) for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          buffer += decoder.decode(chunk, { stream: true });
          for (let end; (end = buffer.indexOf("\n")) >= 0;) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.message?.blocks?.length && firstBlockMs === null) firstBlockMs = performance.now() - start;
            if (event.type === "done") messageStatus = event.message.status;
            if (event.type === "error") failure = event;
          }
        } else failure = await response.text();
        samples[cache].push({ firstBlockMs, totalMs: performance.now() - start, status: response.status, messageStatus, bytes, failure });
      }
      result.flows[`tutor-${kind}`] = Object.fromEntries(Object.entries(samples).map(([cache, values]) => [cache, { ...collect(successfulTurns(values), ["firstBlockMs", "totalMs"]), samples: values, failedCount: values.length - successfulTurns(values).length }]));
    }
  }
  if (only === "reader") {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const samples = { cold: [], warm: [] };
    for (let i = 0; i < iterations; i++) {
      const ctx = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      for (const cache of ["cold", "warm"]) {
        const start = performance.now();
        await page.goto(`${baseURL}/app/study/paper/${paperId}`);
        let status = "timeout";
        await page.waitForFunction(() => document.querySelector(".paper-page .textLayer span") || document.querySelector('.paper-reader-state[role="alert"]'), null, { timeout: 20_000 }).then(async () => {
          status = await page.locator(".paper-page .textLayer span").count() ? "text-rendered" : "source-unavailable";
        }).catch(() => {});
        samples[cache].push({ elapsedMs: status === "text-rendered" ? performance.now() - start : null, status });
      }
      await ctx.close();
    }
    result.flows["paper-reader"] = Object.fromEntries(Object.entries(samples).map(([cache, values]) => [cache, collect(values, ["elapsedMs"])]));
  }
  if (only === "panels") {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const samples = { cold: [], warm: [] };
    for (let i = 0; i < iterations; i++) {
      const ctx = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const start = performance.now();
      await page.goto(`${baseURL}/app/study/paper/${paperId}?tool=canvas`);
      let reader = "unavailable", readerMs = null;
      await page.waitForFunction(() => document.querySelector(".paper-page canvas")?.width > 0 || document.querySelector('.paper-reader-state[role="alert"]'), null, { timeout: 20_000 }).then(async () => {
        reader = await page.locator(".paper-page canvas").count() ? "canvas-rendered" : "source-unavailable";
        if (reader === "canvas-rendered") readerMs = performance.now() - start;
      }).catch(() => result.limitations.push("PDF did not render within 20 seconds"));
      for (const cache of ["cold", "warm"]) for (const [label, selector] of [["Notes", ".notes-page"], ["AI", "#study-question"], ["Check", ".session-panel[data-view=check] .session-panel-bar"], ["Guide", ".session-panel[data-view=guide] .session-panel-bar"]]) {
        const started = performance.now();
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.locator(`${selector}:visible`).first().waitFor({ timeout: 30_000 });
        if (label === "Notes") {
          const notes = page.locator(".notes-page:visible").first();
          if (cache === "cold") await notes.evaluate((node) => { node.dataset.perfMounted = "yes"; });
          else assert.equal(await notes.getAttribute("data-perf-mounted"), "yes", "Hiding Notes must preserve the editor mount");
        }
        if (label === "AI" && cache === "warm" && await page.locator("#study-question").isEnabled()) assert.equal(await page.evaluate(() => document.activeElement?.id), "study-question", "Chat opener must preserve keyboard focus");
        samples[cache].push({ tool: label, elapsedMs: performance.now() - started, reader, readerMs, errors: [...errors] });
        if (i === 0 && cache === "cold") {
          await page.screenshot({ animations: "disabled", path: `/tmp/learnspace-perf/${phase}-panel-${label}-1440.png` });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(300);
          await page.screenshot({ animations: "disabled", path: `/tmp/learnspace-perf/${phase}-panel-${label}-390.png` });
          await page.setViewportSize({ width: 1440, height: 900 });
        }
        await page.getByRole("button", { name: label, exact: true }).click();
      }
      if (i === 0) {
        const code = page.getByRole("button", { name: "Code", exact: true });
        result.codeTool = { eligible: await code.count() > 0, opened: false };
        if (result.codeTool.eligible) {
          await code.click();
          await page.locator(".coding-workspace").waitFor();
          result.codeTool.opened = true;
        }
      }
      await ctx.close();
    }
    for (const label of ["Notes", "AI", "Check", "Guide"]) result.flows[`panel-${label}`] = Object.fromEntries(Object.entries(samples).map(([cache, values]) => [cache, collect(values.filter((v) => v.tool === label), ["elapsedMs", "readerMs"])]));
  }
} catch (error) {
  result.failure = String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await api.dispose();
  result.completedAt = new Date().toISOString();
  writeFileSync(arg("out", `/tmp/learnspace-perf/${phase}-${only}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ phase, only, failure: result.failure, flows: Object.fromEntries(Object.entries(result.flows).map(([name, flow]) => [name, Object.fromEntries(Object.entries(flow).map(([cache, data]) => [cache, data.summary]))])) }));
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request } from "@playwright/test";
import { summary } from "./stats.mjs";

const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const baseURL = arg("url", "http://localhost:3100");
assert(["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "Local benchmarks only");
const phase = arg("phase", "baseline");
const only = arg("only", "");
assert(["", "pages", "search", "memory"].includes(only));
const selectedRoutes = arg("routes", "").split(",").filter(Boolean);
assert(/^[a-z-]+$/.test(phase));
const iterations = Number(arg("iterations", "10"));
assert(Number.isInteger(iterations) && iterations > 0);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = arg("out", path.join(root, `docs/benchmarks/perf/${phase}.json`));
const scratch = arg("scratch", "/tmp/learnspace-perf");
mkdirSync(scratch, { recursive: true });
const paperId = arg("paper", "e29b96ef-03f4-4f81-8479-9685bdc6d1c0");
const api = await request.newContext({ baseURL });
const login = await api.post("/api/auth/login", { data: { email: process.env.PERF_EMAIL ?? "research-ui@learnspace.local", password: process.env.PERF_PASSWORD ?? "research-ui-password-1", next: "/app/research" } });
assert.equal(login.status(), 200, `Login failed: ${login.status()}`);
if (only !== "memory") {
  const reset = await api.patch(`/api/v1/study-sessions/${paperId}/workspace`, { data: { panel: null } });
  assert.equal(reset.status(), 204, "Reset benchmark view");
}
const storageState = await api.storageState();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const result = {
  measuredAt: new Date().toISOString(), phase, environment: { node: process.version, platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model, cpus: os.cpus().length, ramBytes: os.totalmem(), freeRamBytes: os.freemem(), chromium: browser.version(), mode: "production", buildId: readFileSync(path.join(root, "apps/web/.next-perf/BUILD_ID"), "utf8").trim(), head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), dirty: execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" }).trim().split("\n") },
  method: { iterations, cold: "fresh browser context (HTTP cache, CacheStorage and storage empty except authentication); server and Postgres caches NOT flushed", warm: "same context, immediate second navigation or repeated query; server and Postgres caches retained", viewport: { width: 1440, height: 900 }, observationMs: 600, inp: "Maximum Event Timing per interaction, 98th percentile across scripted interactions (durationThreshold 16); laboratory proxy, not field INP", p99: "null until n >= 100", units: "milliseconds except bytes/counts/CPU/heap" },
  pages: {}, search: {}, api: {}, server: [], limitations: [],
};
let timer;
const serverPid = Number(process.env.PERF_SERVER_PID);
if (serverPid) timer = setInterval(() => {
  try {
    const status = readFileSync(`/proc/${serverPid}/status`, "utf8");
    const fields = readFileSync(`/proc/${serverPid}/stat`, "utf8").split(") ")[1].split(" ");
    result.server.push({ at: Date.now(), rssBytes: Number(status.match(/VmRSS:\s+(\d+)/)?.[1]) * 1024, cpuTicks: Number(fields[11]) + Number(fields[12]) });
  } catch { /* Server shutdown is recorded by the missing sample. */ }
}, 1000);

async function context(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ storageState, viewport });
  await ctx.addInitScript(() => {
    const metrics = window.__perf = { lcp: null, cls: 0, interactions: {}, longTasks: [], errors: [] };
    let windowStart = 0, lastShift = 0, windowValue = 0;
    const observe = (type, callback, options = {}) => { try { new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({ type, buffered: true, ...options }); } catch {} };
    observe("largest-contentful-paint", (entry) => { metrics.lcp = entry.startTime; });
    observe("layout-shift", (entry) => {
      if (entry.hadRecentInput) return;
      if (entry.startTime - lastShift > 1000 || entry.startTime - windowStart > 5000) { windowValue = 0; windowStart = entry.startTime; }
      lastShift = entry.startTime;
      windowValue += entry.value;
      metrics.cls = Math.max(metrics.cls, windowValue);
    });
    observe("event", (entry) => { if (entry.interactionId) metrics.interactions[entry.interactionId] = Math.max(metrics.interactions[entry.interactionId] ?? 0, entry.duration); }, { durationThreshold: 16 });
    observe("longtask", (entry) => metrics.longTasks.push(entry.duration));
    window.addEventListener("error", (event) => metrics.errors.push(event.message));
  });
  return ctx;
}
async function pageSample(page, route) {
  const started = performance.now();
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "load", timeout: 60000 });
  assert.equal(response.status(), 200, `${route} HTTP error`);
  assert(new URL(page.url()).pathname.startsWith("/app"), `${route} redirected`);
  await page.locator("main").first().waitFor();
  const readyMs = performance.now() - started;
  await page.waitForTimeout(600);
  // A real keyboard interaction finalizes the initial LCP and supplies an INP observation.
  const search = page.getByRole("combobox", { name: "Search LearnSpace" });
  if (await search.count()) {
    await search.focus();
    await search.press("ArrowDown");
    await search.press("Escape");
  } else {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click({ timeout: 3000 }).catch(() => {});
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(100);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const interactions = Object.values(window.__perf.interactions).sort((a, b) => a - b);
    return { readyState: document.readyState, lcpMs: window.__perf.lcp, cls: window.__perf.cls, inpMs: interactions.length ? interactions[Math.min(interactions.length - 1, Math.floor(interactions.length * 0.98))] : null, interactionCount: interactions.length, ttfbMs: navigation.responseStart - navigation.startTime, transferBytes: navigation.transferSize + resources.reduce((n, r) => n + r.transferSize, 0), requestCount: resources.length + 1, jsDecodedBytes: resources.filter((r) => new URL(r.name).pathname.endsWith(".js")).reduce((n, r) => n + r.decodedBodySize, 0), jsUrls: resources.filter((r) => new URL(r.name).pathname.endsWith(".js")).map((r) => new URL(r.name).pathname), longTaskMs: window.__perf.longTasks.reduce((a, b) => a + b, 0), errors: window.__perf.errors, reader: document.querySelector(".paper-page canvas")?.width > 0 ? "canvas-present" : document.querySelector('.paper-reader-state[role="alert"]') ? "unavailable" : "not-ready" };
  });
  return { readyMs, ...metrics };
}
const summarize = (samples) => Object.fromEntries(["readyMs", "lcpMs", "cls", "inpMs", "ttfbMs", "transferBytes", "requestCount", "jsDecodedBytes", "longTaskMs"].map((key) => [key, summary(samples.map((s) => s[key]))]));
try {
  if (only === "memory") {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/app/study/paper/${paperId}`);
    await page.getByRole("button", { name: "AI", exact: true }).waitFor();
    await page.waitForTimeout(1000);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    result.memory = { durationSeconds: Number(arg("seconds", "600")), samples: [], actions: {}, errors: [] };
    let lastChat = -120_000;
    const started = performance.now();
    while (performance.now() - started < result.memory.durationSeconds * 1000) {
      for (const label of ["Notes", "AI", "Check", "Guide"]) {
        try { await page.getByRole("button", { name: label, exact: true }).click({ timeout: 2000 }); result.memory.actions[label] = (result.memory.actions[label] ?? 0) + 1; } catch (error) { result.memory.errors.push(error.message.split("\n")[0]); }
      }
      if (performance.now() - started - lastChat >= 120_000) {
        await page.getByRole("button", { name: "AI", exact: true }).click();
        const input = page.getByRole("combobox", { name: "Ask the tutor" });
        if (await input.isEnabled().catch(() => false)) {
          await input.fill("Briefly explain the main idea of this paper.");
          await input.press("Enter");
          result.memory.actions.chat = (result.memory.actions.chat ?? 0) + 1;
        }
        lastChat = performance.now() - started;
      }
      await page.locator(".paper-reader-scroll").first().evaluate((node) => { node.scrollTop = node.scrollTop > 500 ? 0 : 1000; }).catch(() => {});
      const metrics = (await cdp.send("Performance.getMetrics")).metrics;
      result.memory.samples.push({ elapsedMs: performance.now() - started, ...Object.fromEntries(metrics.filter((m) => ["JSHeapUsedSize", "JSHeapTotalSize", "Documents", "Nodes", "TaskDuration"].includes(m.name)).map((m) => [m.name, m.value])) });
      await page.waitForTimeout(5000);
    }
    await ctx.close();
  } else {
    const routes = [["research-home", "/app/research"], ["learn-home", "/app"], ["library-learn", "/app/library"], ["library-research", "/app/library?view=papers"], ["research-discover", "/app/research/discover"], ["paper-session", `/app/study/paper/${paperId}`]];
    const probe = await context();
    const p = await probe.newPage();
    await p.goto(`${baseURL}/app/research/discover`);
    const track = await p.locator('a[href^="/app/research/discover/"]').first().getAttribute("href").catch(() => null);
    if (track) routes.push(["research-track", track]);
    else result.limitations.push("No Research Discover track link found");
    await probe.close();
    for (const [name, route] of routes.filter(([name]) => (!only || only === "pages") && (!selectedRoutes.length || selectedRoutes.includes(name)))) {
      const samples = { cold: [], warm: [] };
      for (let i = 0; i < iterations; i++) {
        const ctx = await context();
        const page = await ctx.newPage();
        for (const cache of ["cold", "warm"]) samples[cache].push(await pageSample(page, route));
        if (i === 0) {
          await page.screenshot({ path: `${scratch}/${phase}-${name}-1440.png` });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${scratch}/${phase}-${name}-390.png` });
        }
        await ctx.close();
      }
      result.pages[name] = { route, ...Object.fromEntries(Object.entries(samples).map(([cache, values]) => [cache, { summary: summarize(values), samples: values }])) };
      console.log(name, JSON.stringify(result.pages[name].cold.summary.readyMs));
    }
    for (const mode of (!only || only === "search") ? ["learn", "research"] : []) {
      const values = { cold: [], warm: [] };
      for (let i = 0; i < iterations; i++) {
        const ctx = await context();
        const page = await ctx.newPage();
        await page.goto(`${baseURL}${mode === "research" ? "/app/research" : "/app"}`);
        const input = page.getByRole("combobox", { name: "Search LearnSpace" });
        for (const cache of ["cold", "warm"]) {
          await input.fill("");
          const started = performance.now();
          const response = page.waitForResponse((r) => r.url().includes(`/api/v1/search?mode=${mode}`));
          await input.fill(mode === "research" ? "attention" : "python");
          const r = await response;
          assert.equal(r.status(), 200);
          const payload = await r.json();
          await page.waitForFunction(() => !document.querySelector('[aria-label="Searching"]'));
          if (payload.results?.length) await page.getByRole("option").filter({ hasText: payload.results[0].title }).first().waitFor();
          values[cache].push({ elapsedMs: performance.now() - started, resultCount: payload.results?.length ?? 0 });
        }
        await ctx.close();
      }
      result.search[mode] = Object.fromEntries(Object.entries(values).map(([cache, samples]) => [cache, { summary: summary(samples.map((s) => s.elapsedMs)), samples }]));
    }
    const files = readdirSync(path.join(root, "apps/web/.next-perf/static/chunks")).filter((f) => f.endsWith(".js"));
    result.bundle = { totalJsBytes: files.reduce((n, file) => n + statSync(path.join(root, "apps/web/.next-perf/static/chunks", file)).size, 0), perRoute: Object.fromEntries(Object.entries(result.pages).map(([name, page]) => [name, { initialJsBytes: page.cold.samples[0].jsUrls.filter((url) => url.startsWith("/_next/")).reduce((n, url) => n + statSync(path.join(root, "apps/web/.next-perf", url.replace("/_next/", ""))).size, 0), chunks: page.cold.samples[0].jsUrls }])) };
  }
} catch (error) {
  result.failure = String(error);
  throw error;
} finally {
  clearInterval(timer);
  result.completedAt = new Date().toISOString();
  await browser.close();
  await api.dispose();
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

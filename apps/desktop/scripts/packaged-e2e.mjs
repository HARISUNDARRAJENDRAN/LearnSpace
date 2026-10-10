// Packaged desktop feature-parity E2E.
//
// Playwright's _electron driver requires the Node inspector, which the
// packaged binary disables via the EnableNodeCliInspectArguments fuse
// (by design). The Chromium remote-debugging port is a separate switch,
// unaffected by that fuse, so this harness drives the packaged window
// over CDP instead: register -> desktop-exposed verification link ->
// authenticated onboarding -> fresh-context password login -> clean exit.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(packageRoot, "dist-release", "linux-unpacked", "LearnSpace");
const appPort = process.env.LEARNSPACE_DESKTOP_PORT ?? "3203";
const cdpPort = process.env.LEARNSPACE_E2E_CDP_PORT ?? "9333";
const origin = `http://127.0.0.1:${appPort}`;
const shotDir =
  process.env.LEARNSPACE_E2E_SCREENSHOT_DIR ?? "/tmp/learnspace-desktop-e2e";
await mkdir(shotDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

const child = spawn(binary, [`--remote-debugging-port=${cdpPort}`], {
  env: { ...process.env, LEARNSPACE_DESKTOP_PORT: appPort },
  stdio: "ignore",
});

let exitCode = null;
child.on("exit", (code) => {
  exitCode = code;
});

let browser;
const email = `desktop-e2e-${Date.now()}@learnspace.local`;
const password = "packaged-parity-1";

try {
  await waitForHttp(`${origin}/api/health`);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  const page =
    context.pages().find((candidate) => candidate.url().includes(origin)) ??
    (await context.waitForEvent("page"));
  await page.waitForURL(new RegExp(origin.replace(/[./]/g, "\\$&")), {
    timeout: 60_000,
  });

  // Previous QA runs persist the session cookie in Electron's userData, so
  // clear it before the register flow or /register redirects to /onboarding.
  await context.clearCookies();
  await page.goto(`${origin}/register`);
  await page.locator("#display-name").waitFor({ timeout: 30_000 });
  await page.fill("#display-name", "Packaged E2E");
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", password);
  await page.fill("#confirm-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/verify-email/, { timeout: 30_000 });

  const devLink = page.locator("a.development-link");
  await devLink.waitFor({ timeout: 15_000 });
  assert.match(
    await devLink.getAttribute("href"),
    /\/api\/auth\/verify\?/,
    "desktop runtime should expose the verification link",
  );
  await page.screenshot({ path: path.join(shotDir, "01-verify-email.png") });
  await devLink.click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    return await response.json();
  });
  assert.equal(session.authenticated, true, "verify link should establish a session");
  await page.screenshot({ path: path.join(shotDir, "02-onboarding.png") });

  // Electron's CDP endpoint rejects Target.createBrowserContext, so the
  // second login pass clears cookies in the existing context instead of
  // opening a fresh one.
  await context.clearCookies();
  await page.goto(`${origin}/login`);
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  const loginSession = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    return await response.json();
  });
  assert.equal(loginSession.authenticated, true, "password login should establish a session");
  await page.screenshot({ path: path.join(shotDir, "03-login.png") });

  console.log(
    JSON.stringify(
      { ok: true, email, origin, screenshots: shotDir },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
}

const exitDeadline = Date.now() + 10_000;
while (exitCode === null && Date.now() < exitDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.notEqual(exitCode, null, "app must exit on SIGTERM");

let healthAfter = "error";
try {
  const response = await fetch(`${origin}/api/health`, {
    signal: AbortSignal.timeout(2_000),
  });
  healthAfter = String(response.status);
} catch {
  healthAfter = "closed";
}
assert.equal(healthAfter, "closed", "runtime port must close after quit");

console.log(
  JSON.stringify({ ok: true, exitCode, runtimePort: healthAfter }, null, 2),
);

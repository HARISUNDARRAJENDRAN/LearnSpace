// Boots the desktop shell through Playwright's Electron driver, waits until
// the LearnSpace UI loads inside the BrowserWindow, captures a screenshot,
// and exits. Used as the manual-QA gate for the Stage 2 boot milestone.
// Set LEARNSPACE_SMOKE_PACKAGED=1 to launch the packaged binary instead of
// the dev electron (exercises the asar entry, fuses, and bundled runtime).
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = process.env.LEARNSPACE_SMOKE_SCREENSHOT ?? "/tmp/learnspace-desktop-smoke.png";

const packaged = process.env.LEARNSPACE_SMOKE_PACKAGED === "1";
const electronEntry = require.resolve("electron");
const executablePath = packaged
  ? path.join(packageRoot, "dist-release", "linux-unpacked", "LearnSpace")
  : path.join(path.dirname(electronEntry), "dist", "electron");
const args = packaged ? [] : [path.join(packageRoot, "dist", "main.js")];

const app = await electron.launch({
  executablePath,
  args,
  env: {
    ...process.env,
    LEARNSPACE_DESKTOP_PORT: process.env.LEARNSPACE_DESKTOP_PORT ?? "3177",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForURL(/127\.0\.0\.1/, { timeout: 180_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2_000);

  const url = page.url();
  const title = await page.title();
  const bodyText = (await page.locator("body").innerText()).slice(0, 400);
  await page.screenshot({ path: screenshotPath });

  const learnSpaceMarker = /learn\s*space/i.test(title) || /learn\s*space/i.test(bodyText);
  if (!learnSpaceMarker) {
    console.error("SMOKE FAIL: no LearnSpace marker in title or body text.");
    console.error(JSON.stringify({ url, title, bodyText }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, url, title, screenshotPath }, null, 2));
  }
} finally {
  await app.close();
}

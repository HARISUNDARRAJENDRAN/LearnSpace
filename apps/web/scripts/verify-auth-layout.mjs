import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [390, 1280, 1440]) {
    await page.setViewportSize({ width, height: 640 });
    for (const route of ["login", "register", "forgot-password", "reset-password", "verify-email"]) {
      const response = await page.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}/${route}`);
      assert.equal(response.status(), 200, route);
      await page.locator("#auth-title").waitFor();
      assert.equal(await page.locator(".auth-page-visual").isVisible(), width > 900);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}: horizontal overflow`);
      const home = await page.locator(".auth-page-home").boundingBox();
      const title = await page.locator("#auth-title").boundingBox();
      assert.ok(home && title && title.y >= home.y + home.height + 16, `${route}: heading overlaps Home at ${width}px`);
      const submit = page.locator('button[type="submit"]');
      await submit.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await expect(submit).toBeInViewport({ ratio: 1 });
    }
  }
  const crossOriginMutation = await page.request.post(
    `${process.env.BASE_URL ?? "http://localhost:3000"}/api/auth/login`,
    {
      headers: { origin: "https://attacker.example" },
      data: { email: "unused@example.test", password: "unused-password" },
    },
  );
  assert.equal(crossOriginMutation.status(), 403, "cross-origin state changes must be rejected");
  const invalidDesktopFlow = await page.request.post(
    `${process.env.BASE_URL ?? "http://localhost:3000"}/api/auth/desktop/not-a-uuid`,
    { data: { verifier: "invalid" } },
  );
  assert.equal(invalidDesktopFlow.status(), 403, "only the exact desktop handoff routes may omit Origin");
  assert.deepEqual(errors, []);
  console.log("All five auth layouts passed at mobile and desktop widths.");
} finally {
  await browser.close();
}

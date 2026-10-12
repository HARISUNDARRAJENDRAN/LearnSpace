import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch();
try {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const appOrigin = new URL(process.env.APP_URL ?? baseUrl).origin;
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const landing = await publicPage.goto(`${baseUrl}/`);
  assert.equal(landing.status(), 200, "the public landing page must remain browser-accessible");
  const browserLogin = await publicPage.goto(`${baseUrl}/login`);
  assert.equal(browserLogin.status(), 404, "ordinary browsers must not access the product UI");
  const browserApp = await publicPage.goto(`${baseUrl}/app`);
  assert.equal(browserApp.status(), 404, "ordinary browsers must not access the application routes");
  const publicOAuth = await publicPage.request.get(`${baseUrl}/api/auth/google`, { maxRedirects: 0 });
  assert.equal(publicOAuth.status(), 404, "ordinary browser auth routes must remain unavailable");
  const desktopOAuth = await publicPage.request.get(
    `${baseUrl}/api/auth/google?desktop_flow=00000000-0000-4000-8000-000000000001`,
    { maxRedirects: 0 },
  );
  assert.equal(desktopOAuth.status(), 307, "the system-browser desktop OAuth handoff must remain available");
  assert.equal(new URL(desktopOAuth.headers().location).origin, appOrigin);
  const oauthCallback = await publicPage.request.get(`${baseUrl}/api/auth/google/callback`, {
    maxRedirects: 0,
  });
  assert.equal(oauthCallback.status(), 307, "the system-browser OAuth callback must remain available");
  await publicContext.close();

  const desktopHeaders = { "x-learnspace-desktop": "1" };
  const context = await browser.newContext({
    reducedMotion: "reduce",
    extraHTTPHeaders: desktopHeaders,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [390, 1280, 1440]) {
    await page.setViewportSize({ width, height: 640 });
    for (const route of ["login", "register", "forgot-password", "reset-password", "verify-email"]) {
      const response = await page.goto(`${baseUrl}/${route}`);
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
  const desktopApp = await page.request.get(`${baseUrl}/app`, {
    maxRedirects: 0,
    headers: desktopHeaders,
  });
  assert.equal(desktopApp.status(), 307, "desktop app routes must redirect unauthenticated users to login");
  const desktopLogin = new URL(desktopApp.headers().location);
  assert.equal(desktopLogin.origin, appOrigin);
  assert.equal(desktopLogin.pathname, "/login");
  assert.equal(desktopLogin.searchParams.get("next"), "/app");

  const sameOriginMutation = await page.request.post(`${baseUrl}/api/auth/login`, {
    headers: { ...desktopHeaders, origin: appOrigin },
    data: {},
  });
  assert.equal(sameOriginMutation.status(), 400, "the canonical app origin must pass the CSRF guard");
  const crossOriginMutation = await page.request.post(
    `${baseUrl}/api/auth/login`,
    {
      headers: { ...desktopHeaders, origin: "https://attacker.example" },
      data: {},
    },
  );
  assert.equal(crossOriginMutation.status(), 403, "cross-origin state changes must be rejected");
  const invalidDesktopFlow = await page.request.post(
    `${baseUrl}/api/auth/desktop/not-a-uuid`,
    { headers: desktopHeaders, data: { verifier: "invalid" } },
  );
  assert.equal(invalidDesktopFlow.status(), 403, "only the exact desktop handoff routes may omit Origin");
  assert.deepEqual(errors, []);
  console.log("Browser gating, desktop auth surfaces, and all five auth layouts passed.");
} finally {
  await browser.close();
}

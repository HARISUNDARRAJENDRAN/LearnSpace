import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { createSession } from "../../lib/auth/repository";

const desktop = { width: 1440, height: 900 };
const tablet = { width: 1024, height: 768 };
const mobile = { width: 390, height: 844 };

async function stabilize(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      [data-reveal] {
        opacity: 1 !important;
        transform: none !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
}

test("landing hero visual regression", async ({ page }) => {
  for (const [name, viewport] of [
    ["desktop", desktop],
    ["tablet", tablet],
    ["mobile", mobile],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-testid=marketing-hero]")).toBeVisible();
    await stabilize(page);
    await expect(page.locator("[data-testid=marketing-hero]")).toHaveScreenshot(
      `landing-hero-${name}.png`,
      {
        animations: "disabled",
        caret: "hide",
        // Chromium can rasterize the large hero image a handful of pixels differently between hosts.
        maxDiffPixels: 32,
      },
    );
  }
});

test("login and register auth layouts visual regression", async ({ page }) => {
  for (const [route, name, viewport] of [
    ["/login", "login-desktop", desktop],
    ["/register", "register-tablet", tablet],
    ["/register", "register-mobile", mobile],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(route, { waitUntil: "networkidle" });
    await stabilize(page);
    await expect(page.locator(".auth-page")).toHaveScreenshot(`${name}.png`, {
      animations: "disabled",
      caret: "hide",
      // The thin desktop SVG paths rasterize a few pixels differently across CI hosts.
      maxDiffPixels: 256,
    });
  }
});

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;

test.describe("authenticated app shell visual regression", () => {
  test.skip(!databaseUrl, "requires the CI database environment");

  let database: ReturnType<typeof postgres> | undefined;
  let userId = "";
  let sessionToken = "";

  test.beforeAll(async () => {
    database = postgres(databaseUrl as string, { max: 1 });
    userId = randomUUID();
    const email = `visual-shell-${userId}@example.test`;
    await database`
      INSERT INTO identity.users (id, email, email_verified, status, display_name)
      VALUES (${userId}, ${email}, true, 'active', 'Visual Learner')
    `;
    await database`
      INSERT INTO identity.user_settings (user_id, onboarding_completed_at, onboarding_version)
      VALUES (${userId}, now(), 1)
    `;
    sessionToken = (
      await createSession(userId, { userAgent: "playwright-visual-regression" }, process.env.AUTH_SECRET ?? "")
    ).token;
  });

  test.afterAll(async () => {
    if (database && userId) {
      await database`DELETE FROM identity.users WHERE id = ${userId}`;
      await database.end({ timeout: 5 });
    }
  });

  test("authenticated shell visual regression", async ({ page }) => {
    await page.context().addCookies([
      {
        name: sessionCookieName,
        value: sessionToken,
        url: "http://localhost:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    for (const [name, viewport] of [
      ["desktop", desktop],
      ["tablet", tablet],
      ["mobile", mobile],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto("/app/settings", { waitUntil: "networkidle" });
      await stabilize(page);
      await expect(page.locator(".application-page")).toHaveScreenshot(`app-shell-${name}.png`, {
        animations: "disabled",
        caret: "hide",
        // Desktop text/icon rasterization can differ by a few pixels across CI hosts.
        maxDiffPixels: name === "desktop" ? 128 : 0,
      });
      if (name === "desktop") {
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        await expect(page.locator(".application-page")).toHaveScreenshot("app-shell-collapsed-desktop.png", {
          animations: "disabled",
          caret: "hide",
        });
      }
    }
  });

  test("source discovery modal visual regression", async ({ page }) => {
    await page.context().addCookies([
      {
        name: sessionCookieName,
        value: sessionToken,
        url: "http://localhost:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.setViewportSize({ width: 1365, height: 720 });
    await page.goto("/app", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start learning" }).click();
    await expect(page.getByRole("dialog", { name: "Learn any topic from the best videos" })).toBeVisible();
    await stabilize(page);
    await expect(page).toHaveScreenshot("source-discovery-learn-desktop.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 256,
    });
  });

});

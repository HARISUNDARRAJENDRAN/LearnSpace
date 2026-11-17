import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { createSession } from "../../lib/auth/repository";
import { cleanupHomeFixture, seedHomeFixture, type HomeFixture } from "./home-fixture";
import { cleanupResearchFixture, seedResearchFixture, tinyPaperPdf, type ResearchFixture } from "./research-fixture";
import { openTool } from "./study-tools";

const desktop = { width: 1440, height: 900 };
const laptop = { width: 1280, height: 800 };
const tablet = { width: 1024, height: 768 };
const narrow = { width: 768, height: 900 };
const mobile = { width: 390, height: 844 };
const databaseUrl = process.env.DATABASE_MIGRATOR_URL;

test.beforeEach(async ({ page }) => {
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ path: resolve(process.cwd(), "public/assets/learnspace-monogram.svg") }));
});

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
    // Reduced motion keeps the demo on its poster and, once hydrated, gives it the browser's own controls,
    // whose buffering bar varies run to run.
    await page.locator(".ls-demo-video video[controls]").evaluate((video: HTMLVideoElement) => {
      video.controls = false;
    });
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

test.describe("populated Home visual regression", () => {
  test.skip(!databaseUrl, "requires the CI database environment");

  let homeDatabase: ReturnType<typeof postgres> | undefined;
  let homeFixture: HomeFixture;

  test.beforeAll(async () => {
    homeDatabase = postgres(databaseUrl as string, { max: 1, prepare: false });
    homeFixture = await seedHomeFixture(homeDatabase);
  });

  test.afterAll(async () => {
    if (!homeDatabase || !homeFixture) return;
    await cleanupHomeFixture(homeDatabase, homeFixture);
    await homeDatabase.end({ timeout: 5 });
    homeDatabase = undefined;
  });

  test("populated Home dashboard at desktop, laptop, tablet, narrow, and mobile breakpoints", async ({ page }) => {
    await page.context().addCookies([{ name: sessionCookieName, value: homeFixture.sessionToken, url: "http://localhost:3100", httpOnly: true, sameSite: "Lax" }]);
    // The calendar draws the current week and a now-line, so pin the browser clock.
    await page.clock.setFixedTime(new Date("2026-11-04T10:30:00"));
    for (const [name, viewport] of [
      ["desktop", desktop],
      ["laptop", laptop],
      ["tablet", tablet],
      ["narrow", narrow],
      ["mobile", mobile],
    ] as const) {
      await page.setViewportSize(viewport);
      const observed = page.waitForResponse((response) => response.url().endsWith("/api/v1/plan/observe"));
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".home-page")).toBeVisible();
      await observed;
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await stabilize(page);
      await expect(page.locator(".application-main")).toHaveScreenshot(`home-populated-${name}.png`, {
        animations: "disabled",
        // Suggested times come from the server's real clock.
        mask: [page.locator(".home-next-item small")],
        caret: "hide",
        maxDiffPixels: 256,
      });
    }
  });
});

test.describe("Research visual regression", () => {
  test.skip(!databaseUrl, "requires the CI database environment");

  let researchDatabase: ReturnType<typeof postgres> | undefined;
  let researchFixture: ResearchFixture;

  test.beforeAll(async () => {
    researchDatabase = postgres(databaseUrl as string, { max: 1, prepare: false, connect_timeout: 10 });
    researchFixture = await seedResearchFixture(researchDatabase, true);
  });

  test.afterAll(async () => {
    if (!researchDatabase) return;
    try {
      if (researchFixture) await cleanupResearchFixture(researchDatabase, researchFixture);
    } finally {
      await researchDatabase.end({ timeout: 5 });
      researchDatabase = undefined;
    }
  });

  test("Research Home, Discover, paper chat, and Library papers at desktop, tablet, and mobile", async ({ page }) => {
    await page.context().addCookies([{ name: sessionCookieName, value: researchFixture.sessionToken, url: "http://localhost:3100", httpOnly: true, sameSite: "Lax" }]);
    await page.clock.setFixedTime(new Date("2026-11-04T10:30:00"));
    await page.route("**/api/v1/papers/*/pdf", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: tinyPaperPdf() }));

    await page.goto("/app/research");
    const search = page.getByRole("combobox", { name: "Search LearnSpace" });
    await search.fill("XGBoost");
    await page.getByRole("option").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" }).first().click();
    await expect(page).toHaveURL(/\/app\/study\/paper\/[0-9a-f-]+/);
    await expect(page.locator(".paper-reader-scroll")).toBeVisible();
    await page.getByLabel("Jump to section").selectOption({ label: "1. Introduction" });
    await page.waitForTimeout(4_300);
    await openTool(page, "AI");
    const panel = page.getByRole("complementary", { name: "Side panel" });
    await panel.getByLabel("Ask the tutor").fill("What does the regularized objective do?");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(panel.getByText(/balances prediction loss against a penalty for model complexity/)).toBeVisible();
    const paperSession = page.url();

    for (const [name, viewport] of [["desktop", desktop], ["tablet", tablet], ["mobile", mobile]] as const) {
      await page.setViewportSize(viewport);
      await page.goto("/app/research", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".research-page")).toBeVisible();
      await stabilize(page);
      await expect(page).toHaveScreenshot(`research-home-${name}.png`, {
        animations: "disabled",
        caret: "hide",
        mask: [page.locator(".research-feed .research-paper-row"), page.locator(".research-favorite-author"), page.locator(".application-profile-copy")],
        maskColor: "#f3f4f4",
        maxDiffPixels: 256,
      });

      await page.goto("/app/research/discover", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Read the papers that built the field/ })).toBeVisible();
      await stabilize(page);
      await expect(page).toHaveScreenshot(`research-discover-${name}.png`, {
        animations: "disabled",
        caret: "hide",
        mask: [page.locator(".discover-progress")],
        maskColor: "#e7eff0",
        maxDiffPixels: 256,
      });

      const sidebarIdentity = page.locator(".application-profile-copy");
      if (name === "mobile") {
        // On narrow screens the open chat replaces the reader, so capture both responsive states.
        await page.goto(paperSession, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("complementary", { name: "Side panel" })).toContainText("balances prediction loss against a penalty for model complexity");
        await stabilize(page);
        await expect(page).toHaveScreenshot("research-paper-chat-mobile.png", { animations: "disabled", caret: "hide", mask: [sidebarIdentity], maskColor: "#f3f4f4", maxDiffPixels: 256 });
        await page.getByRole("button", { name: "Collapse side panel" }).click();
        await expect(page.locator(".paper-reader-scroll")).toBeVisible();
        await stabilize(page);
        await expect(page).toHaveScreenshot("research-paper-reader-mobile.png", { animations: "disabled", caret: "hide", mask: [sidebarIdentity], maskColor: "#f3f4f4", maxDiffPixels: 256 });
      } else {
        await page.goto(paperSession, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".paper-reader-scroll")).toBeVisible();
        await expect(page.getByRole("complementary", { name: "Side panel" })).toContainText("balances prediction loss against a penalty for model complexity");
        await stabilize(page);
        await expect(page).toHaveScreenshot(`research-paper-chat-${name}.png`, { animations: "disabled", caret: "hide", mask: [sidebarIdentity], maskColor: "#f3f4f4", maxDiffPixels: 256,
        });
      }

      await page.goto("/app/library?view=papers", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".research-library")).toBeVisible();
      await expect(page.locator("article.research-paper-row").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" })).toBeVisible();
      await stabilize(page);
      await expect(page).toHaveScreenshot(`research-library-${name}.png`, { animations: "disabled", caret: "hide", mask: [sidebarIdentity], maskColor: "#f3f4f4", maxDiffPixels: 256 });

      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
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
      await database`
        DELETE FROM discovery.recommendation_impressions
        WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${userId})
      `;
      await database`
        DELETE FROM discovery.recommendation_candidates
        WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${userId})
      `;
      await database`DELETE FROM discovery.recommendation_runs WHERE user_id = ${userId}`;
      await database`DELETE FROM study.schedule_items WHERE user_id = ${userId}`;
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

    // Mark the first app visit before testing the Settings route that follows it.
    await page.goto("/app/discover", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".application-page")).toBeVisible();

    for (const [name, viewport] of [
      ["desktop", desktop],
      ["tablet", tablet],
      ["mobile", mobile],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto("/app/settings", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".application-page")).toBeVisible();
      await stabilize(page);
      await expect(page.locator(".application-page")).toHaveScreenshot(`app-shell-${name}.png`, {
        animations: "disabled",
        caret: "hide",
        mask: [page.locator(".application-profile-copy")],
        maskColor: "#f3f4f4",
        // The large desktop surface produces a small, repeatable font/icon rasterization delta on GitHub's Chromium host.
        maxDiffPixels: name === "desktop" ? 512 : 128,
      });
      if (name === "desktop") {
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        await expect(page.locator(".application-page")).toHaveScreenshot("app-shell-collapsed-desktop.png", {
          animations: "disabled",
          caret: "hide",
          // Keep the collapsed shell resilient to the same small CI rasterization drift.
          maxDiffPixels: 128,
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
    await page.goto("/app/discover", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".application-page")).toBeVisible();
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".application-page")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start learning" })).toBeVisible();
    await page.getByRole("banner").getByRole("button", { name: "Start learning" }).click();
    const dialog = page.getByRole("dialog", { name: "Learn any topic from the best videos" });
    await expect(dialog).toBeVisible();
    await stabilize(page);
    await expect(dialog).toHaveScreenshot("source-discovery-learn-desktop.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 256,
    });
  });

});

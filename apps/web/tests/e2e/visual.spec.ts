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
  let sourceResourceIds: string[] = [];
  let sourceYoutubeId = "";

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
    sourceResourceIds = Array.from({ length: 3 }, () => randomUUID());
    sourceYoutubeId = `v${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await database.begin(async (tx) => {
      for (const [index, resourceId] of sourceResourceIds.entries()) {
        const youtubeId = index === 0 ? sourceYoutubeId : `v${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        await tx`
          INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score)
          VALUES (${resourceId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${`Python generators lesson ${index + 1}`}, 'A deterministic catalog source for the source picker visual flow.', 'en', 'public', 'ready', 0.9)
        `;
        await tx`
          INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
          VALUES (${resourceId}, ${youtubeId}, ${`Visual source lab ${index + 1}`}, 600000, now())
        `;
      }
    });
    sessionToken = (
      await createSession(userId, { userAgent: "playwright-visual-regression" }, process.env.AUTH_SECRET ?? "")
    ).token;
  });

  test.afterAll(async () => {
    if (database && userId) {
      const runRows = await database<{ id: string }[]>`
        SELECT DISTINCT recommendation_run_id AS id
        FROM discovery.recommendation_candidates
        WHERE resource_id IN ${database(sourceResourceIds)}
      `;
      if (runRows.length > 0) {
        const runIds = runRows.map((row) => row.id);
        await database`DELETE FROM discovery.discovery_interactions WHERE impression_id IN (SELECT id FROM discovery.recommendation_impressions WHERE recommendation_run_id IN ${database(runIds)})`;
        await database`DELETE FROM discovery.recommendation_impressions WHERE recommendation_run_id IN ${database(runIds)}`;
        await database`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN ${database(runIds)}`;
        await database`DELETE FROM discovery.recommendation_runs WHERE id IN ${database(runIds)}`;
      }
      await database`DELETE FROM catalog.video_details WHERE resource_id IN ${database(sourceResourceIds)}`;
      await database`DELETE FROM catalog.resources WHERE id IN ${database(sourceResourceIds)}`;
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
    await page.getByRole("link", { name: "Start learning" }).click();
    await expect(page.getByRole("dialog", { name: "Learn any topic from the best videos" })).toBeVisible();
    await stabilize(page);
    await expect(page).toHaveScreenshot("source-discovery-learn-desktop.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 256,
    });
  });

  test("source picker searches catalog, resolves a direct video, and keeps mode mismatches explicit", async ({ page }) => {
    await page.context().addCookies([
      {
        name: sessionCookieName,
        value: sessionToken,
        url: "http://localhost:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/app", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Start learning" }).click();
    const input = page.getByLabel("What do you want to learn?");
    await input.fill("Python generators");
    const searchResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/source-discovery/search") && response.request().method() === "POST");
    await input.press("Enter");
    expect((await searchResponse).status()).toBe(200);
    const resultCount = await page.locator(".source-discovery-result").count();
    expect(resultCount).toBeGreaterThanOrEqual(3);
    expect(resultCount).toBeLessThanOrEqual(5);

    await page.getByRole("dialog").getByRole("button", { name: "Close source discovery" }).click();
    await page.getByRole("link", { name: "Start learning" }).click();
    await page.getByRole("button", { name: "YouTube URL" }).click();
    await page.getByLabel("YouTube URL").fill(`https://www.youtube.com/watch?v=${sourceYoutubeId}`);
    await page.getByLabel("YouTube URL").press("Enter");
    await expect(page.locator(".source-discovery-preview")).toBeVisible();
    await expect(page.getByText("Python generators lesson 1")).toBeVisible();

    await page.getByRole("dialog").getByRole("button", { name: "Close source discovery" }).click();
    await page.getByRole("link", { name: "Start learning" }).click();
    await page.getByLabel("What do you want to learn?").fill("https://arxiv.org/abs/1706.03762");
    await page.getByLabel("What do you want to learn?").press("Enter");
    await expect(page.getByText("This looks like a research paper.")).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole("button", { name: "Switch to Research" }).click();
    await expect(page.getByRole("heading", { name: /Research any topic from/ })).toBeVisible();
  });
});

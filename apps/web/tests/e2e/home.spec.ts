import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { cleanupHomeFixture, type HomeFixture, seedHomeFixture } from "./home-fixture";

test.describe.configure({ mode: "serial" });

let database: ReturnType<typeof postgres> | null = null;
let fixture: HomeFixture;

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for Home E2E");
  database = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  fixture = await seedHomeFixture(database);
});

test.afterAll(async () => {
  if (!database || !fixture) return;
  await cleanupHomeFixture(database, fixture);
  await database.end({ timeout: 5 });
  database = null;
});

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-home-${randomUUID()}` });
  await page.context().addCookies([{ name: sessionCookieName, value: fixture.sessionToken, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
});

test("populated Home renders analytics and continues the current video", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Weekly Progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start learning" })).not.toBeFocused();
  await expect(page.locator(".analytics-continue").getByRole("link", { name: "Resume", exact: true })).toHaveAttribute("href", `/app/study/video/${fixture.sessions.hero}`);
  await expect(page.getByRole("heading", { name: "Learning Activity & Progress Trends" })).toBeVisible();
});

test("Home analytics controls open details and change chart periods", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  const detailDialog = page.getByRole("dialog", { name: "Study Distribution" });
  await page.getByRole("button", { name: "View Details" }).click();
  await expect(detailDialog).toBeVisible();
  await detailDialog.getByRole("button", { name: "Close details" }).click();
  await expect(detailDialog).toBeHidden();
  const progressPeriod = page.getByRole("combobox", { name: "Progress period" });
  await progressPeriod.selectOption("1");
  await expect(page.locator(".analytics-ring-value")).toHaveText("69.3%");
  const periods = page.getByRole("group", { name: "Trend period" });
  await periods.getByRole("button", { name: "Day" }).click();
  await expect(periods.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
  const startLearning = page.getByRole("button", { name: "Start learning" });
  await startLearning.click();
  const sourceDialog = page.getByRole("dialog", { name: "Learn any topic from the best videos" });
  await expect(sourceDialog).toBeVisible();
  await sourceDialog.getByRole("button", { name: "Close source discovery" }).click();
  await expect(startLearning).toBeFocused();
});

test("Home charts keep donut and bubble focus synchronized without a click outline", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });

  const focusSegment = page.locator(".analytics-ring-segment.tone-lavender");
  const practiceSegment = page.locator(".analytics-ring-segment.tone-green");
  const researchSegment = page.locator(".analytics-ring-segment.tone-light-lavender");
  for (const [label, activeSegment, mutedSegment] of [
    ["Focus", focusSegment, practiceSegment],
    ["Practice", practiceSegment, focusSegment],
    ["Research", researchSegment, practiceSegment],
  ] as const) {
    await page.locator(".analytics-ring-legend button").filter({ hasText: label }).hover();
    await expect(activeSegment).toHaveClass(/is-active/);
    await expect(mutedSegment).toHaveClass(/is-muted/);
  }

  const focusPoint = await focusSegment.locator(".analytics-ring-hit-target").evaluate((element) => {
    const path = element as SVGPathElement;
    const svg = path.ownerSVGElement;
    if (!svg) throw new Error("Donut segment is missing its SVG");
    const point = svg.createSVGPoint();
    point.x = 95;
    point.y = 50;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error("Donut segment is missing its screen transform");
    const coordinates = point.matrixTransform(matrix);
    return { x: coordinates.x, y: coordinates.y };
  });
  await page.mouse.move(focusPoint.x, focusPoint.y);
  await expect(focusSegment).toHaveClass(/is-active/);

  const videos = page.locator('.analytics-bubble[data-category="Videos"]');
  const research = page.locator('.analytics-bubble[data-category="Research"]');
  await videos.hover();
  await expect(videos).toHaveClass(/is-active/);
  await expect(research).toHaveClass(/is-muted/);
  await videos.click();
  await expect(videos).toHaveCSS("outline-style", "none");
  await page.mouse.move(0, 0);
  await videos.focus();
  await page.keyboard.press("Enter");
  await expect(videos).toHaveClass(/is-active/);
});

test("touch taps toggle donut and bubble focus", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    await context.addCookies([{ name: sessionCookieName, value: fixture.sessionToken, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-home-touch-${randomUUID()}` });
    await page.goto("/app", { waitUntil: "networkidle" });

    const focusSegment = page.locator(".analytics-ring-segment.tone-lavender");
    const hitTarget = focusSegment.locator(".analytics-ring-hit-target");
    await hitTarget.scrollIntoViewIfNeeded();
    const focusPoint = await hitTarget.evaluate((element) => {
      const path = element as SVGPathElement;
      const svg = path.ownerSVGElement;
      if (!svg) throw new Error("Donut segment is missing its SVG");
      const point = svg.createSVGPoint();
      point.x = 95;
      point.y = 50;
      const matrix = svg.getScreenCTM();
      if (!matrix) throw new Error("Donut segment is missing its screen transform");
      const coordinates = point.matrixTransform(matrix);
      return { x: coordinates.x, y: coordinates.y };
    });
    await page.touchscreen.tap(focusPoint.x, focusPoint.y);
    await expect(focusSegment).toHaveClass(/is-active/);
    await page.touchscreen.tap(focusPoint.x, focusPoint.y);
    await expect(focusSegment).not.toHaveClass(/is-active/);

    const videos = page.locator('.analytics-bubble[data-category="Videos"]');
    await videos.scrollIntoViewIfNeeded();
    const bubble = await videos.boundingBox();
    if (!bubble) throw new Error("Videos bubble is not visible");
    const point = { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 };
    await page.touchscreen.tap(point.x, point.y);
    await expect(videos).toHaveClass(/is-active/);
    await page.touchscreen.tap(point.x, point.y);
    await expect(videos).not.toHaveClass(/is-active/);
  } finally {
    await context.close();
  }
});

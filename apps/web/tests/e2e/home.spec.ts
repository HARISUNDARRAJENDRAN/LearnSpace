import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { createSession } from "../../lib/auth/repository";
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

test("first app entry goes to Discover once; empty Home works across later sessions", async ({ page }) => {
  if (!database) throw new Error("Home test database is unavailable");
  const fresh = await seedHomeFixture(database, false);
  try {
    await page.context().addCookies([{ name: sessionCookieName, value: fresh.sessionToken, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
    await page.request.get("/app", { headers: { RSC: "1", "next-router-prefetch": "1" }, maxRedirects: 0 });
    const before = await database`SELECT first_application_visit_at FROM identity.user_settings WHERE user_id = ${fresh.userId}`;
    expect(before[0]?.first_application_visit_at).toBeNull();
    await page.goto("/app/library");
    await expect(page).toHaveURL(/\/app\/discover$/);
    const entered = await database`SELECT first_application_visit_at FROM identity.user_settings WHERE user_id = ${fresh.userId}`;
    expect(entered[0]?.first_application_visit_at).toBeTruthy();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText("Your learning starts here.")).toBeVisible();
    await expect(page.locator(".analytics-bubble, .analytics-ring-arc, .analytics-trend-dot")).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    const laterSession = await createSession(fresh.userId, { userAgent: "home-return-visit" }, process.env.AUTH_SECRET ?? "");
    await page.context().clearCookies();
    await page.context().addCookies([{ name: sessionCookieName, value: laterSession.token, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText("Your learning starts here.")).toBeVisible();
    const after = await database`SELECT first_application_visit_at FROM identity.user_settings WHERE user_id = ${fresh.userId}`;
    expect(after[0]?.first_application_visit_at).toEqual(entered[0]?.first_application_visit_at);
    await page.addInitScript(() => {
      type PlayerOptions = { events: { onReady: (event: { target: FixturePlayer }) => void; onStateChange: (event: { data: number }) => void } };
      class FixturePlayer {
        startedAt = 0;
        constructor(element: HTMLElement, options: PlayerOptions) {
          const play = document.createElement("button");
          play.textContent = "Play fixture video";
          play.onclick = () => { this.startedAt = Date.now(); options.events.onStateChange({ data: 1 }); };
          const pause = document.createElement("button");
          pause.textContent = "Pause fixture video";
          pause.onclick = () => options.events.onStateChange({ data: 2 });
          element.append(play, pause);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        destroy() {}
        getDuration() { return 600; }
        getCurrentTime() { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }
        seekTo() {}
      }
      (window as unknown as { YT: { Player: typeof FixturePlayer } }).YT = { Player: FixturePlayer };
    });
    const started = await page.request.post("/api/v1/study-sessions", { data: { resourceId: fixture.resources.hero, origin: "discover", idempotencyKey: randomUUID() } });
    expect(started.ok()).toBeTruthy();
    const study = await started.json() as { route: string };
    await page.goto(study.route);
    const measured = page.waitForResponse((response) => response.url().endsWith("/focus") && response.request().method() === "POST" && response.status() === 200);
    await page.getByRole("button", { name: "Play fixture video" }).click();
    await measured;
    const recorded = await database`SELECT sum(duration_sec)::int AS seconds FROM study.focus_sessions WHERE user_id = ${fresh.userId}`;
    expect(recorded[0]?.seconds).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause fixture video" }).click();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.locator(".analytics-overview-metric .analytics-duration")).toHaveText(/\d+ sec/);
    await expect(page.locator(".analytics-ring-value")).toHaveText(/\d+ sec/);
    await expect(page.locator(".analytics-distribution-stats")).toContainText("Videos");
    await expect(page.locator(".analytics-trends .analytics-empty")).toBeVisible();
  } finally {
    await cleanupHomeFixture(database, fresh);
  }
});

test("populated Home renders analytics and continues the current video", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByText("Sample data", { exact: true })).toHaveCount(0);
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
  await expect(page.locator(".analytics-ring-value")).toHaveText("3 min");
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
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
    point.x = midpoint.x;
    point.y = midpoint.y;
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
      const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
      point.x = midpoint.x;
      point.y = midpoint.y;
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
    await videos.locator("circle").tap();
    await expect(videos).toHaveClass(/is-active/);
    await videos.locator("circle").tap();
    await expect(videos).not.toHaveClass(/is-active/);
  } finally {
    await context.close();
  }
});

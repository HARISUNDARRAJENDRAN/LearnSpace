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
    await expect(page.locator(".home-session-card, .home-activity-bar")).toHaveCount(0);
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
        element: HTMLElement;
        readyTimer: number;
        constructor(element: HTMLElement, options: PlayerOptions) {
          this.element = element;
          const play = document.createElement("button");
          play.textContent = "Play fixture video";
          play.onclick = () => { this.startedAt = Date.now(); options.events.onStateChange({ data: 1 }); };
          const pause = document.createElement("button");
          pause.textContent = "Pause fixture video";
          pause.onclick = () => options.events.onStateChange({ data: 2 });
          element.append(play, pause);
          this.readyTimer = window.setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        destroy() { clearTimeout(this.readyTimer); this.element.replaceChildren(); }
        getDuration() { return 600; }
        getCurrentTime() { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }
        seekTo() {}
      }
      (window as unknown as { YT: { Player: typeof FixturePlayer } }).YT = { Player: FixturePlayer };
    });
    const started = await page.request.post("/api/v1/study-sessions", { headers: { origin: "http://localhost:3101" }, data: { resourceId: fixture.resources.hero, origin: "discover", idempotencyKey: randomUUID() } });
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
    await expect(page.locator(".home-activity-total")).toContainText("recorded study time");
    await expect(page.locator(".home-stat-card").filter({ hasText: "Total Learning Time" })).toContainText(/\d+ sec/);
    await expect(page.locator(".home-session-card")).toHaveCount(1);
  } finally {
    await cleanupHomeFixture(database, fresh);
  }
});

test("populated Home unifies learning and research and fits the reference viewport", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 768 });
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  for (const name of ["Continue Learning", "Learning Progress", "Your Learning Activity", "Quick Stats"]) await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.locator(".home-session-card")).toHaveCount(3);
  await expect(page.locator(".home-session-card").filter({ hasText: "Home E2E Python lesson" })).toHaveAttribute("href", `/app/study/video/${fixture.sessions.hero}`);
  await expect(page.locator(".home-session-card").filter({ hasText: "Home E2E research paper" })).toHaveAttribute("href", `/app/study/paper/${fixture.sessions.paper}`);
  await expect(page.locator(".home-paper-preview")).toContainText("A deterministic Home E2E abstract.");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await expect.poll(() => page.locator(".home-progress-panel").evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await expect(page.getByRole("button", { name: "Start learning" })).not.toBeFocused();
  expect(errors).toEqual([]);
});

test("Home filters, activity periods and progress scopes respond without losing resume links", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  const filters = page.getByRole("group", { name: "Learning status" });
  await filters.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.locator(".home-session-card")).toHaveCount(0);
  await expect(page.getByText("No completed sessions yet.")).toBeVisible();
  await filters.getByRole("button", { name: "In Progress", exact: true }).click();
  await expect(page.locator(".home-session-card")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Activity period" }).selectOption("Last Week");
  await expect(page.getByRole("img", { name: /Last Week:/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Progress scope" }).selectOption("Research");
  await expect(page.getByRole("progressbar", { name: "Research sessions completed" })).toHaveAttribute("aria-valuenow", "0");
});

test("Home retains source discovery focus and opens the shared search palette", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  const startLearning = page.getByRole("button", { name: "Start learning" });
  await startLearning.click();
  const sourceDialog = page.getByRole("dialog", { name: "Learn any topic from the best videos" });
  await expect(sourceDialog).toBeVisible();
  await sourceDialog.getByRole("button", { name: "Close source discovery" }).click();
  await expect(startLearning).toBeFocused();
  await page.getByRole("button", { name: "Search your study sessions" }).click();
  await expect(page.getByRole("dialog").filter({ has: page.getByRole("textbox") })).toBeVisible();
});

test("Home remains readable without horizontal page overflow on smaller screens", async ({ page }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".home-session-card").first()).toBeVisible();
    await page.getByRole("heading", { name: "Quick Stats" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Quick Stats" })).toBeVisible();
  }
});

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
    await expect(page.getByText("Your recent lessons will appear here.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Find your next lesson" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    const laterSession = await createSession(fresh.userId, { userAgent: "home-return-visit" }, process.env.AUTH_SECRET ?? "");
    await page.context().clearCookies();
    await page.context().addCookies([{ name: sessionCookieName, value: laterSession.token, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText("Your recent lessons will appear here.")).toBeVisible();
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
    const studyTime = page.locator(".home-metric").filter({ has: page.getByRole("heading", { name: "Study time" }) });
    await expect(studyTime.locator("strong")).toHaveText(/\d+ sec/);
    await expect(page.getByRole("region", { name: "Study mix" })).toContainText("Videos");
    await expect(page.getByRole("region", { name: "This week" })).toContainText("Your best day was");
  } finally {
    await cleanupHomeFixture(database, fresh);
  }
});

test("populated Home lists lessons and continues the current video", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByText("Sample data", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Hello, / })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent lessons" }).getByRole("button").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Continue: / })).toHaveAttribute("href", `/app/study/video/${fixture.sessions.hero}`);
});

test("Home period tabs and lesson filters toggle", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  const month = page.getByRole("group", { name: "Period" }).getByRole("button", { name: "This month" });
  await month.click();
  await expect(month).toHaveAttribute("aria-pressed", "true");
  const completed = page.getByRole("button", { name: /Completed$/ });
  await completed.click();
  await expect(completed).toHaveAttribute("aria-pressed", "true");
  await completed.click();
  await expect(completed).toHaveAttribute("aria-pressed", "false");
});

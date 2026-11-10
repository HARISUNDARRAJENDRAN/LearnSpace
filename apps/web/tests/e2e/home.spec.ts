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
    await expect(page.getByText(/Your last video or paper will appear here/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Find a lesson" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    const laterSession = await createSession(fresh.userId, { userAgent: "home-return-visit" }, process.env.AUTH_SECRET ?? "");
    await page.context().clearCookies();
    await page.context().addCookies([{ name: sessionCookieName, value: laterSession.token, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(/Your last video or paper will appear here/)).toBeVisible();
    const after = await database`SELECT first_application_visit_at FROM identity.user_settings WHERE user_id = ${fresh.userId}`;
    expect(after[0]?.first_application_visit_at).toEqual(entered[0]?.first_application_visit_at);
    await page.addInitScript(() => {
      type PlayerOptions = { events: { onReady: (event: { target: FixturePlayer }) => void; onStateChange: (event: { data: number }) => void } };
      class FixturePlayer {
        startedAt = 0;
        buttons: HTMLButtonElement[];
        constructor(element: HTMLElement, options: PlayerOptions) {
          const play = document.createElement("button");
          play.textContent = "Play fixture video";
          play.onclick = () => { this.startedAt = Date.now(); options.events.onStateChange({ data: 1 }); };
          const pause = document.createElement("button");
          pause.textContent = "Pause fixture video";
          pause.onclick = () => options.events.onStateChange({ data: 2 });
          this.buttons = [play, pause];
          element.append(play, pause);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        // Like YT.Player, destroying removes what it rendered.
        destroy() { for (const button of this.buttons) button.remove(); }
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
    // The lesson card takes the first click to select it; only then does the player take input.
    await page.getByRole("button", { name: "Select Home E2E Python lesson" }).click();
    await page.getByRole("button", { name: "Play fixture video" }).click();
    await measured;
    const recorded = await database`SELECT sum(duration_sec)::int AS seconds FROM study.focus_sessions WHERE user_id = ${fresh.userId}`;
    expect(recorded[0]?.seconds).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause fixture video" }).click();
    // Cleanup must not race the observer tick that writes the agent's suggestions.
    const observed = page.waitForResponse((response) => response.url().endsWith("/api/v1/plan/observe"));
    await page.getByRole("link", { name: "Home", exact: true }).click();
    const recent = page.getByRole("region", { name: "Recent study" });
    await expect(recent).toContainText("Home E2E Python lesson");
    await expect(recent.getByRole("button", { name: "Resume" })).toBeVisible();
    await observed;
  } finally {
    await cleanupHomeFixture(database, fresh);
  }
});

test("populated Home shows recent study, the agent's next actions and the learner's level", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Recent study" })).toContainText("Home E2E Python lesson");
  await expect(page.getByRole("region", { name: "Next actions" }).getByRole("button", { name: "Add to plan" }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Level & rank" })).toContainText(/Level \d+/);
});

test("the study plan calendar creates, switches views and deletes an item", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  const calendar = page.getByRole("region", { name: "Study plan" });
  await calendar.getByRole("button", { name: "Plan", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan study" });
  await expect(dialog.getByLabel("Date")).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
  await dialog.getByLabel("Title", { exact: true }).fill("Learn polymorphism in Java");
  await dialog.getByRole("radio", { name: "Practice" }).check();
  await dialog.getByRole("button", { name: "Add to plan" }).click();
  await expect(dialog).toBeHidden();
  const event = calendar.getByRole("button", { name: /Learn polymorphism in Java/ });
  await expect(event).toBeVisible();
  await expect(event).toHaveClass(/kind-practice/);
  await calendar.getByRole("tab", { name: "Month" }).click();
  await expect(calendar.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
  await calendar.getByRole("button", { name: /Learn polymorphism in Java/ }).click();
  const edit = page.getByRole("dialog", { name: "Plan item" });
  await expect(edit.getByRole("region", { name: "Progress" })).toBeVisible();
  await edit.getByRole("button", { name: "Delete" }).click();
  await edit.getByRole("button", { name: "Confirm delete" }).click();
  await expect(calendar.getByRole("button", { name: /Learn polymorphism in Java/ })).toHaveCount(0);
});

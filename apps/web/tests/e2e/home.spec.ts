import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { getHomeFeed } from "../../lib/discovery/service";
import { sessionCookieName } from "../../lib/auth/cookies";
import { cleanupHomeFixture, seedHomeFixture, stabilizeHomeRecommendations, type HomeFixture } from "./home-fixture";

test.describe.configure({ mode: "serial" });

let database: ReturnType<typeof postgres> | null = null;
let fixture: HomeFixture;

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for Home E2E");
  database = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  fixture = await seedHomeFixture(database);
  const feed = await getHomeFeed(fixture.userId);
  if (feed.sections.recommendedVideos.length < 4) throw new Error(`Home E2E fixture produced only ${feed.sections.recommendedVideos.length} recommendations`);
  if (!feed.runId) throw new Error("Home E2E fixture did not create a recommendation run");
  await stabilizeHomeRecommendations(database, fixture, feed.runId);
});

test.afterAll(async () => {
  if (!database || !fixture) return;
  await cleanupHomeFixture(database, fixture);
  await database.end({ timeout: 5 });
  database = null;
});

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-home-${randomUUID()}` });
  await page.context().addCookies([{ name: sessionCookieName, value: fixture.sessionToken, url: "http://localhost:3100", httpOnly: true, sameSite: "Lax" }]);
});

test("populated Home renders continuation, history, and recommendations", async ({ page }) => {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Continue Learning" })).toBeVisible();
  await expect(page.locator(".home-continue-card")).toContainText("Home E2E Python lesson");
  await expect(page.locator(".home-progress-gauge")).toHaveAttribute("aria-label", "32% complete");
  await expect(page.locator(".home-history-item")).toHaveCount(3);
  await expect(page.locator(".home-history-item").filter({ hasText: "Home E2E research paper" })).toBeVisible();
  await expect(page.locator(".home-recommendation-card")).toHaveCount(4);
});

test("Continue Learning Resume reuses the existing session and preserves progress", async ({ page }) => {
  if (!database) throw new Error("Home E2E database is unavailable");
  const before = await database<{ count: number }[]>`SELECT count(*)::int AS count FROM study.study_sessions WHERE user_id = ${fixture.userId}`;
  await page.goto("/app", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page).toHaveURL(`/app/study/video/${fixture.sessions.hero}`);
  const after = await database<{ count: number }[]>`SELECT count(*)::int AS count FROM study.study_sessions WHERE user_id = ${fixture.userId}`;
  const heroSession = await database<{ status: string }[]>`SELECT status FROM study.study_sessions WHERE id = ${fixture.sessions.hero} AND user_id = ${fixture.userId}`;
  const progress = await database<{ progress_pct: number }[]>`SELECT progress_pct FROM study.user_resource_progress WHERE user_id = ${fixture.userId} AND resource_id = ${fixture.resources.hero}`;
  expect(after[0]?.count).toBe(before[0]?.count);
  expect(heroSession[0]?.status).toBe("active");
  expect(Number(progress[0]?.progress_pct)).toBe(32);
});

test("Recent History routes to the existing paper session", async ({ page }) => {
  if (!database) throw new Error("Home E2E database is unavailable");
  const before = await database<{ count: number }[]>`SELECT count(*)::int AS count FROM study.study_sessions WHERE user_id = ${fixture.userId}`;
  await page.goto("/app", { waitUntil: "networkidle" });
  await page.locator(".home-history-item").filter({ hasText: "Home E2E research paper" }).click();
  await expect(page).toHaveURL(`/app/study/paper/${fixture.sessions.paper}`);
  const after = await database<{ count: number }[]>`SELECT count(*)::int AS count FROM study.study_sessions WHERE user_id = ${fixture.userId}`;
  expect(after[0]?.count).toBe(before[0]?.count);
});

test("You Might Like starts Study with Home recommendation provenance", async ({ page }) => {
  const db = database;
  if (!db) throw new Error("Home E2E database is unavailable");
  await page.goto("/app", { waitUntil: "networkidle" });
  const card = page.locator(".home-recommendation-card").filter({ hasText: "Home E2E recommendation" }).first();
  await expect(card).toBeVisible();
  const startRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/study-sessions") && request.method() === "POST");
  await card.getByRole("button", { name: /Play Home E2E recommendation/ }).click();
  const request = await startRequest;
  const body = request.postDataJSON() as { resourceId: string; origin: string; recommendationRunId?: string };
  expect(body.origin).toBe("home");
  const recommendationRunId = body.recommendationRunId;
  if (!recommendationRunId) throw new Error("Home recommendation request did not include a run ID");
  expect(recommendationRunId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page).toHaveURL(/\/app\/study\/video\/[0-9a-f-]+$/);
  const candidate = await db<{ user_id: string; resource_id: string }[]>`
    SELECT r.user_id, c.resource_id
    FROM discovery.recommendation_runs AS r
    INNER JOIN discovery.recommendation_candidates AS c ON c.recommendation_run_id = r.id
    WHERE r.id = ${recommendationRunId} AND c.resource_id = ${body.resourceId}
  `;
  expect(candidate[0]?.user_id).toBe(fixture.userId);
  const interaction = await db<{ origin: string; recommendation_run_id: string }[]>`
    SELECT metadata->>'origin' AS origin, metadata->>'recommendationRunId' AS recommendation_run_id
    FROM discovery.discovery_interactions
    WHERE user_id = ${fixture.userId} AND resource_id = ${body.resourceId} AND action = 'start_session'
    ORDER BY occurred_at DESC LIMIT 1
  `;
  expect(interaction[0]?.origin).toBe("home");
  expect(interaction[0]?.recommendation_run_id).toBe(recommendationRunId);
});

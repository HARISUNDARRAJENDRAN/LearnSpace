import { randomUUID } from "node:crypto";
import { SOURCE_DISCOVERY_MAX_RESULTS } from "@learnspace/shared";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
test.skip(!databaseUrl, "requires the CI database environment");
test.describe.configure({ mode: "serial" });

const runKey = process.env.PLAYWRIGHT_RUN_ID ?? String(Date.now());
const email = `source-picker-${runKey}@example.test`;
const password = "source-picker-password-123";
const paperSeed = String(Date.now()).slice(-5);
let database: ReturnType<typeof postgres> | null = null;
let resourceIds: string[] = [];

test.beforeAll(async () => {
  database = postgres(databaseUrl as string, { max: 1, prepare: false, connect_timeout: 10 });
  const videoIds = Array.from({ length: 3 }, () => randomUUID());
  const paperIds = Array.from({ length: 3 }, () => randomUUID());
  resourceIds = [...videoIds, ...paperIds];
  await database.begin(async (tx) => {
    for (const [index, resourceId] of videoIds.entries()) {
      const youtubeId = `s${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      await tx`
        INSERT INTO catalog.resources
          (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
        VALUES
          (${resourceId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${`Python generators explained ${index + 1}`}, 'A deterministic source-picker video.', 'en', 'public', 'ready', 0.95, '{"test":true}'::jsonb)
      `;
      await tx`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
        VALUES (${resourceId}, ${youtubeId}, ${`Source Picker Lab ${index + 1}`}, 900000, now())
      `;
    }
    for (const [index, resourceId] of paperIds.entries()) {
      const arxivId = `9999.${paperSeed}${index}`;
      await tx`
        INSERT INTO catalog.resources
          (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
        VALUES
          (${resourceId}, NULL, 'paper', 'arxiv', ${arxivId}, ${`https://arxiv.org/abs/${arxivId}`}, ${`Efficient transformer attention mechanisms ${index + 1}`}, 'A deterministic source-picker paper.', 'en', 'public', 'ready', 0.95, '{"paperClass":"current","test":true}'::jsonb)
      `;
      await tx`
        INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, submitted_at)
        VALUES (${resourceId}, ${arxivId}, 'A deterministic abstract about efficient transformer attention mechanisms.', 'arXiv', current_date, now())
      `;
    }
  });
});

test.afterAll(async () => {
  const db = database;
  if (!db) return;
  const users = await db<{ id: string }[]>`SELECT id FROM identity.users WHERE email = ${email}`;
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    await db`DELETE FROM ops.outbox_events WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM ops.idempotency_records WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM activity.activity_events WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM study.user_resource_progress WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM agent.agent_artifacts WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM agent.tool_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM agent.agent_steps WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM agent.agent_runs WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.study_sessions WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM discovery.discovery_interactions WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM discovery.recommendation_impressions WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM discovery.recommendation_runs WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM identity.users WHERE id IN ${db(userIds)}`;
  }
  await db`DELETE FROM catalog.video_details WHERE resource_id IN ${db(resourceIds)}`;
  await db`DELETE FROM catalog.paper_details WHERE resource_id IN ${db(resourceIds)}`;
  await db`DELETE FROM catalog.resources WHERE id IN ${db(resourceIds)}`;
  await db.end({ timeout: 5 });
  database = null;
});

async function completeOnboarding(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.locator("[data-onboarding-hydrated]")).toHaveAttribute("data-onboarding-hydrated", "true");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Student" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Coursework" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const topicSearch = page.getByPlaceholder("Search topics, skills, or domains");
  await topicSearch.fill("Python");
  await page.getByRole("button", { name: "Python skill" }).click();
  await topicSearch.fill("AI");
  await page.getByRole("button", { name: /AI \/ Machine Learning/ }).click();
  await topicSearch.fill("Linear Algebra");
  await page.getByRole("button", { name: "Linear Algebra" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Clear explanations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I know the basics" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("catalog discovery starts the correct StudySession and preserves mode context", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Source Picker Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  await page.getByRole("link", { name: "Open verification link" }).click();
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Start learning" }).click();
  const learnInput = page.getByLabel("What do you want to learn?");
  await expect(learnInput).toBeFocused();
  await learnInput.fill("https://arxiv.org/abs/1706.03762");
  await learnInput.press("Enter");
  await expect(page.getByText("This looks like a research paper.")).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("button", { name: "Switch to Research" }).click();
  await expect(page.getByRole("dialog", { name: "Research any topic from the best papers" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/app");
  await page.getByRole("button", { name: "Start learning" }).click();
  const learnSearchInput = page.getByLabel("What do you want to learn?");
  await expect(learnSearchInput).toBeFocused();
  await learnSearchInput.fill("Python generators");
  await learnSearchInput.press("Enter");
  await expect.poll(() => page.locator(".source-discovery-result").count()).toBeGreaterThanOrEqual(3);
  expect(await page.locator(".source-discovery-result").count()).toBeLessThanOrEqual(SOURCE_DISCOVERY_MAX_RESULTS);
  const studyRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/study-sessions") && request.method() === "POST");
  await page.locator(".source-discovery-result").first().getByRole("button", { name: "Start learning" }).click();
  const requestBody = (await studyRequest).postDataJSON() as { recommendationRunId?: string };
  expect(requestBody.recommendationRunId).toBeTruthy();
  await expect(page).toHaveURL(/\/app\/study\/video\/[0-9a-f-]+$/);

  await page.goto("/app/research");
  await page.getByRole("button", { name: "Start research", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Research any topic from the best papers" })).toBeVisible();
  const researchInput = page.getByLabel("What do you want to research?");
  await researchInput.fill("Efficient transformer attention mechanisms");
  await researchInput.press("Enter");
  await expect.poll(() => page.locator(".source-discovery-result").count()).toBeGreaterThanOrEqual(3);
  expect(await page.locator(".source-discovery-result").count()).toBeLessThanOrEqual(SOURCE_DISCOVERY_MAX_RESULTS);
  await page.locator(".source-discovery-result").first().getByRole("button", { name: "Start researching" }).click();
  await expect(page).toHaveURL(/\/app\/study\/paper\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Start research", exact: true }).click();
  await expect(page.getByLabel("What do you want to research?")).toBeFocused();
  await page.getByLabel("What do you want to research?").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("What do you want to research?").press("Enter");
  await expect(page.getByText("This looks like a YouTube video.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/study\/paper\//);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start research", exact: true })).toBeFocused();

  await page.goto("/app");
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.locator(".application-page")).toHaveAttribute("inert", "");
  await expect(page.locator(".application-page")).toHaveAttribute("aria-hidden", "true");
  await page.route("**/api/v1/source-discovery/search", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    if (body.query === "Query A") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        await route.fulfill({ json: { status: "completed", runId: randomUUID(), mode: "learn", query: "Query A", candidates: [] } });
      } catch {
        // The browser aborts Query A when Query B becomes the latest request.
      }
      return;
    }
    await route.fulfill({ json: { status: "completed", runId: randomUUID(), mode: "learn", query: "Query B", candidates: [] } });
  });
  const cancellationInput = page.getByLabel("What do you want to learn?");
  await cancellationInput.fill("Query A");
  const firstSearch = page.waitForRequest((request) => request.url().endsWith("/api/v1/source-discovery/search") && request.postDataJSON().query === "Query A");
  await cancellationInput.press("Enter");
  await firstSearch;
  await cancellationInput.fill("Query B");
  await cancellationInput.press("Enter");
  await expect(page.getByText("We couldn't find strong learning videos for that topic.")).toBeVisible();
  await expect(cancellationInput).toHaveValue("Query B");
  await page.unroute("**/api/v1/source-discovery/search");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start learning" })).toBeFocused();
});

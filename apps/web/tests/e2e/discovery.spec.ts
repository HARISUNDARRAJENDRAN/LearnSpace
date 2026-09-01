import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let database: ReturnType<typeof postgres> | null = null;
let seededResourceIds: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for discovery E2E");
  const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  database = db;
  const [concept] = await db<{ id: string }[]>`
    SELECT id FROM knowledge.concepts WHERE slug = 'ai-machine-learning' AND status = 'active'
  `;
  if (!concept) throw new Error("AI / Machine Learning concept is required for discovery E2E");

  const videoResourceId = randomUUID();
  const paperResourceId = randomUUID();
  const youtubeId = `e2e${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const arxivId = `e2e.${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  seededResourceIds = [videoResourceId, paperResourceId];
  await db.begin(async (tx) => {
    await tx`
      INSERT INTO catalog.resources
        (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES
        (${videoResourceId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'A seeded discovery lesson', 'A deterministic lesson used by browser tests.', 'en', 'public', 'ready', 0.98, '{"thumbnailUrl":"/learnspace-mark.svg","test":true}'::jsonb),
        (${paperResourceId}, NULL, 'paper', 'arxiv', ${arxivId}, ${`https://arxiv.org/abs/${arxivId}`}, 'A seeded research paper', 'A deterministic paper used by browser tests.', 'en', 'public', 'ready', 0.96, '{"paperClass":"current","test":true}'::jsonb)
    `;
    await tx`
      INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
      VALUES (${videoResourceId}, ${youtubeId}, 'LearnSpace Test Lab', 600000, now())
    `;
    await tx`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, submitted_at)
      VALUES (${paperResourceId}, ${arxivId}, 'A deterministic research abstract for browser tests.', 'arXiv', current_date, now())
    `;
    await tx`
      INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
      VALUES
        (${videoResourceId}, ${concept.id}, 'e2e', 1, true),
        (${paperResourceId}, ${concept.id}, 'e2e', 1, true)
    `;
  });
});

test.afterAll(async () => {
  const db = database;
  if (!db || seededResourceIds.length === 0) return;
  const runRows = await db<{ id: string }[]>`
    SELECT DISTINCT recommendation_run_id AS id
    FROM discovery.recommendation_candidates
    WHERE resource_id IN ${db(seededResourceIds)}
  `;
  if (runRows.length > 0) {
    const runIds = runRows.map((row) => row.id);
    await db`
      DELETE FROM discovery.discovery_interactions
      WHERE impression_id IN (
        SELECT id FROM discovery.recommendation_impressions
        WHERE recommendation_run_id IN ${db(runIds)}
      )
    `;
    await db`DELETE FROM discovery.recommendation_impressions WHERE recommendation_run_id IN ${db(runIds)}`;
    await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN ${db(runIds)}`;
    await db`DELETE FROM discovery.recommendation_runs WHERE id IN ${db(runRows.map((row) => row.id))}`;
  }
  await db`DELETE FROM discovery.discovery_interactions WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM discovery.recommendation_impressions WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM discovery.recommendation_candidates WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM activity.activity_events WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM catalog.library_items WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM catalog.resource_concepts WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM catalog.video_details WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM catalog.paper_details WHERE resource_id IN ${db(seededResourceIds)}`;
  await db`DELETE FROM catalog.resources WHERE id IN ${db(seededResourceIds)}`;
  await db.end({ timeout: 5 });
  database = null;
});

test("completed learner reaches personalized Home and can use the app navigation", async ({ page }) => {
  const email = `discovery-${Date.now()}@example.test`;
  const password = "discovery-password-123";

  await page.goto("/register");
  await page.getByLabel("Your name").fill("Discovery Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  await page.getByRole("link", { name: "Open verification link" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.locator("[data-onboarding-hydrated]")).toHaveAttribute(
    "data-onboarding-hydrated",
    "true",
  );

  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Student" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Coursework" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("Python");
  await page.getByRole("button", { name: "Python skill" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("React");
  await page.getByRole("button", { name: "React skill" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("AI");
  await page.getByRole("button", { name: /AI \/ Machine Learning/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Clear explanations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I know the basics" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Good to see you, Discovery." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended videos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research worth reading" })).toBeVisible();
  await expect(page.getByText("Personalized from your interests")).toBeVisible();
  await expect(page.getByRole("link", { name: "Discover" })).toBeVisible();

  const seededVideo = page.locator("article.discovery-card").filter({ hasText: "A seeded discovery lesson" });
  await expect(seededVideo).toBeVisible();
  await expect(page.locator("article.discovery-card").filter({ hasText: "A seeded research paper" })).toBeVisible();
  const openLink = seededVideo.getByRole("link", { name: /Open/ });
  await expect(openLink).toHaveAttribute("href", /youtube\.com\/watch/);
  const popup = await Promise.all([page.waitForEvent("popup"), openLink.click()]).then(([opened]) => opened);
  await popup.close();
  await seededVideo.getByRole("button", { name: "Save" }).click();
  await expect(seededVideo.locator("[aria-live]")).toHaveText("Saved to your library");
  await seededVideo.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("A seeded discovery lesson")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("A seeded discovery lesson")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("link", { name: "Discover" }).click();
  await expect(page).toHaveURL(/\/app\/discover$/);
  await expect(page.getByRole("heading", { name: "Recommended videos" })).toBeVisible();
});

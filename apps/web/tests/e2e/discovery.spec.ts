import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-${randomUUID()}` });
});

let database: ReturnType<typeof postgres> | null = null;
let seededResourceIds: string[] = [];
let adjacentRelationId: string | null = null;
let behaviorCoreResourceId: string | null = null;
let behaviorAdjacentResourceId: string | null = null;
let behaviorDecoyResourceIds: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for discovery E2E");
  const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  database = db;
  const concepts = await db<{ id: string; slug: string }[]>`
    SELECT id, slug FROM knowledge.concepts
    WHERE slug IN ('ai-machine-learning', 'physics', 'python', 'react') AND status = 'active'
  `;
  const concept = concepts.find((item) => item.slug === "ai-machine-learning");
  const adjacentConcept = concepts.find((item) => item.slug === "physics");
  const decoyConcepts = concepts.filter((item) => item.slug !== "physics");
  if (!concept || !adjacentConcept || decoyConcepts.length < 3) throw new Error("AI, Physics, Python, and React concepts are required for discovery E2E");
  adjacentRelationId = randomUUID();
  await db`
    INSERT INTO knowledge.concept_relations
      (id, source_concept_id, target_concept_id, relation_type, weight, confidence, status, created_by)
    VALUES
      (${adjacentRelationId}, ${concept.id}, ${adjacentConcept.id}, 'related_to', 0.9, 0.9, 'accepted', 'e2e')
  `;

  const videoResourceId = randomUUID();
  const paperResourceId = randomUUID();
  const behaviorResourceAId = randomUUID();
  const behaviorResourceBId = randomUUID();
  const youtubeId = `e2e${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const arxivId = `e2e.${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const behaviorYoutubeA = `e2a${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const behaviorYoutubeB = `e2b${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  behaviorDecoyResourceIds = Array.from({ length: 8 }, () => randomUUID());
  behaviorCoreResourceId = behaviorResourceAId;
  behaviorAdjacentResourceId = behaviorResourceBId;
  seededResourceIds = [videoResourceId, paperResourceId, behaviorResourceAId, behaviorResourceBId, ...behaviorDecoyResourceIds];
  await db.begin(async (tx) => {
    await tx`
      INSERT INTO catalog.resources
        (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES
        (${videoResourceId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'A seeded discovery lesson', 'A deterministic lesson used by browser tests.', 'en', 'public', 'ready', 0.98, '{"thumbnailUrl":"/assets/learnspace-monogram.svg","test":true}'::jsonb),
        (${paperResourceId}, NULL, 'paper', 'arxiv', ${arxivId}, ${`https://arxiv.org/abs/${arxivId}`}, 'A seeded research paper', 'A deterministic paper used by browser tests.', 'en', 'public', 'ready', 0.96, '{"paperClass":"current","test":true}'::jsonb),
        (${behaviorResourceAId}, NULL, 'video', 'youtube', ${behaviorYoutubeA}, ${`https://www.youtube.com/watch?v=${behaviorYoutubeA}`}, 'A behavior seed lesson', 'A deterministic core-concept lesson used by behavior tests.', 'en', 'public', 'ready', 0.99, '{"thumbnailUrl":"/assets/learnspace-monogram.svg","test":true}'::jsonb),
        (${behaviorResourceBId}, NULL, 'video', 'youtube', ${behaviorYoutubeB}, ${`https://www.youtube.com/watch?v=${behaviorYoutubeB}`}, 'An adjacent learning lesson', 'A deterministic adjacent-concept lesson used by behavior tests.', 'en', 'public', 'ready', 0.99, '{"thumbnailUrl":"/assets/learnspace-monogram.svg","test":true}'::jsonb)
    `;
    await tx`
      INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
      VALUES (${videoResourceId}, ${youtubeId}, 'LearnSpace Test Lab', 600000, now())
        ,(${behaviorResourceAId}, ${behaviorYoutubeA}, 'LearnSpace Behavior Lab', 600000, now())
        ,(${behaviorResourceBId}, ${behaviorYoutubeB}, 'LearnSpace Adjacent Lab', 600000, now())
    `;
    await tx`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, submitted_at)
      VALUES (${paperResourceId}, ${arxivId}, 'A deterministic research abstract for browser tests.', 'arXiv', current_date, now())
    `;
    await tx`
      INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
      VALUES
        (${videoResourceId}, ${concept.id}, 'e2e', 1, true),
        (${paperResourceId}, ${concept.id}, 'e2e', 1, true),
        (${behaviorResourceAId}, ${concept.id}, 'e2e', 1, true),
        (${behaviorResourceBId}, ${adjacentConcept.id}, 'e2e', 1, true)
    `;
    for (const [index, decoyResourceId] of behaviorDecoyResourceIds.entries()) {
      const decoyYoutubeId = `e2d${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const decoyConcept = decoyConcepts[index % decoyConcepts.length];
      if (!decoyConcept) throw new Error("discovery E2E decoy concept was not created");
      const decoyQuality = index === 5 ? 0.4 : [0, 3, 6].includes(index) ? 0.9 : 0.1;
      await tx`
        INSERT INTO catalog.resources
          (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
        VALUES
          (${decoyResourceId}, NULL, 'video', 'youtube', ${decoyYoutubeId}, ${`https://www.youtube.com/watch?v=${decoyYoutubeId}`}, ${`Core concept decoy ${index + 1}`}, 'A deterministic core-concept decoy used to keep an adjacent resource outside the initial recommendation range.', 'en', 'public', 'ready', ${decoyQuality}, '{"thumbnailUrl":"/assets/learnspace-monogram.svg","test":true}'::jsonb)
      `;
      await tx`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
        VALUES (${decoyResourceId}, ${decoyYoutubeId}, ${`LearnSpace Decoy Lab ${index + 1}`}, 600000, now())
      `;
      await tx`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
        VALUES (${decoyResourceId}, ${decoyConcept.id}, 'e2e-decoy', 1, true)
      `;
    }
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
  if (adjacentRelationId) {
    await db`DELETE FROM knowledge.concept_relations WHERE id = ${adjacentRelationId}`;
  }
  await db.end({ timeout: 5 });
  database = null;
});

async function completeDiscoveryOnboarding(page: import("@playwright/test").Page): Promise<void> {
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
  const search = page.getByPlaceholder("Search topics, skills, or domains");
  await search.fill("AI");
  await page.getByRole("button", { name: /AI \/ Machine Learning/ }).click();
  await search.fill("Python");
  await page.getByRole("button", { name: "Python skill" }).click();
  await search.fill("React");
  await page.getByRole("button", { name: "React skill" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Clear explanations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I know the basics" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("completed learner reaches Home and can use the app navigation", async ({ page }) => {
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
  await expect(page.getByRole("main", { name: "Learning analytics dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Activity", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Learning Activity & Progress Trends", exact: true })).toBeVisible();
  const browserErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const expectedNotFound = response.status() === 404 && /\/app\/discover\/(this-does-not-exist|trending-now|recommended-for-you|based-on-interests)$/.test(new URL(response.url()).pathname);
    if (response.status() >= 400 && response.request().resourceType() !== "image" && !expectedNotFound) {
      browserErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource: the server responded with a status of 404")) {
      browserErrors.push(message.text());
    }
  });
  await page.goto("/app/discover");
  await expect(page.locator("main.discovery-canvas:not(.discover-home-loading)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discover", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "For You", level: 2, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Technology & Computing", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Popular resources", level: 2 })).toBeVisible();
  await expect(page.locator(".discovery-curriculum-results")).toHaveCount(0);
  for (const name of ["Trending Now", "Recommended For You", "Based on Your Interests"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  }
  const codingCategory = page.getByRole("link", { name: /Coding & Programming/ });
  await expect(codingCategory).toHaveAttribute("href", "/app/discover/coding-programming");
  await expect(codingCategory.locator(".discover-category-art")).toHaveCount(1);
  await codingCategory.click();
  await expect(page).toHaveURL(/\/app\/discover\/coding-programming$/);
  await expect(page.getByRole("heading", { name: "Coding & Programming", level: 1 })).toBeVisible();
  await expect(page.locator(".application-header-view-group")).toHaveCount(0);
  await expect(page.locator(".discovery-curriculum-card").first()).toBeVisible();
  await expect(page).toHaveTitle("Coding & Programming | Discover | LearnSpace");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Coding & Programming", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/discover$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/discover\/coding-programming$/);
  await page.goBack();

  const dataScienceCategory = page.getByRole("link", { name: /Data Science & AI\/ML/ });
  await dataScienceCategory.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/discover\/data-science-ai$/);
  await expect(page.getByRole("heading", { name: "Data Science & AI/ML", level: 1 })).toBeVisible();
  await expect(page.locator(".discovery-curriculum-card").first()).toBeVisible();

  for (const { slug, name } of [
    { slug: "mathematics", name: "Mathematics" },
    { slug: "cybersecurity", name: "Cybersecurity & Privacy" },
  ]) {
    await page.goto(`/app/discover/${slug}`);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.locator(".discovery-curriculum-card").first()).toBeVisible();
  }
  await page.goto("/app/discover/this-does-not-exist");
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  for (const slug of ["trending-now", "recommended-for-you", "based-on-interests"]) {
    await page.goto(`/app/discover/${slug}`);
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/discover");
  await page.getByRole("link", { name: /Mathematics/ }).click();
  await expect(page).toHaveURL(/\/app\/discover\/mathematics$/);
  await page.goto("/app/discover/cybersecurity");
  await expect(page.getByRole("heading", { name: "Cybersecurity & Privacy", level: 1 })).toBeVisible();
  const categoryBackLink = page.locator(".discovery-category-back");
  await expect(categoryBackLink).toBeVisible();
  expect(await categoryBackLink.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
  await categoryBackLink.click();
  await expect(page).toHaveURL(/\/app\/discover$/);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("link", { name: "Discover" }).click();
  await expect(page).toHaveURL(/\/app\/discover$/);
  await expect(page.locator("main.discovery-canvas:not(.discover-home-loading)")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("meaningful learning promotes an adjacent concept and dismissal persists", async ({ page }) => {
  const email = `discovery-adjacent-${Date.now()}@example.test`;
  const password = "discovery-adjacent-password-123";

  await page.goto("/register");
  await page.getByLabel("Your name").fill("Adjacent Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  await page.getByRole("link", { name: "Open verification link" }).click();
  await completeDiscoveryOnboarding(page);
  await page.goto("/app/discover");
  const coreCard = page.locator("article.discovery-card").filter({ hasText: "A behavior seed lesson" });
  const recommendedSection = page.locator("section[aria-labelledby='section-recommended-videos']");
  const adjacentCard = recommendedSection.locator("article.discovery-card").filter({ hasText: "An adjacent learning lesson" });
  await expect(coreCard).toBeVisible();
  await expect(adjacentCard).toHaveCount(0);
  await expect(page.locator("main.discovery-canvas:not(.discover-home-loading)")).toBeVisible();

  const initialHomeResponse = await page.request.get("/api/v1/discovery/home");
  expect(initialHomeResponse.ok()).toBe(true);
  const initialHome = await initialHomeResponse.json() as {
    runId: string;
    sections: { recommendedVideos: Array<{ resourceId: string }> };
  };
  if (!behaviorAdjacentResourceId) throw new Error("behavior adjacent resource was not created");
  expect(initialHome.sections.recommendedVideos.some((card) => card.resourceId === behaviorAdjacentResourceId)).toBe(false);

  if (!behaviorCoreResourceId) throw new Error("behavior seed resource was not created");
  for (let index = 0; index < 5; index += 1) {
    const response = await page.request.post("/api/v1/discovery/interactions", {
      data: {
        resourceId: behaviorCoreResourceId,
        action: "complete",
        correlationId: randomUUID(),
        metadata: {},
      },
    });
    expect(response.ok()).toBe(true);
  }

  const changedHomeResponse = await page.request.get("/api/v1/discovery/home");
  expect(changedHomeResponse.ok()).toBe(true);
  const changedHome = await changedHomeResponse.json() as {
    runId: string;
    sections: { recommendedVideos: Array<{ resourceId: string; title: string; score: number; reason: string }> };
  };
  expect(changedHome.runId).not.toBe(initialHome.runId);
  const changedCandidates = database
    ? await database<{ resource_id: string; title: string; score: number; selected: boolean; final_rank: number | null }[]>`
      SELECT c.resource_id, r.title, c.score, c.selected, c.final_rank
      FROM discovery.recommendation_candidates AS c
      INNER JOIN catalog.resources AS r ON r.id = c.resource_id
      WHERE c.recommendation_run_id = ${changedHome.runId}
      ORDER BY c.final_rank NULLS LAST, c.score DESC
    `
    : [];
  expect(
    changedHome.sections.recommendedVideos.some((card) => card.resourceId === behaviorAdjacentResourceId),
    JSON.stringify(changedCandidates.map((candidate) => ({ title: candidate.title, score: candidate.score, selected: candidate.selected, finalRank: candidate.final_rank }))),
  ).toBe(true);

  await page.reload();
  const promotedCard = page.locator("section[aria-labelledby='section-recommended-videos'] article.discovery-card").filter({ hasText: "An adjacent learning lesson" });
  await expect(promotedCard).toBeVisible();
  await expect(promotedCard).toContainText("Because you've been learning Physics");
  await promotedCard.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("An adjacent learning lesson")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("An adjacent learning lesson")).toHaveCount(0);
});

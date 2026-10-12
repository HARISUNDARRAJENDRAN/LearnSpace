import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-${randomUUID()}` });
});

const runKey = process.env.PLAYWRIGHT_RUN_ID ?? String(Date.now());
const email = `study-e2e-${runKey}@example.test`;
const password = "study-e2e-password-123";
const videoResourceId = randomUUID();
const paperResourceId = randomUUID();
const collectionId = randomUUID();
const collectionSectionId = randomUUID();
const collectionVideoItemId = randomUUID();
const collectionPaperItemId = randomUUID();
const youtubeId = `s${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const arxivId = `s.${randomUUID().replaceAll("-", "").slice(0, 8)}`;

let database: ReturnType<typeof postgres> | null = null;
let videoSessionId: string | null = null;

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for Study E2E");
  const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  database = db;
  const conceptRows = await db<{ id: string }[]>`
    SELECT id FROM knowledge.concepts
    WHERE slug = 'ai-machine-learning' AND status = 'active'
    LIMIT 1
  `;
  const concept = conceptRows[0];
  if (!concept) throw new Error("AI concept is required for Study E2E");

  await db.begin(async (tx) => {
    await tx`
      INSERT INTO catalog.resources
        (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES
        (${videoResourceId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'A deterministic Study video', 'A local browser-test lesson with no fabricated transcript.', 'en', 'public', 'ready', 0.99, '{"thumbnailUrl":"/learnspace-mark.svg","test":true}'::jsonb),
        (${paperResourceId}, NULL, 'paper', 'arxiv', ${arxivId}, ${`https://arxiv.org/abs/${arxivId}`}, 'A deterministic Study paper', 'A local browser-test paper with catalogue metadata only.', 'en', 'public', 'ready', 0.98, '{"paperClass":"current","test":true}'::jsonb)
    `;
    await tx`
      INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
      VALUES (${videoResourceId}, ${youtubeId}, 'LearnSpace Study Lab', 600000, now())
    `;
    await tx`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, pdf_source_url)
      VALUES (${paperResourceId}, ${arxivId}, 'A deterministic abstract for the Study browser flow.', 'arXiv', current_date, NULL)
    `;
    await tx`
      INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
      VALUES (${videoResourceId}, ${concept.id}, 'study-e2e', 1, true), (${paperResourceId}, ${concept.id}, 'study-e2e', 1, true)
    `;
    await tx`
      INSERT INTO catalog.collections
        (id, owner_user_id, kind, slug, visibility, title, description, published_at, metadata)
      VALUES
        (${collectionId}, NULL, 'curated', ${`study-e2e-${runKey}`}, 'public', 'A mixed Study collection', 'A deterministic video and paper path.', now(), '{"test":true}'::jsonb)
    `;
    await tx`
      INSERT INTO catalog.collection_sections (id, collection_id, title, description, position)
      VALUES (${collectionSectionId}, ${collectionId}, 'Learn, then investigate', 'The two resource presentations share one context.', 0)
    `;
    await tx`
      INSERT INTO catalog.collection_items (id, section_id, resource_id, position, required, note)
      VALUES
        (${collectionVideoItemId}, ${collectionSectionId}, ${videoResourceId}, 0, true, 'Start with the explanation'),
        (${collectionPaperItemId}, ${collectionSectionId}, ${paperResourceId}, 1, true, 'Read the source paper')
    `;
  });
});

test.afterAll(async () => {
  const db = database;
  if (!db) return;
  const resourceIds = [videoResourceId, paperResourceId];
  const users = await db<{ id: string }[]>`SELECT id FROM identity.users WHERE email = ${email}`;
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    await db`DELETE FROM ops.outbox_events WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM ops.idempotency_records WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM activity.activity_events WHERE user_id IN ${db(userIds)} OR resource_id IN ${db(resourceIds)}`;
    await db`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.user_resource_progress WHERE user_id IN ${db(userIds)} OR resource_id IN ${db(resourceIds)}`;
    await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)}) OR resource_id IN ${db(resourceIds)}`;
    await db`DELETE FROM study.study_sessions WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM catalog.collection_enrollments WHERE user_id IN ${db(userIds)} AND collection_id = ${collectionId}`;
    await db`DELETE FROM discovery.discovery_interactions WHERE user_id IN ${db(userIds)} OR resource_id IN ${db(resourceIds)}`;
    await db`DELETE FROM discovery.user_concept_affinity WHERE user_id IN ${db(userIds)}`;
  }
  const runRows = await db<{ id: string }[]>`
    SELECT DISTINCT recommendation_run_id AS id
    FROM discovery.recommendation_candidates
    WHERE resource_id IN ${db(resourceIds)}
    UNION
    SELECT id FROM discovery.recommendation_runs WHERE user_id IN ${db(userIds)}
  `;
  if (runRows.length > 0) {
    const runIds = runRows.map((row) => row.id);
    await db`DELETE FROM discovery.discovery_interactions WHERE impression_id IN (SELECT id FROM discovery.recommendation_impressions WHERE recommendation_run_id IN ${db(runIds)})`;
    await db`DELETE FROM discovery.recommendation_impressions WHERE recommendation_run_id IN ${db(runIds)}`;
    await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN ${db(runIds)}`;
    await db`DELETE FROM discovery.recommendation_runs WHERE id IN ${db(runIds)}`;
  }
  await db`DELETE FROM catalog.library_items WHERE resource_id IN ${db(resourceIds)}`;
  await db`DELETE FROM catalog.collection_items WHERE id IN ${db([collectionVideoItemId, collectionPaperItemId])}`;
  await db`DELETE FROM catalog.collection_sections WHERE id = ${collectionSectionId}`;
  await db`DELETE FROM catalog.collections WHERE id = ${collectionId}`;
  await db`DELETE FROM catalog.resource_concepts WHERE resource_id IN ${db(resourceIds)}`;
  await db`DELETE FROM catalog.video_details WHERE resource_id = ${videoResourceId}`;
  await db`DELETE FROM catalog.paper_details WHERE resource_id = ${paperResourceId}`;
  await db`DELETE FROM catalog.resources WHERE id IN ${db(resourceIds)}`;
  if (userIds.length > 0) await db`DELETE FROM identity.users WHERE id IN ${db(userIds)}`;
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
  const search = page.getByPlaceholder("Search topics, skills, or domains");
  for (const [term, label] of [["AI", /AI \/ Machine Learning/], ["Python", "Python skill"], ["React", "React skill"]] as const) {
    await search.fill(term);
    await page.getByRole("button", { name: label }).click();
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Clear explanations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I know the basics" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

function sessionRoute(kind: "video" | "paper", sessionId: string): string {
  return `/app/study/${kind}/${sessionId}`;
}

test("E2E A — video Study starts internally, persists progress, and resumes from Sessions", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Study Browser Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  await page.getByRole("link", { name: "Open verification link" }).click();
  await completeOnboarding(page);
  await page.goto("/app");

  await page.getByRole("button", { name: "Start learning" }).click();
  const learnInput = page.getByLabel("What do you want to learn?");
  await learnInput.fill(`https://www.youtube.com/watch?v=${youtubeId}`);
  await learnInput.press("Enter");
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app\/study\/video\/[0-9a-f-]+$/);
  videoSessionId = page.url().split("/").at(-1) ?? null;
  if (!videoSessionId) throw new Error("video Study session ID was not captured");
  await expect(page.getByText("Learning context preparing")).toBeVisible();

  const progressResponse = await page.request.post(`/api/v1/study-sessions/${videoSessionId}/progress`, {
    headers: { origin: "http://localhost:3101" },
    data: { resourceId: videoResourceId, progressPct: 25, anchor: { kind: "video", positionMs: 150000 }, event: "checkpoint", idempotencyKey: `e2e-progress-${randomUUID()}` },
  });
  expect(progressResponse.status()).toBe(200);
  await page.reload();
  await expect(page.locator(".study-hero-progress").getByText("25%", { exact: true })).toBeVisible();

  await page.goto("/app/sessions");
  const session = page.locator("article.session-row").filter({ hasText: "A deterministic Study video" });
  await expect(session).toContainText("25%");
  await session.getByRole("link", { name: /Continue/ }).click();
  await expect(page).toHaveURL(sessionRoute("video", videoSessionId));
  await expect(page.locator(".study-hero-progress").getByText("25%", { exact: true })).toBeVisible();
});

test("E2E player error — unavailable embeds keep the StudySession usable", async ({ page }) => {
  if (!videoSessionId) throw new Error("video Study session is required for player error E2E");
  await page.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.YT={Player:class{constructor(element,options){setTimeout(()=>options.events.onError({data:150}),0)}destroy(){}}};window.onYouTubeIframeAPIReady();",
  }));
  await login(page);
  await page.goto(sessionRoute("video", videoSessionId));
  await expect(page.getByText("This video can't be played inside LearnSpace.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open on YouTube" })).toBeVisible();
  await page.goto("/app/sessions");
  await expect(page.locator("article.session-row").filter({ hasText: "A deterministic Study video" })).toBeVisible();
});

test("E2E B — Research opens Paper Study and preserves save and reading position", async ({ page }) => {
  await login(page);
  await page.goto(`/app/research?q=${encodeURIComponent("A deterministic Study paper")}`);
  const paper = page.locator("article.research-card").filter({ hasText: "A deterministic Study paper" }).first();
  await expect(paper).toBeVisible();
  await paper.getByRole("button", { name: "Save" }).click();
  await expect(paper.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.goto("/app/library");
  const savedRow = page.locator("article.saved-resource-row").filter({ hasText: "A deterministic Study paper" });
  await expect(savedRow.getByRole("button", { name: "Unsave" })).toBeVisible();
  const unsaveResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/library") && response.request().method() === "POST");
  await savedRow.getByRole("button", { name: "Unsave" }).click();
  expect((await unsaveResponse).status()).toBe(200);
  await page.goto("/app/library");
  await expect(page.locator("article.saved-resource-row").filter({ hasText: "A deterministic Study paper" })).toHaveCount(0);
  await page.goto(`/app/research?q=${encodeURIComponent("A deterministic Study paper")}`);
  const paperAfterUnsave = page.locator("article.research-card").filter({ hasText: "A deterministic Study paper" }).first();
  await paperAfterUnsave.getByRole("button", { name: "Save" }).click();
  await expect(paperAfterUnsave.getByRole("button", { name: "Saved" })).toBeVisible();
  await paperAfterUnsave.getByRole("button", { name: "Study paper" }).click();
  await expect(page).toHaveURL(/\/app\/study\/paper\/[0-9a-f-]+$/);
  await expect(page.getByText("Paper source unavailable")).toBeVisible();
  const pageInput = page.getByRole("spinbutton");
  await pageInput.fill("2");
  await page.getByRole("button", { name: "Save position" }).click();
  await expect(page.getByText("Reading position saved")).toBeVisible();
});

test("E2E C — related paper and video switch presentation while retaining one session", async ({ page }) => {
  if (!videoSessionId) throw new Error("video Study session is required for cross-resource E2E");
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  await login(page);
  await page.goto(sessionRoute("video", videoSessionId));
  const relatedPaper = page.locator("button.related-resource").filter({ hasText: "A deterministic Study paper" });
  await expect(relatedPaper).toBeVisible();
  await relatedPaper.click();
  await expect(page).toHaveURL(sessionRoute("paper", videoSessionId));
  await expect(page.getByLabel("Study context").getByText("Opened from: A deterministic Study video")).toBeVisible();

  const paperPage = page.getByRole("spinbutton");
  await paperPage.fill("4");
  await page.getByRole("button", { name: "Save position" }).click();
  await expect(page.getByText("Reading position saved")).toBeVisible();

  await page.getByRole("button", { name: /Return to video/ }).click();
  await expect(page).toHaveURL(sessionRoute("video", videoSessionId));
  await page.getByRole("button", { name: "Session materials" }).click();
  await page.getByRole("dialog", { name: "Session materials" }).getByRole("button").filter({ hasText: "A deterministic Study paper" }).click();
  await expect(page).toHaveURL(sessionRoute("paper", videoSessionId));
  await expect(page.getByRole("spinbutton")).toHaveValue("4");
  await page.goto(sessionRoute("video", videoSessionId));
  await expect(page).toHaveURL(sessionRoute("paper", videoSessionId));
});

test("E2E D — Library opens a mixed collection and launches its current item", async ({ page }) => {
  if (!videoSessionId) throw new Error("video Study session is required for collection E2E");
  await login(page);
  await page.goto("/app/library");
  const collection = page.locator("article.collection-card").filter({ hasText: "A mixed Study collection" });
  await expect(collection).toBeVisible();
  await collection.getByRole("link", { name: "A mixed Study collection" }).click();
  await expect(page).toHaveURL(`/app/library/collections/${collectionId}`);
  const collectionDetail = page.locator("main.collection-detail-page");
  await expect(collectionDetail.getByText("A deterministic Study video")).toBeVisible();
  await expect(collectionDetail.getByText("A deterministic Study paper")).toBeVisible();
  await page.getByRole("button", { name: "Start collection" }).click();
  await expect(page).toHaveURL(sessionRoute("video", videoSessionId));
});

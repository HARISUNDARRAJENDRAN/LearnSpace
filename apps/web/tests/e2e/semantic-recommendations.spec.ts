import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { closeRecommendationRedis, invalidateRecommendations } from "@learnspace/shared/recommendation-cache";

test("signup → interests → Discover preview → full feed → topic controls → persistent learning shift", async ({ page }) => {
  const db = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false });
  const worker = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false });
  const workerModules = "../../../../services/worker/dist/";
  const { projectRecommendationProfiles } = await import(`${workerModules}recommendation-profiles.js`);
  const resources: string[] = [];
  const email = `semantic-browser-${randomUUID()}@example.test`;
  let userId: string | null = null;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const concepts = await db<{ id: string; slug: string }[]>`SELECT id, slug FROM knowledge.concepts WHERE slug IN ('python','ai-machine-learning','physics')`;
    const ai = concepts.find((c) => c.slug === "ai-machine-learning")!.id;
    const physics = concepts.find((c) => c.slug === "physics")!.id;
    for (let i = 0; i < 30; i++) {
      const id = randomUUID(), youtubeId = id.replaceAll("-", "").slice(0, 11); resources.push(id);
      await db`INSERT INTO catalog.resources (id,type,provider,external_id,title,canonical_url,visibility,status,quality_score,metadata) VALUES (${id},'video','youtube',${youtubeId},${`Browser semantic lesson ${i}`},${`https://youtube.com/watch?v=${youtubeId}`},'public','ready',0.99,'{"test":true,"estimatedLevel":"intermediate"}'::jsonb)`;
      await db`INSERT INTO catalog.video_details (resource_id,youtube_id,channel_title,duration_ms) VALUES (${id},${youtubeId},${`Browser channel ${i % 10}`},600000)`;
      await db`INSERT INTO catalog.resource_concepts (resource_id,concept_id,source,relevance,is_primary) VALUES (${id},${i < 24 ? ai : physics},'browser-test',1,true)`;
    }
    await page.setExtraHTTPHeaders({ "x-real-ip": randomUUID() });
    await page.goto("/register");
    await page.getByLabel("Your name").fill("Semantic Browser Learner");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("semantic-browser-password-123");
    await page.getByLabel("Confirm password").fill("semantic-browser-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/verify-email/);
    await page.getByRole("link", { name: "Open verification link" }).click();
    await expect(page.locator("[data-onboarding-hydrated]")).toHaveAttribute("data-onboarding-hydrated", "true");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: "Student" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Coursework" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    const search = page.getByPlaceholder("Search topics, skills, or domains");
    for (const [query, label] of [["AI", /AI \/ Machine Learning/], ["Python", "Python skill"], ["React", "React skill"]] as const) {
      await search.fill(query); await page.getByRole("button", { name: label }).click();
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Clear explanations" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "I know the basics" }).click();
    await page.getByRole("button", { name: "Start learning" }).click();
    await expect(page).toHaveURL(/\/app/);
    userId = (await db<{ id: string }[]>`SELECT id FROM identity.users WHERE email = ${email}`)[0]!.id;
    await projectRecommendationProfiles(worker, null, [userId]);
    await page.goto("/app/discover");
    const preview = page.locator("section[aria-labelledby='discover-recommended-heading'] article.discovery-card");
    await expect(preview).toHaveCount(6);
    const previewTitles = await preview.locator("h3").allTextContents();
    await page.getByRole("link", { name: "See all recommendations" }).click();
    await expect(page).toHaveURL(/\/app\/discover\/for-you$/);
    await expect(page.getByRole("heading", { name: "Recommended for you", level: 1 })).toBeVisible();
    const full = page.locator("article.discovery-card");
    await expect(full).toHaveCount(24);
    expect((await full.locator("h3").allTextContents()).slice(0, 6)).toEqual(previewTitles);
    const firstResponse = await page.request.get("/api/v1/discovery/explore");
    expect(firstResponse.ok()).toBe(true);
    expect(firstResponse.headers()["server-timing"]).toContain("total;dur=");
    const first = await firstResponse.json();
    const second = await (await page.request.get("/api/v1/discovery/explore")).json();
    expect(second.runId).toBe(first.runId);
    expect(JSON.stringify(second)).not.toMatch(/longTermVector|recentVector|positiveWeight|featureSnapshots|"score"/);
    const httpHits: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const response = await page.request.get("/api/v1/discovery/explore");
      expect(response.ok()).toBe(true);
      await response.body();
      httpHits.push(performance.now() - started);
    }
    await invalidateRecommendations(userId);
    const missStart = performance.now();
    const miss = await page.request.get("/api/v1/discovery/explore");
    expect(miss.ok()).toBe(true);
    await miss.body();
    await mkdir("../../docs/benchmarks", { recursive: true });
    await writeFile("../../docs/benchmarks/semantic-http.json", JSON.stringify({ mode: process.env.PLAYWRIGHT_E2E_SERVER ?? "development", cacheHitSamplesMs: httpHits, cacheMissMs: performance.now() - missStart, serverTiming: miss.headers()["server-timing"] }, null, 2));
    await page.getByRole("navigation", { name: "Recommendation topics" }).getByRole("link", { name: "AI / Machine Learning", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`topic=${ai}`));
    expect((await page.request.get("/api/v1/discovery/explore?topic=invalid")).status()).toBe(400);
    for (let i = 0; i < 16; i++) await db`INSERT INTO activity.activity_events (schema_version,user_id,resource_id,event_type,actor_type,source,occurred_at,idempotency_key,payload) VALUES (1,${userId},${resources[24 + i % 6]!},'resource.completed','user','browser-test',now(),${randomUUID()},'{"progressPct":95,"watchedSeconds":570}'::jsonb)`;
    await projectRecommendationProfiles(worker, null, [userId]);
    await page.goto("/app/discover/for-you");
    await expect(page.getByRole("navigation", { name: "Recommendation topics" }).getByRole("link", { name: "Physics", exact: true })).toBeVisible();
    await expect(page.getByText("Shaped by what you've been learning", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Recommendation topics" }).getByRole("link", { name: "Physics", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`topic=${physics}`));
    await expect(full.first()).toBeVisible();
    expect(await full.count()).toBeGreaterThanOrEqual(process.env.PLAYWRIGHT_E2E_SERVER === "production" ? 1 : 6);
    expect(await full.count()).toBeLessThanOrEqual(24);
    const focusedResponse = await (await page.request.get(`/api/v1/discovery/explore?topic=${physics}`)).json();
    const focusedIds = focusedResponse.sections.recommendedVideos.map((card: { resourceId: string }) => card.resourceId);
    const grounded = await db`SELECT DISTINCT resource_id FROM catalog.resource_concepts WHERE resource_id = ANY(${focusedIds}::uuid[]) AND concept_id = ${physics}`;
    expect(grounded.length).toBe(focusedIds.length);
    if (process.env.PLAYWRIGHT_E2E_SERVER === "production") {
      expect(focusedIds.every((id: string) => !resources.includes(id))).toBe(true);
      expect((await page.request.get("/api/v1/discovery/debug")).status()).toBe(404);
    }
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { timeout: 5000 }).toBe(true);
    }
    for (let i = 0; i < await full.count(); i++) {
      const thumbnail = full.nth(i).locator("img");
      if (await thumbnail.count()) {
        await thumbnail.scrollIntoViewIfNeeded();
        await thumbnail.evaluate((image: HTMLImageElement) => image.decode().catch(() => {}));
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "../../docs/benchmarks/recommendations-mobile.png", fullPage: true });
    await page.getByRole("link", { name: "Back to Discover" }).click();
    await expect(page).toHaveURL(/\/app\/discover$/);
    expect(errors).toEqual([]);
  } catch (error) { console.error("semantic browser failure", error); throw error; } finally {
    try {
      if (userId) {
        await db`DELETE FROM discovery.discovery_interactions WHERE user_id = ${userId}`;
        await db`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${userId}`;
        await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${userId})`;
        await db`DELETE FROM discovery.recommendation_runs WHERE user_id = ${userId}`;
        await db`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
        await db`DELETE FROM ops.outbox_events WHERE user_id = ${userId}`;
        await db`DELETE FROM agent.agent_artifacts WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${userId})`;
        await db`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${userId})`;
        await db`DELETE FROM agent.tool_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${userId})`;
        await db`DELETE FROM agent.agent_steps WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${userId})`;
        await db`DELETE FROM agent.agent_runs WHERE user_id = ${userId}`;
        await db`DELETE FROM identity.users WHERE id = ${userId}`;
      }
      await db`DELETE FROM catalog.resource_concepts WHERE resource_id = ANY(${resources}::uuid[])`;
      await db`DELETE FROM catalog.video_details WHERE resource_id = ANY(${resources}::uuid[])`;
      await db`DELETE FROM catalog.resources WHERE id = ANY(${resources}::uuid[])`;
    } finally { await Promise.all([db.end(), worker.end(), closeRecommendationRedis()]); }
  }
});

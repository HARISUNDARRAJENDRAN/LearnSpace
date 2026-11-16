import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { cleanupHomeFixture, type HomeFixture, seedHomeFixture } from "./home-fixture";

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
test.skip(!databaseUrl, "requires the CI database environment");

let database: ReturnType<typeof postgres> | null = null;
let fixture: HomeFixture | null = null;
let videoId = "";
let paperId = "";
let authorId = "";
let searchTerm = "";

test.beforeAll(async () => {
  database = postgres(databaseUrl as string, { max: 1, prepare: false, connect_timeout: 10 });
  const seededFixture = await seedHomeFixture(database, false);
  fixture = seededFixture;
  videoId = randomUUID();
  paperId = randomUUID();
  authorId = randomUUID();
  searchTerm = `modeleak${randomUUID().replaceAll("-", "")}`;
  await database.begin(async (tx) => {
    const video = `https://www.youtube.com/watch?v=${randomUUID().replaceAll("-", "").slice(0, 11)}`;
    await tx`INSERT INTO catalog.resources (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
      VALUES (${videoId}, 'video', 'youtube', ${video.slice(-11)}, ${video}, ${`${searchTerm} video`}, ${`Learn content ${searchTerm}`}, 'public', 'ready', 0.9, '{"test":true}'::jsonb)`;
    await tx`INSERT INTO catalog.resources (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
      VALUES (${paperId}, 'paper', 'arxiv', ${searchTerm}, ${`https://arxiv.org/abs/9999.${searchTerm.slice(-5)}`}, ${`${searchTerm} paper`}, ${`Research content ${searchTerm}`}, 'public', 'ready', 0.9, '{"test":true}'::jsonb)`;
    await tx`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract) VALUES (${paperId}, ${`9999.${searchTerm.slice(-5)}`}, ${`Abstract about ${searchTerm}`})`;
    await tx`INSERT INTO catalog.authors (id, normalized_name, preferred_name) VALUES (${authorId}, ${`${searchTerm} author`.toLowerCase()}, ${`${searchTerm} Author`})`;
    await tx`INSERT INTO catalog.paper_authors (paper_resource_id, author_id, ordinal) VALUES (${paperId}, ${authorId}, 0)`;
    await tx`INSERT INTO study.study_sessions (user_id, title, mode, status, active_resource_id) VALUES
      (${seededFixture.userId}, ${`${searchTerm} learn session`}, 'guided_learning', 'active', ${videoId}),
      (${seededFixture.userId}, ${`${searchTerm} research session`}, 'research', 'active', ${paperId})`;
  });
});

test.afterAll(async () => {
  const db = database;
  if (!db) return;
  if (fixture) await cleanupHomeFixture(db, fixture);
  if (paperId) {
    await db`DELETE FROM catalog.paper_authors WHERE paper_resource_id = ${paperId}`;
    if (authorId) await db`DELETE FROM catalog.authors WHERE id = ${authorId}`;
    await db`DELETE FROM catalog.paper_details WHERE resource_id = ${paperId}`;
    await db`DELETE FROM catalog.resources WHERE id IN (${videoId}, ${paperId})`;
  }
  await db.end({ timeout: 5 });
  database = null;
});

test("search stays in its mode at the API, UI, and during rapid mode changes", async ({ page }) => {
  if (!fixture) throw new Error("Search fixture was not seeded");
  await page.context().addCookies([{ name: sessionCookieName, value: fixture.sessionToken, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);

  const learnResponse = await page.request.get(`/api/v1/search?mode=learn&q=${searchTerm}`);
  expect(learnResponse.status()).toBe(200);
  const learn = await learnResponse.json() as { mode: string; results: { id: string; resourceType: string | null; kind: string }[] };
  expect(learn.mode).toBe("learn");
  expect(learn.results.some((result) => result.id === videoId)).toBe(true);
  expect(learn.results.some((result) => result.id === paperId || result.resourceType === "paper")).toBe(false);
  expect(learn.results.some((result) => result.kind === "session" && result.resourceType === "paper")).toBe(false);

  const researchResponse = await page.request.get(`/api/v1/search?mode=research&q=${searchTerm}`);
  expect(researchResponse.status()).toBe(200);
  const research = await researchResponse.json() as { mode: string; results: { id: string; resourceType: string | null; kind: string }[] };
  expect(research.mode).toBe("research");
  expect(research.results.some((result) => result.id === paperId)).toBe(true);
  expect(research.results.some((result) => result.id === authorId && result.kind === "author")).toBe(true);
  expect((research.results.find((result) => result.id === authorId) as { href?: string } | undefined)?.href).toBe(`/app/research/authors/${authorId}`);
  expect(research.results.some((result) => result.id === videoId || result.resourceType === "video")).toBe(false);
  expect(research.results.some((result) => result.kind === "session" && result.resourceType === "video")).toBe(false);

  await page.goto("/app/discover");
  const input = page.getByRole("combobox", { name: "Search LearnSpace" });
  await input.fill(searchTerm);
  const resources = page.getByRole("group", { name: "Resources" });
  await expect(resources.getByRole("option", { name: new RegExp(`${searchTerm} video`) })).toBeVisible();
  await expect(resources.getByRole("option", { name: new RegExp(`${searchTerm} paper`) })).toHaveCount(0);
  await page.getByRole("button", { name: "Switch mode (currently learn)" }).click();
  await page.getByRole("menuitemradio", { name: "Research" }).click();
  await input.focus();
  await expect(input).toHaveAttribute("placeholder", "Search papers and sessions");
  const papers = page.getByRole("group", { name: "Papers" });
  await expect(papers.getByRole("option").filter({ has: page.getByText(`${searchTerm} paper`, { exact: true }) })).toBeVisible();
  await expect(page.getByRole("option", { name: new RegExp(`${searchTerm} video`) })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Search the web for papers" })).toBeVisible();
  await page.getByRole("option", { name: "Search the web for papers" }).click();
  const sourceDiscovery = page.getByRole("dialog");
  await expect(sourceDiscovery.getByRole("textbox", { name: "What do you want to research?" })).toBeVisible();
  await sourceDiscovery.getByRole("button", { name: "Close source discovery" }).click();
  await input.focus();

  const firstQuery = `late${randomUUID().replaceAll("-", "")}`;
  const secondQuery = `fast${randomUUID().replaceAll("-", "")}`;
  let firstLearnStarted!: () => void;
  const firstLearnStartedPromise = new Promise<void>((resolve) => { firstLearnStarted = resolve; });
  await page.route("**/api/v1/search?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const requestedMode = params.get("mode");
    const requestedQuery = params.get("q");
    if (requestedMode === "learn" && requestedQuery === firstQuery) {
      firstLearnStarted();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        await route.fulfill({ json: { mode: "learn", results: [{ id: "stale-learn", kind: "resource", title: "STALE LEARN RESULT", subtitle: "", href: null, resourceId: "stale-learn", resourceType: "video" }] } });
      } catch {
        // The component aborts the request when its query or mode changes.
      }
      return;
    }
    const researchMode = requestedMode === "research";
    await route.fulfill({ json: { mode: requestedMode, results: [{ id: researchMode ? "current-research" : "current-learn", kind: "resource", title: researchMode ? "CURRENT RESEARCH RESULT" : "CURRENT LEARN RESULT", subtitle: "", href: null, resourceId: "current", resourceType: researchMode ? "paper" : "video" }] } });
  });

  await page.getByRole("button", { name: "Switch mode (currently research)" }).click();
  await page.getByRole("menuitemradio", { name: "Learn" }).click();
  await input.fill(firstQuery);
  await firstLearnStartedPromise;
  await input.fill(secondQuery);
  await expect(page.getByRole("option", { name: "CURRENT LEARN RESULT" })).toBeVisible();
  await page.getByRole("button", { name: "Switch mode (currently learn)" }).click();
  await page.getByRole("menuitemradio", { name: "Research" }).click();
  await input.focus();
  await expect(page.getByRole("option", { name: "CURRENT RESEARCH RESULT", exact: true })).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.getByRole("option", { name: "STALE LEARN RESULT" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "CURRENT RESEARCH RESULT" })).toBeVisible();
});

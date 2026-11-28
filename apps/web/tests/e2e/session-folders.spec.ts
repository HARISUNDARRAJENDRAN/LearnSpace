import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const materials = [
  { title: "JEPA research session", type: "paper", question: "How does JEPA predict representations?" },
  { title: "Dreamer research session", type: "paper", question: "What does Dreamer learn in its latent world?" },
  { title: "World models lecture", type: "video", question: "How does planning use the world model?" },
] as const;

test("folders open a shared canvas for papers and videos across modes and browser sessions", async ({ page, browser, baseURL }) => {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url || !baseURL) throw new Error("Folder E2E requires the test database and application URL");
  const db = postgres(url, { max: 1 });
  const userId = randomUUID();
  const token = randomUUID() + randomUUID();
  const fixtures = materials.map((item) => ({ ...item, resourceId: randomUUID(), sessionId: randomUUID(), threadId: randomUUID() }));
  const resourceIds = fixtures.map((item) => item.resourceId);
  const sessionIds = fixtures.map((item) => item.sessionId);
  const screenshots = process.env.LEARNSPACE_FOLDER_SCREENSHOTS;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => { if (event.type() === "error" && /hydrat/i.test(event.text())) errors.push(event.text()); });
  const context = page.context();
  await context.addCookies([{ name: "learnspace_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  await page.route("https://i.ytimg.com/vi/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#162530"/><path d="m206 90 0 90 72-45Z" fill="#fff"/></svg>',
  }));
  try {
    await db`INSERT INTO identity.users (id, email, display_name, email_verified, status) VALUES (${userId}, ${`folders-e2e-${userId}@example.test`}, 'Researcher', true, 'active')`;
    await db`INSERT INTO identity.user_settings (user_id, onboarding_completed_at, first_application_visit_at) VALUES (${userId}, now(), now())`;
    await db`INSERT INTO identity.auth_sessions (user_id, rotation_family_id, refresh_token_hash, expires_at)
      VALUES (${userId}, ${randomUUID()}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day')`;
    for (const fixture of fixtures) {
      const video = fixture.type === "video";
      const externalId = video ? `f${userId.replaceAll("-", "").slice(0, 10)}` : fixture.resourceId;
      const source = video ? `https://www.youtube.com/watch?v=${externalId}` : "https://arxiv.org/abs/2301.00001";
      await db`INSERT INTO catalog.resources (id, type, provider, external_id, title, canonical_url, visibility, status)
        VALUES (${fixture.resourceId}, ${fixture.type}, ${video ? "youtube" : "arxiv"}, ${externalId}, ${fixture.title}, ${source}, 'public', 'ready')`;
      if (video) await db`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${fixture.resourceId}, ${externalId}, 300000)`;
      else await db`INSERT INTO catalog.paper_details (resource_id, arxiv_id) VALUES (${fixture.resourceId}, ${externalId})`;
      await db`INSERT INTO study.study_sessions (id, user_id, title, mode, active_resource_id, active_anchor)
        VALUES (${fixture.sessionId}, ${userId}, ${fixture.title}, ${video ? "guided_learning" : "research"}, ${fixture.resourceId},
          ${db.json(video ? { kind: "video", positionMs: 78000 } : { kind: "paper", page: 4 })})`;
      await db`INSERT INTO study.session_resources (study_session_id, resource_id, role, added_by, binding_status, last_anchor)
        VALUES (${fixture.sessionId}, ${fixture.resourceId}, 'primary', 'user', 'preparing',
          ${db.json(video ? { kind: "video", positionMs: 78000 } : { kind: "paper", page: 4 })})`;
      await db`INSERT INTO study.tutor_threads (id, user_id, study_session_id, resource_id, mode)
        VALUES (${fixture.threadId}, ${userId}, ${fixture.sessionId}, ${fixture.resourceId}, 'test')`;
      await db`INSERT INTO study.tutor_messages (thread_id, actor_type, content_text) VALUES (${fixture.threadId}, 'user', ${fixture.question})`;
      await db`INSERT INTO study.video_notes (user_id, resource_id, revision, blocks) VALUES (${userId}, ${fixture.resourceId}, 1,
        ${db.json([{ id: "project-note", type: "paragraph", text: `Notes from ${fixture.title}`, by: "you", rev: 1, done: false }])})`;
    }
    const video = fixtures[2]!;
    await db`INSERT INTO study.session_transcript (study_session_id, user_id, resource_id, speaker, text)
      VALUES (${video.sessionId}, ${userId}, ${video.resourceId}, 'you', 'Compare rollout error to the paper.')`;
    await db`UPDATE study.study_sessions SET workspace = '{"code":{"language":"python","code":"print(42)"}}' WHERE id = ${video.sessionId}`;

    const retired = await page.goto("/app/sessions");
    expect(retired?.status()).toBe(404);
    await page.goto("/app/research");
    const main = page.locator(".folder-workspace");
    const navigation = page.getByRole("complementary", { name: "Application navigation" });
    await expect(navigation.getByRole("link", { name: fixtures[0]!.title }).first()).toBeVisible();
    const create = navigation.getByRole("region", { name: "Folders" }).getByRole("button", { name: "New folder", exact: true });
    await expect(create).toBeVisible();
    await create.click();
    await expect(page.getByRole("textbox", { name: "Folder name" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(create).toBeFocused();
    await create.click();
    await page.getByRole("textbox", { name: "Folder name" }).fill("World Models Research");
    await page.getByRole("textbox", { name: "Description" }).fill("Compare representation learning, imagination, and model-based planning.");
    await page.getByRole("button", { name: "Create folder", exact: true }).click();
    await expect(main.getByRole("heading", { name: "World Models Research" })).toBeVisible();
    const folderUrl = page.url();
    const folderId = new URL(folderUrl).pathname.split("/").at(-1);
    if (!folderId) throw new Error("Folder route has no id");
    const folderThreadId = randomUUID();
    await db`INSERT INTO study.study_sessions (id, user_id, title, mode, metadata)
      VALUES (${folderId}, ${userId}, 'World Models Research', 'guided_learning', '{"folderWorkspace":true}') ON CONFLICT DO NOTHING`;
    await db`INSERT INTO study.tutor_threads (id, user_id, study_session_id, mode) VALUES (${folderThreadId}, ${userId}, ${folderId}, 'folder_tutor')`;
    await db`INSERT INTO study.tutor_messages (thread_id, actor_type, content_text, content)
      VALUES (${folderThreadId}, 'user', 'What connects these materials?', '{}'),
        (${folderThreadId}, 'assistant', 'They share a predictive-learning objective.', ${db.json({
          outcome: "answer",
          blocks: [{ type: "text", id: "b0", text: "They share a predictive-learning objective.", src: [0], basis: "source" }],
          sources: [{ chunkId: randomUUID(), startMs: null, endMs: null, excerpt: "Grounded evidence", resource: { id: fixtures[0]!.resourceId, title: "Hidden citation title" } }],
          followUps: [], interactions: {},
        })})`;
    const board = main.getByRole("region", { name: "Learning Canvas" });
    await expect(board.getByText("Add a YouTube video or research paper to start studying.")).toBeVisible();
    await expect(main.getByRole("link", { name: "Overview" })).toHaveCount(0);
    await main.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(main.getByText("Add material to start taking notes.")).toBeVisible();
    await main.getByRole("button", { name: "AI", exact: true }).click();
    await expect(main.getByText("Ask about your folder")).toBeVisible();
    await expect(main.getByText("They share a predictive-learning objective.")).toBeVisible();
    await expect(main.locator(".folder-workspace-panel .tutor-cite, .folder-workspace-panel .chat-sources-toggle")).toHaveCount(0);

    await main.getByRole("button", { name: "Add content", exact: true }).first().click();
    const discovery = page.getByRole("dialog", { name: "Add content" });
    await discovery.getByLabel("Source type").selectOption("research");
    await expect(discovery.getByRole("button", { name: "arXiv / DOI" })).toBeVisible();
    await discovery.getByLabel("Source type").selectOption("learn");
    await expect(discovery.getByRole("button", { name: "YouTube URL" })).toBeVisible();
    const youtubeUrl = `https://www.youtube.com/watch?v=f${userId.replaceAll("-", "").slice(0, 10)}`;
    await page.route("**/api/v1/source-discovery/resolve", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ mode: "learn", url: youtubeUrl });
      await route.fulfill({ json: { preview: {
        resourceId: video.resourceId, mode: "learn", provider: "youtube", title: video.title,
        canonicalUrl: youtubeUrl, durationMs: 300000,
      } } });
    });
    await discovery.getByRole("button", { name: "YouTube URL" }).click();
    await discovery.getByRole("textbox", { name: "YouTube URL" }).fill(youtubeUrl);
    await discovery.getByRole("button", { name: "Resolve source" }).click();
    await discovery.getByRole("button", { name: "Add to folder" }).click();
    await expect(discovery.getByRole("button", { name: "Added", exact: true })).toBeDisabled();
    await discovery.getByRole("button", { name: "Browse LearnSpace" }).click();
    const picker = page.getByRole("dialog", { name: "Add content" });
    for (const fixture of fixtures.filter((item) => item.type === "paper")) {
      await picker.getByRole("button", { name: `Add ${fixture.title}`, exact: true }).click();
      await expect(picker.getByRole("button", { name: `${fixture.title} added` })).toBeDisabled();
    }
    await picker.getByRole("button", { name: "Videos", exact: true }).click();
    await picker.getByRole("searchbox", { name: "Search videos" }).fill(video.title);
    await picker.getByRole("button", { name: "Search", exact: true }).click();
    await picker.getByRole("button", { name: `Add ${video.title}`, exact: true }).first().click();
    await expect(picker.getByRole("button", { name: `${video.title} added` }).first()).toBeDisabled();
    await picker.getByRole("button", { name: "Done" }).click();
    const card = (title: string) => board.getByRole("button", { name: title, exact: true });
    for (const fixture of fixtures) await expect(card(fixture.title)).toBeVisible();
    await expect(board.locator(".course-node-paper")).toHaveCount(2);
    await expect(board.locator(".course-node-media.is-video img[src*='ytimg.com']")).toBeVisible();
    const zoom = board.getByRole("toolbar", { name: "Zoom" });
    const initialZoom = await zoom.getByRole("button", { name: "Reset zoom to 100%" }).textContent();
    await zoom.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom.getByRole("button", { name: "Reset zoom to 100%" })).not.toHaveText(initialZoom!);
    await zoom.getByRole("button", { name: "Zoom to fit" }).click();
    await expect(main.getByText("Ask about your folder")).toBeVisible();
    await main.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(main.getByText(`Notes from ${fixtures[0]!.title}`)).toBeVisible();
    await main.getByLabel("Notes for").selectOption(video.resourceId);
    await expect(main.getByText(`Notes from ${video.title}`)).toBeVisible();
    await expect(main.getByText(`Notes from ${fixtures[0]!.title}`)).toHaveCount(0);
    await main.getByRole("button", { name: "AI", exact: true }).click();
    await expect.poll(() => card(video.title).evaluate((element) => {
      const cardBox = element.getBoundingClientRect();
      const canvasBox = element.closest(".session-canvas")?.getBoundingClientRect();
      return Boolean(canvasBox && cardBox.right > canvasBox.left && cardBox.left < canvasBox.right && cardBox.bottom > canvasBox.top && cardBox.top < canvasBox.bottom);
    })).toBe(true);
    await main.getByRole("button", { name: "Check", exact: true }).click();
    await expect(main.getByRole("complementary", { name: "Check" })).toBeVisible();
    await main.getByRole("button", { name: "Check", exact: true }).click();
    await card(video.title).click();
    await expect(page).toHaveURL(new RegExp(`/study/video/${video.sessionId}\\?folder=${folderId}`));
    await page.getByRole("link", { name: "Back to folder" }).click();
    await expect(card(video.title)).toBeVisible();
    const tree = page.getByRole("region", { name: "Folders" });
    await expect(tree.getByRole("link", { name: "World Models Research" })).toBeVisible();
    for (const fixture of fixtures) await expect(tree.getByRole("link", { name: fixture.title, exact: true })).toHaveCount(0);
    if (screenshots) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: join(screenshots, "world-models-folder.png"), animations: "disabled" });
    }

    await page.getByRole("button", { name: "Switch mode (currently research)" }).click();
    await page.getByRole("menuitemradio", { name: "Learn" }).click();
    await expect(page).toHaveURL(new RegExp(`/folders/${folderId}$`));
    await expect(card(video.title)).toBeVisible();
    await page.reload();
    await expect(card(video.title)).toBeVisible();

    const fresh = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 1000 }, reducedMotion: "reduce" });
    try {
      const mobile = await fresh.newPage();
      await mobile.goto(folderUrl);
      await expect(mobile.getByRole("region", { name: "Learning Canvas" }).getByText(video.title)).toBeVisible();
      expect(await mobile.locator(".folder-workspace").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (screenshots) await mobile.screenshot({ path: join(screenshots, "world-models-mobile.png"), animations: "disabled" });
    } finally { await fresh.close(); }

    const otherTab = await context.newPage();
    await otherTab.goto(folderUrl);
    await expect(otherTab.getByText(fixtures[1]!.title, { exact: true }).first()).toBeVisible();
    const api = `**/api/v1/session-folders/${folderId}`;
    await page.route(api, async (route) => {
      if (route.request().method() !== "PATCH") await route.continue();
      else await route.fulfill({ status: 409, json: { error: { message: "Simulated concurrent update." } } });
    });
    await board.getByRole("button", { name: `Options for ${fixtures[1]!.title}` }).click();
    await page.getByRole("button", { name: "Unfile session" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Simulated concurrent update." })).toBeVisible();
    await expect(card(fixtures[1]!.title)).toBeVisible();
    await page.unroute(api);
    await page.getByRole("button", { name: "Unfile session" }).click();
    await expect(otherTab.getByRole("region", { name: "Learning Canvas" }).getByText(fixtures[1]!.title, { exact: true })).toHaveCount(0);
    await otherTab.close();

    await main.getByRole("button", { name: "Folder options", exact: true }).click();
    await page.getByRole("button", { name: "Delete folder…", exact: true }).click();
    await page.getByRole("button", { name: "Delete folder", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    expect(await db`SELECT count(*)::int AS count FROM study.study_sessions WHERE user_id = ${userId} AND metadata->>'folderWorkspace' IS DISTINCT FROM 'true'`).toEqual([{ count: 3 }]);
    expect(await db`SELECT count(*)::int AS count FROM study.video_notes WHERE user_id = ${userId}`).toEqual([{ count: 3 }]);
    expect(errors).toEqual([]);
  } finally {
    await db`DELETE FROM study.session_folders WHERE user_id = ${userId}`;
    await db`DELETE FROM ops.outbox_events WHERE user_id = ${userId}`;
    await db`DELETE FROM ops.idempotency_records WHERE user_id = ${userId}`;
    await db`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
    await db`DELETE FROM study.user_resource_progress WHERE user_id = ${userId}`;
    await db`DELETE FROM study.tutor_messages WHERE thread_id IN (SELECT id FROM study.tutor_threads WHERE user_id = ${userId})`;
    await db`DELETE FROM study.tutor_threads WHERE user_id = ${userId}`;
    await db`DELETE FROM study.session_transcript WHERE user_id = ${userId}`;
    await db`DELETE FROM study.video_notes WHERE user_id = ${userId}`;
    await db`DELETE FROM study.session_resources WHERE study_session_id IN ${db(sessionIds)}`;
    await db`DELETE FROM study.study_sessions WHERE user_id = ${userId}`;
    await db`DELETE FROM catalog.video_details WHERE resource_id IN ${db(resourceIds)}`;
    await db`DELETE FROM catalog.paper_details WHERE resource_id IN ${db(resourceIds)}`;
    await db`DELETE FROM catalog.resources WHERE id IN ${db(resourceIds)}`;
    await db`DELETE FROM identity.users WHERE id = ${userId}`;
    await db.end();
  }
});

import { createHash, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { createSession } from "../../lib/auth/repository";

test.describe.configure({ mode: "serial" });

const userId = randomUUID();
const videoId = randomUUID();
const versionId = randomUUID();
const youtubeId = `l${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const lines = [
  "Today we learn gradient descent, a way to minimise a loss function by moving downhill.",
  "Each step moves the weights against the gradient. The learning rate decides how big each step is.",
  "If the learning rate is too large, the steps overshoot the minimum and the loss can blow up.",
  "To recap: the gradient gives the direction and the learning rate gives the size.",
];
let database: ReturnType<typeof postgres> | null = null;
let token = "";
let sessionId = "";

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for Tutor E2E");
  const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  database = db;
  await db.begin(async (tx) => {
    await tx`INSERT INTO identity.users (id, email, email_verified, status, display_name, locale, timezone, subscription_tier) VALUES (${userId}, ${`notes-e2e-${userId}@example.test`}, true, 'active', 'Tutor Learner', 'en', 'UTC', 'free')`;
    await tx`INSERT INTO identity.user_settings (user_id, onboarding_completed_at, onboarding_version, first_application_visit_at, learning_preferences) VALUES (${userId}, now(), 1, now(), '{}'::jsonb)`;
    await tx`INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, language, visibility, status, quality_score, metadata)
      VALUES (${videoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'Gradient descent in four minutes', 'en', 'public', 'ready', 0.99, '{"test":true}'::jsonb)`;
    await tx`INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms) VALUES (${videoId}, ${youtubeId}, 'LearnSpace Tutor Lab', 240000)`;
    await tx`INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${videoId}, 1, ${"b".repeat(64)}, ${"b".repeat(64)}, ${`transcripts/${videoId}`}, 'application/json', 'learner-captions', '1', 'ready', now(), now())`;
    for (const [ordinal, content] of lines.entries()) {
      await tx`INSERT INTO retrieval.resource_chunks (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, language, start_ms, end_ms)
        VALUES (${versionId}, ${ordinal}, 'transcript', ${content}, ${createHash("sha256").update(content).digest("hex")}, ${Math.ceil(content.length / 4)}, 'en', ${ordinal * 60_000}, ${ordinal * 60_000 + 59_000})`;
    }
    await tx`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${videoId}`;
  });
  token = (await createSession(userId, { userAgent: "tutor-e2e" }, process.env.AUTH_SECRET ?? "")).token;
});

test.afterAll(async () => {
  const db = database;
  if (!db) return;
  await db`DELETE FROM study.session_notes WHERE user_id = ${userId}`;
  await db`DELETE FROM retrieval.answer_cache WHERE resource_version_id = ${versionId}`;
  await db`DELETE FROM retrieval.citations WHERE resource_version_id = ${versionId}`;
  await db`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id IN (SELECT id FROM retrieval.retrieval_runs WHERE user_id = ${userId})`;
  await db`DELETE FROM retrieval.retrieval_runs WHERE user_id = ${userId}`;
  await db`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${userId})`;
  await db`UPDATE study.tutor_messages SET source_message_id = NULL WHERE thread_id IN (SELECT id FROM study.tutor_threads WHERE user_id = ${userId})`;
  await db`DELETE FROM study.tutor_messages WHERE thread_id IN (SELECT id FROM study.tutor_threads WHERE user_id = ${userId})`;
  await db`DELETE FROM agent.agent_runs WHERE user_id = ${userId}`;
  await db`DELETE FROM study.tutor_threads WHERE user_id = ${userId}`;
  await db`DELETE FROM ops.outbox_events WHERE user_id = ${userId}`;
  await db`DELETE FROM ops.idempotency_records WHERE user_id = ${userId}`;
  await db`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
  await db`DELETE FROM study.focus_sessions WHERE user_id = ${userId}`;
  await db`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${userId})`;
  await db`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${userId})`;
  await db`DELETE FROM study.user_resource_progress WHERE user_id = ${userId}`;
  await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${userId})`;
  await db`DELETE FROM study.mastery_checks WHERE user_id = ${userId}`;
  await db`DELETE FROM study.study_sessions WHERE user_id = ${userId}`;
  await db`DELETE FROM discovery.discovery_interactions WHERE user_id = ${userId}`;
  await db`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${userId}`;
  await db`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${videoId}`;
  await db`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
  await db`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
  await db`DELETE FROM ops.transcript_requests WHERE resource_id = ${videoId}`;
  await db`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
  await db`DELETE FROM catalog.resources WHERE id = ${videoId}`;
  await db`DELETE FROM ops.rate_limit_counters WHERE key LIKE ${`learnspace:tutor:%${userId}`} OR key LIKE ${`learnspace:mastery:%${userId}`}`;
  await db`DELETE FROM identity.users WHERE id = ${userId}`;
  await db.end({ timeout: 5 });
});

/** A stand-in for YouTube's player that records where it was asked to seek, so citations can be checked against it. */
async function fakePlayer(page: Page) {
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
  await page.addInitScript(() => {
    const seeks: number[] = [];
    Object.assign(window, { __seeks: seeks });
    Object.assign(window, {
      YT: {
        Player: class {
          constructor(_element: HTMLElement, options: { events: { onReady: (event: { target: unknown }) => void } }) {
            setTimeout(() => options.events.onReady({ target: this }), 0);
          }
          seekTo(seconds: number) { seeks.push(seconds); }
          getCurrentTime() { return 70; }
          getDuration() { return 240; }
          getPlayerState() { return 2; }
          playVideo() {}
          pauseVideo() {}
          destroy() {}
        },
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-tutor-${randomUUID()}` });
  await page.context().addCookies([{ name: sessionCookieName, value: token, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
  await fakePlayer(page);
});


test("voice notes stream into the document, persist edits, draw on the lesson, and undo", async ({ page }) => {
  const started = await page.request.post("/api/v1/study-sessions", { data: { resourceId: videoId, origin: "home", idempotencyKey: `notes-e2e-${randomUUID()}` } });
  expect(started.status()).toBe(200);
  sessionId = ((await started.json()) as { sessionId: string }).sessionId;
  await page.goto(`/app/study/video/${sessionId}`);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel.getByRole("heading", { name: "A little room to think." })).toBeVisible();
  await page.screenshot({ path: "/tmp/learnspace-notes-empty.png" });
  await panel.getByLabel("Message Luna").fill("Explain the learning rate with a diagram and mark the lesson");
  await panel.getByRole("button", { name: "Send to Luna" }).click();
  await expect(panel.getByRole("img", { name: /Diagram:/ })).toBeVisible();
  await expect(page.getByLabel("Luna’s lesson annotations").getByText("Learning rate")).toBeVisible();
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const note = panel.getByLabel("paragraph note");
  await note.fill("My own explanation: the step size controls progress.");
  await note.press("Tab");
  await expect.poll(async () => (await (await page.request.get(`/api/v1/study-sessions/${sessionId}/notes`)).json()).blocks.some((block: { text: string }) => block.text.includes("My own explanation"))).toBe(true);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await panel.getByRole("button", { name: "Draw", exact: true }).click();
  const overlay = page.getByLabel("Draw on the lesson");
  const box = await overlay.boundingBox();
  if (!box) throw new Error("lesson drawing surface is missing");
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .4, { steps: 8 });
  await page.mouse.up();
  await expect(overlay.locator("polyline")).toHaveCount(2);
  await panel.getByRole("button", { name: "Draw", exact: true }).click();
  await panel.getByLabel("Message Luna").fill("Actually change the paragraph to a shorter explanation");
  await panel.getByRole("button", { name: "Send to Luna" }).click();
  await expect(panel.getByText("Smaller steps can help avoid overshooting.", { exact: true })).toBeVisible();
  await panel.getByLabel("Message Luna").fill("undo that");
  await panel.getByRole("button", { name: "Send to Luna" }).click();
  await expect(panel.getByText("My own explanation: the step size controls progress.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(panel.getByText("My own explanation: the step size controls progress.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: /Diagram:/ })).toBeVisible();
  await page.screenshot({ path: "/tmp/learnspace-notes-document.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByLabel("Message Luna")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "/tmp/learnspace-notes-mobile.png" });
});

test("stopping during microphone startup closes late streams and never loads models", async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { workers: 0, stopped: 0 };
    Object.assign(window, { __voiceLifecycle: counters });
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() { counters.workers++; }
      postMessage() {}
      terminate() { counters.stopped++; }
    }
    Object.assign(window, { Worker: FakeWorker });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const context = new AudioContext();
      const stream = context.createMediaStreamDestination().stream;
      const track = stream.getTracks()[0];
      if (track) { const original = track.stop.bind(track); track.stop = () => { counters.stopped++; original(); void context.close(); }; }
      return stream;
    } });
  });
  await page.goto(`/app/study/video/${sessionId}`);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const before = await page.evaluate(() => (window as unknown as { __voiceLifecycle: { workers: number } }).__voiceLifecycle.workers);
  await page.getByRole("button", { name: "Let's talk", exact: true }).click();
  await page.getByRole("button", { name: "End voice session", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __voiceLifecycle: { stopped: number } }).__voiceLifecycle.stopped)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __voiceLifecycle: { workers: number } }).__voiceLifecycle.workers)).toBe(before);
  await expect(page.getByRole("button", { name: "Let's talk", exact: true })).toBeVisible();
});


test("lesson sharing sends one cropped frame per turn and releases the capture track", async ({ page }) => {
  await page.addInitScript(() => {
    let stopped = false;
    Object.assign(window, { __captureStopped: () => stopped });
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: async () => {
      const canvas = document.createElement("canvas");
      canvas.width = innerWidth; canvas.height = innerHeight;
      const context = canvas.getContext("2d");
      const paint = () => {
        if (!context) return;
        context.fillStyle = "#121717"; context.fillRect(0, 0, canvas.width, canvas.height);
        const box = document.querySelector(".session-card")?.getBoundingClientRect();
        if (box) { context.fillStyle = "#7ce4c8"; context.fillRect(box.x + box.width * .2, box.y + box.height * .2, box.width * .5, box.height * .5); }
      };
      paint();
      const timer = setInterval(paint, 100);
      const stream = canvas.captureStream(2);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("canvas capture is unavailable");
      const stop = track.stop.bind(track);
      track.getSettings = () => ({ displaySurface: "browser" });
      track.stop = () => { stopped = true; clearInterval(timer); stop(); };
      return stream;
    } });
  });
  await page.goto(`/app/study/video/${sessionId}`);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Share lesson", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lesson shared", exact: true })).toBeVisible();
  await page.getByLabel("Message Luna").fill("What is this shape in the shared lesson?");
  const request = page.waitForRequest((request) => request.url().endsWith("/notes/turn"));
  await page.getByRole("button", { name: "Send to Luna" }).click();
  const body = (await request).postDataJSON();
  expect(body.spatial.frame).toMatch(/^data:image\/jpeg;base64,/);
  expect(body.spatial.frame.length).toBeLessThan(700000);
  await page.getByRole("button", { name: "Lesson shared", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __captureStopped: () => boolean }).__captureStopped())).toBe(true);
});

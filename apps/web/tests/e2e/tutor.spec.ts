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
    await tx`INSERT INTO identity.users (id, email, email_verified, status, display_name, locale, timezone, subscription_tier) VALUES (${userId}, ${`tutor-e2e-${userId}@example.test`}, true, 'active', 'Tutor Learner', 'en', 'UTC', 'free')`;
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
  await db`DELETE FROM study.study_sessions WHERE user_id = ${userId}`;
  await db`DELETE FROM discovery.discovery_interactions WHERE user_id = ${userId}`;
  await db`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${userId}`;
  await db`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${videoId}`;
  await db`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
  await db`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
  await db`DELETE FROM ops.transcript_requests WHERE resource_id = ${videoId}`;
  await db`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
  await db`DELETE FROM catalog.resources WHERE id = ${videoId}`;
  await db`DELETE FROM ops.rate_limit_counters WHERE key LIKE ${`learnspace:tutor:%${userId}`}`;
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

test("the tutor answers from the transcript, checks understanding, seeks the video and keeps the thread", async ({ page }) => {
  const started = await page.request.post("/api/v1/study-sessions", { data: { resourceId: videoId, origin: "home", idempotencyKey: `tutor-e2e-${randomUUID()}` } });
  expect(started.status()).toBe(200);
  sessionId = ((await started.json()) as { sessionId: string }).sessionId;
  await page.goto(`/app/study/video/${sessionId}`);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel.getByText("Learn from this video")).toBeVisible();

  await panel.getByLabel("Ask the tutor").fill("What does the learning rate do?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByRole("region", { name: "Key concept: Learning rate" })).toBeVisible();
  const check = panel.getByRole("region", { name: "Check your understanding" });
  await expect(check.getByText("What happens if the learning rate is too large?")).toBeVisible();

  // Citations are the transcript's own timestamps and play the video from there.
  await panel.getByRole("button", { name: "Play the video from 1:00" }).click();
  expect(await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks)).toContain(60);

  // A hint first, then a wrong answer graded by the server with the explanation revealed.
  await check.getByRole("button", { name: "Show a hint" }).click();
  await expect(check.getByText("Think about what a big step does near the bottom.")).toBeVisible();
  await check.getByRole("button", { name: /Training stops immediately/ }).click();
  await expect(check.getByText("Not quite")).toBeVisible();
  await expect(check.getByText("Large steps overshoot the minimum.")).toBeVisible();
  await expect(check.getByRole("button", { name: /Training stops immediately/ })).toBeDisabled();

  // Leaving and coming back restores the conversation and the graded check.
  await page.reload();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "What does the learning rate do?" })).toBeVisible();
  await expect(panel.getByRole("paragraph").filter({ hasText: "What does the learning rate do?" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Check your understanding" }).getByText("Not quite")).toBeVisible();

  // Questions outside the video get the fixed scope notice, not an answer.
  await panel.getByLabel("Ask the tutor").fill("What is the capital of France?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("I can only help with what this video teaches.")).toBeVisible();
  await expect(panel.getByText(/Paris/)).toHaveCount(0);
});

test("the tutor API refuses other learners' sessions and malformed actions", async ({ page }) => {
  const forged = await page.request.get(`/api/v1/study-sessions/${randomUUID()}/tutor`);
  expect(forged.status()).toBe(404);
  const badAction = await page.request.post(`/api/v1/study-sessions/${sessionId}/tutor/interactions`, { data: { action: "answer", messageId: randomUUID(), blockId: "b1", choice: 0 } });
  expect(badAction.status()).toBe(404);
  const unknownAction = await page.request.post(`/api/v1/study-sessions/${sessionId}/tutor/interactions`, { data: { action: "run", messageId: randomUUID(), blockId: "b1" } });
  expect(unknownAction.status()).toBe(422);
  const tooLong = await page.request.post(`/api/v1/study-sessions/${sessionId}/tutor`, { data: { question: "x".repeat(9_000), positionMs: 0, idempotencyKey: randomUUID() } });
  expect(tooLong.status()).toBe(413);
});

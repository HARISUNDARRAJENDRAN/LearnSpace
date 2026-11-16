import { createHash, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { createSession } from "../../lib/auth/repository";
import { openTool, studyTool } from "./study-tools";

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
  await db`DELETE FROM study.video_notes WHERE user_id = ${userId}`;
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

test("the tutor answers from the transcript, checks understanding, seeks the video and keeps the thread", async ({ page }) => {
  const started = await page.request.post("/api/v1/study-sessions", { data: { resourceId: videoId, origin: "home", idempotencyKey: `tutor-e2e-${randomUUID()}` } });
  expect(started.status()).toBe(200);
  sessionId = ((await started.json()) as { sessionId: string }).sessionId;
  await page.goto(`/app/study/video/${sessionId}`);
  await openTool(page, "AI");
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
  // The session reopens with the panel the learner left open.
  await expect(studyTool(page, "AI")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("heading", { name: "What does the learning rate do?" })).toBeVisible();
  await expect(panel.getByRole("paragraph").filter({ hasText: "What does the learning rate do?" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Check your understanding" }).getByText("Not quite")).toBeVisible();
  // Asking for help with a graded check sends straight away, as a reply to it.
  await panel.getByRole("region", { name: "Check your understanding" }).first().getByRole("button", { name: "Help me understand" }).click();
  await expect(panel.getByRole("paragraph").filter({ hasText: "Help me understand why my answer was wrong." })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Check your understanding" })).toHaveCount(2);

  // Messages that aren't learning questions get the fixed scope notice, not an answer.
  await panel.getByLabel("Ask the tutor").fill("What should I cook for dinner?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("I can only help with learning")).toBeVisible();

  // A learning question the video doesn't cover is answered from general knowledge and labelled as such.
  await panel.getByLabel("Ask the tutor").fill("May I know what's the value of e in maths?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("General knowledge, not from this video")).toBeVisible();
  await expect(panel.getByText(/2\.71828/)).toBeVisible();
  // Math is typeset, not shown as LaTeX source.
  await expect(panel.locator(".chat-message .katex").last()).toBeVisible();
  await expect(panel.locator(".chat-message").last()).not.toContainText("$");
  await expect(panel.getByText(/Paris/)).toHaveCount(0);

  // Highlighting words in an answer asks about just them, in a thread under that passage that "Got it" folds away.
  const definition = panel.getByText("How big each step against the gradient is.").first();
  await definition.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await definition.dispatchEvent("pointerup");
  await panel.getByLabel("Ask about the highlighted words").fill("Why against the gradient?");
  await panel.getByLabel("Ask about the highlighted words").press("Enter");
  const doubt = panel.getByRole("region", { name: /Doubt about/ });
  await expect(doubt.getByText("Why against the gradient?")).toBeVisible();
  await expect(doubt.getByText(/that is the way downhill/)).toBeVisible();
  // The main conversation is untouched: its latest answer is still the general-knowledge one.
  await expect(panel.locator(".chat-messages > .chat-message").last()).toContainText("2.71828");
  await doubt.getByRole("button", { name: "Got it" }).click();
  await expect(doubt.getByText("1 reply · Resolved")).toBeVisible();
  await page.reload();
  // The session reopens with the panel the learner left open.
  await expect(studyTool(page, "AI")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("region", { name: /Doubt about/ }).getByText("1 reply · Resolved")).toBeVisible();
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

test("watching the video to the end opens a hard check that must be passed to move on", async ({ page }) => {
  const watched = await page.request.post(`/api/v1/study-sessions/${sessionId}/progress`, { data: { resourceId: videoId, progressPct: 100, anchor: { kind: "video", positionMs: 239_000 }, event: "complete", idempotencyKey: `complete-${randomUUID()}` } });
  expect((await watched.json()).masteryRequired).toBe(true);
  // A watched lesson whose check is not passed opens on the check: no rewatching the video to get back to it.
  await page.goto(`/app/study/video/${sessionId}`);
  const panel = page.locator(".session-tool-slot:not([hidden])");
  await expect(page.getByRole("button", { name: "Check", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Finishing the video wrote the set in the background, so the panel opens on the first question.
  await expect(panel.getByText("1 / 5")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Start the check" })).toHaveCount(0);
  await panel.getByRole("button", { name: /It overshoots the minimum/ }).click();
  await expect(panel.getByText("Large steps jump past the minimum.")).toBeVisible();
  // Leaving mid-check and coming back resumes on the next unanswered question, with the answer kept.
  await page.reload();
  await expect(panel.getByText("2 / 5")).toBeVisible();
  for (let index = 0; index < 2; index += 1) {
    await panel.getByRole("button", { name: /It overshoots the minimum/ }).click();
    await expect(panel.getByText("Large steps jump past the minimum.")).toBeVisible();
    await panel.getByRole("button", { name: "Next question" }).click();
  }
  for (let index = 0; index < 2; index += 1) {
    await panel.getByLabel("Your answer", { exact: true }).fill("Big steps overshoot the minimum, so the loss grows.");
    await panel.getByRole("button", { name: "Submit answer" }).click();
    await expect(panel.getByText("Right: big steps overshoot the minimum.")).toBeVisible();
    await panel.getByRole("button", { name: index === 1 ? "See results" : "Next question" }).click();
  }
  // The results: the score on the dial, what it was built from, and an analysis written from these answers.
  const results = panel.locator(".mastery-results");
  await expect(results.locator(".mastery-score strong")).toHaveText("100%");
  await expect(results.locator(".mastery-band")).toHaveText("Excellent");
  await expect(results.getByText("Lesson mastered.")).toBeVisible();
  await expect(results.getByRole("heading", { name: "Concept mastery" })).toBeVisible();
  await expect(results.getByText("You traced how the step size drives overshooting.")).toBeVisible();
  await page.locator(".session-tool-slot:not([hidden]) .session-tool-body").screenshot({ path: "test-results/mastery-results.png" });
  // Review answers walks the questions and comes back to the results.
  await results.getByRole("button", { name: "Review answers" }).click();
  await expect(panel.getByText("1 / 5")).toBeVisible();
  await panel.getByRole("button", { name: "Back to results" }).click();
  await expect(results.locator(".mastery-band")).toHaveText("Excellent");
  // The pass and its analysis are stored, so a reload opens on the same results.
  expect((await (await page.request.get(`/api/v1/study-sessions/${sessionId}/mastery`)).json()).state).toBe("passed");
  await page.reload();
  await openTool(page, "Check");
  await expect(results.getByText("You traced how the step size drives overshooting.")).toBeVisible();
  // A single lesson has no next video, so Continue ends the session.
  await results.getByRole("button", { name: "Back to Sessions" }).click();
  await page.waitForURL("**/app/sessions");
});

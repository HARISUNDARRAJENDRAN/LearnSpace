import { createHash, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { createSession } from "../../lib/auth/repository";
import { studyTool } from "./study-tools";

// Opening a lesson classifies its transcript (once per version) and the Code tool shows only on coding lessons. The mock
// classifier calls a transcript about recursion a DSA lesson and anything else a conceptual one.
test.describe.configure({ mode: "serial" });

const userId = randomUUID();
const videos = {
  recursion: { id: randomUUID(), versionId: randomUUID(), title: "Recursion from scratch", lines: [
    "Today we write a recursive function that computes factorials.",
    "Every recursion needs a base case: the factorial of zero is one.",
    "The recursive step multiplies n by the factorial of n minus one.",
    "Trace it on paper to see each call wait for the one below it.",
  ] },
  concept: { id: randomUUID(), versionId: randomUUID(), title: "What a learning rate does", lines: [
    "Gradient descent moves the weights downhill, one step at a time.",
    "The learning rate decides how big each step is.",
    "Too large a rate overshoots the minimum and the loss grows.",
  ] },
};
let database: ReturnType<typeof postgres> | null = null;
let token = "";

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for coding profile E2E");
  const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  database = db;
  await db.begin(async (tx) => {
    await tx`INSERT INTO identity.users (id, email, email_verified, status, display_name, locale, timezone, subscription_tier) VALUES (${userId}, ${`coding-e2e-${userId}@example.test`}, true, 'active', 'Coding Learner', 'en', 'UTC', 'free')`;
    await tx`INSERT INTO identity.user_settings (user_id, onboarding_completed_at, onboarding_version, first_application_visit_at, learning_preferences) VALUES (${userId}, now(), 1, now(), '{}'::jsonb)`;
    for (const video of Object.values(videos)) {
      const youtubeId = `c${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      await tx`INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, language, visibility, status, quality_score, metadata)
        VALUES (${video.id}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${video.title}, 'en', 'public', 'ready', 0.99, '{"test":true}'::jsonb)`;
      await tx`INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms) VALUES (${video.id}, ${youtubeId}, 'LearnSpace Coding Lab', 240000)`;
      await tx`INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
        VALUES (${video.versionId}, ${video.id}, 1, ${"c".repeat(64)}, ${"c".repeat(64)}, ${`transcripts/${video.id}`}, 'application/json', 'learner-captions', '1', 'ready', now(), now())`;
      for (const [ordinal, content] of video.lines.entries()) {
        await tx`INSERT INTO retrieval.resource_chunks (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, language, start_ms, end_ms)
          VALUES (${video.versionId}, ${ordinal}, 'transcript', ${content}, ${createHash("sha256").update(content).digest("hex")}, ${Math.ceil(content.length / 4)}, 'en', ${ordinal * 60_000}, ${ordinal * 60_000 + 59_000})`;
      }
      await tx`UPDATE catalog.resources SET current_version_id = ${video.versionId} WHERE id = ${video.id}`;
    }
  });
  token = (await createSession(userId, { userAgent: "coding-e2e" }, process.env.AUTH_SECRET ?? "")).token;
});

test.afterAll(async () => {
  const db = database;
  if (!db) return;
  const ids = Object.values(videos).map((video) => video.id);
  const versionIds = Object.values(videos).map((video) => video.versionId);
  // A recommended lesson has its first problem written ahead; those rows belong to the lesson, not the learner.
  await db`DELETE FROM practice.coding_problems WHERE resource_id IN ${db(ids)}`;
  await db`DELETE FROM practice.coding_mastery WHERE user_id = ${userId}`;
  await db`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${userId})`;
  await db`DELETE FROM agent.agent_runs WHERE user_id = ${userId}`;
  await db`DELETE FROM ops.outbox_events WHERE user_id = ${userId}`;
  await db`DELETE FROM ops.idempotency_records WHERE user_id = ${userId}`;
  await db`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
  await db`DELETE FROM study.focus_sessions WHERE user_id = ${userId}`;
  await db`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${userId})`;
  await db`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${userId})`;
  await db`DELETE FROM study.user_resource_progress WHERE user_id = ${userId}`;
  await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${userId})`;
  await db`DELETE FROM study.video_notes WHERE user_id = ${userId}`;
  await db`DELETE FROM study.study_sessions WHERE user_id = ${userId}`;
  await db`DELETE FROM discovery.discovery_interactions WHERE user_id = ${userId}`;
  await db`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${userId}`;
  await db`UPDATE catalog.resources SET current_version_id = NULL WHERE id IN ${db(ids)}`;
  // The coding profiles go with their transcript versions (ON DELETE CASCADE).
  await db`DELETE FROM retrieval.resource_chunks WHERE resource_version_id IN ${db(versionIds)}`;
  await db`DELETE FROM catalog.resource_versions WHERE id IN ${db(versionIds)}`;
  await db`DELETE FROM ops.transcript_requests WHERE resource_id IN ${db(ids)}`;
  await db`DELETE FROM catalog.video_details WHERE resource_id IN ${db(ids)}`;
  await db`DELETE FROM catalog.resources WHERE id IN ${db(ids)}`;
  await db`DELETE FROM ops.rate_limit_counters WHERE key LIKE ${`learnspace:%${userId}`}`;
  await db`DELETE FROM identity.users WHERE id = ${userId}`;
  await db.end({ timeout: 5 });
});

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-coding-${randomUUID()}` });
  await page.context().addCookies([{ name: sessionCookieName, value: token, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
  // No YouTube in tests: the lesson renders without its player.
  await page.route("https://www.youtube.com/iframe_api", (route) => route.abort());
});

async function startSession(page: Page, resourceId: string): Promise<string> {
  const started = await page.request.post("/api/v1/study-sessions", { data: { resourceId, origin: "home", idempotencyKey: `coding-e2e-${randomUUID()}` } });
  expect(started.status()).toBe(200);
  return ((await started.json()) as { sessionId: string }).sessionId;
}

/** Asks for the session's coding state (which starts the classification) until the profile settles. */
async function settledProfile(page: Page, sessionId: string) {
  type Profile = { status: string; eligible: boolean; category: string | null; concepts: Array<{ concept: string; startMs: number | null }> };
  let profile: Profile = { status: "unknown", eligible: false, category: null, concepts: [] };
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/study-sessions/${sessionId}/coding`);
    expect(response.status()).toBe(200);
    profile = ((await response.json()) as { profile: Profile }).profile;
    return profile.status;
  }, { timeout: 30_000, intervals: [500, 1_000, 2_000] }).toBe("ready");
  return profile;
}

test("a recursion lesson is classified as coding practice and offers the Code tool", async ({ page }) => {
  const sessionId = await startSession(page, videos.recursion.id);
  const profile = await settledProfile(page, sessionId);
  expect(profile).toMatchObject({ eligible: true, category: "dsa_lesson" });
  // The concept carries the time its cited passage starts at, so practice can point back into the video.
  expect(profile.concepts).toEqual([expect.objectContaining({ concept: "recursion", startMs: 0 })]);
  const [row] = await (database as NonNullable<typeof database>)`SELECT status, practice_fit, language FROM practice.video_coding_profiles WHERE resource_version_id = ${videos.recursion.versionId}`;
  expect(row).toMatchObject({ status: "ready", language: "python" });

  await page.goto(`/app/study/video/${sessionId}`);
  await expect(studyTool(page, "Code")).toBeVisible({ timeout: 15_000 });
});

test("a conceptual lesson is classified but does not offer the Code tool", async ({ page }) => {
  const sessionId = await startSession(page, videos.concept.id);
  const profile = await settledProfile(page, sessionId);
  expect(profile).toMatchObject({ eligible: false, category: "conceptual_cs", concepts: [] });

  // The profile is already settled, so the tool bar's first answer is final.
  const asked = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/study-sessions/${sessionId}/coding`);
  await page.goto(`/app/study/video/${sessionId}`);
  expect((await asked).status()).toBe(200);
  await expect(studyTool(page, "AI")).toBeVisible();
  await expect(studyTool(page, "Code")).toHaveCount(0);
});

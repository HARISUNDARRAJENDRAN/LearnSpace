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
  await db`DELETE FROM study.video_notes WHERE user_id = ${userId}`;
  await db`DELETE FROM study.session_transcript WHERE user_id = ${userId}`;
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
  await db`DELETE FROM ops.rate_limit_counters WHERE key LIKE ${`learnspace:tutor:%${userId}`} OR key LIKE ${`learnspace:mastery:%${userId}`} OR key LIKE ${`learnspace:notes:%${userId}`}`;
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

/**
 * A stand-in for the on-device speech models: the page's workers are faked, so the test says what the learner said and
 * reads what Luny spoke, while the turns themselves go to the app's server and the scripted model as usual.
 */
async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    // Silero's worker (it takes the microphone's frames) and the listener's; resets carry the page's epoch to the listener.
    let vad: FakeWorker | null = null;
    let listener: FakeWorker | null = null;
    let epoch = 0;
    let open = 0;
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      loaded = false;
      reply(data: unknown) { setTimeout(() => this.onmessage?.({ data }), 0); }
      postMessage(message: { type?: string; listener?: string; id?: number; text?: string; frames?: unknown; epoch?: number }) {
        if (message.type === "connect" && message.frames) vad = this;
        if (message.type === "reset" && this !== vad) epoch = message.epoch ?? epoch;
        // Only the voice models count; the background prefetch closes itself.
        if (message.type === "load" && !this.loaded) { this.loaded = true; open += 1; }
        if (message.type === "load" && message.listener) { listener = this; this.reply({ type: "ready", listener: "moonshine", unsuitable: false }); }
        else if (message.type === "load") this.reply({ type: "ready" });
        else if (message.type === "speak") { spoken.push(message.text ?? ""); this.reply({ type: "audio", id: message.id, samples: new Float32Array(2_400), sampleRate: 24_000 }); }
      }
      addEventListener() {}
      terminate() { if (this.loaded) open -= 1; this.loaded = false; if (listener === this) listener = null; if (vad === this) vad = null; }
    }
    Object.assign(window, {
      Worker: FakeWorker,
      __voice: {
        // The learner speaks, then pauses: the listener hears speech, then reports what was said.
        say: (text: string) => { vad?.onmessage?.({ data: { type: "speech" } }); listener?.onmessage?.({ data: { type: "final", text, heard: true, endedAt: Date.now(), epoch } }); },
        // A cough or a noise: Silero hears speech, which then turns out to have no words.
        noise: () => { vad?.onmessage?.({ data: { type: "speech" } }); listener?.onmessage?.({ data: { type: "final", text: "", heard: true, endedAt: Date.now(), epoch } }); },
        spoken: () => spoken.join(" "),
        open: () => open,
      },
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => new AudioContext().createMediaStreamDestination().stream });
  });
}
type FakeVoice = { say: (text: string) => void; noise: () => void; spoken: () => string; open: () => number };
const learner = (page: Page) => ({
  say: (text: string) => page.evaluate((value) => (window as unknown as { __voice: FakeVoice }).__voice.say(value), text),
  spoken: () => page.evaluate(() => (window as unknown as { __voice: FakeVoice }).__voice.spoken()),
  open: () => page.evaluate(() => (window as unknown as { __voice: FakeVoice }).__voice.open()),
  noise: () => page.evaluate(() => (window as unknown as { __voice: FakeVoice }).__voice.noise()),
});
/** The body of every voice turn the page sends. */
function turns(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/study-sessions\/[^/]+\/voice$/.test(request.url())) sent.push(request.postDataJSON() as Record<string, unknown>); });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-tutor-${randomUUID()}` });
  await page.context().addCookies([{ name: sessionCookieName, value: token, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
  await fakePlayer(page);
  await fakeVoice(page);
});

test("Luny talks and moves the lesson, the scribe keeps the notebook, the learner edits it, and undoes", async ({ page }) => {
  const started = await page.request.post("/api/v1/study-sessions", { data: { resourceId: videoId, origin: "home", idempotencyKey: `notes-e2e-${randomUUID()}` } });
  expect(started.status()).toBe(200);
  sessionId = ((await started.json()) as { sessionId: string }).sessionId;
  const sent = turns(page);
  await page.goto(`/app/study/video/${sessionId}`);
  const you = learner(page);
  // Opening Notes starts Luny, and she opens the conversation.
  await openTool(page, "Notes");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  // The panel is the orb and the page: no captions, no chat bar.
  await expect(panel.getByRole("button", { name: "End the talk with Luny" })).toBeVisible();
  await expect(panel.getByLabel("Message Luny")).toHaveCount(0);
  await expect.poll(() => you.spoken()).toContain("Hey! What are you working through right now?");
  expect(sent[0]).toMatchObject({ utterance: null, positionMs: 70_000, playing: false });
  expect(sent[0]).not.toHaveProperty("marks");

  // The study guide was written when the lesson opened, and reads rendered: math, a table, highlighted code and callouts.
  await expect(panel.getByRole("heading", { name: "Gradient descent [0:00]" })).toBeVisible();
  await expect(panel.locator(".notes-math.is-display .katex")).toBeVisible();
  await expect(panel.locator(".notes-strong", { hasText: "Gradient descent" })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "Overshoots [2:00]" })).toBeVisible();
  await expect(panel.locator(".notes-code .hljs-keyword", { hasText: "for" })).toBeVisible();
  await expect(panel.getByText("In plain words")).toBeVisible();
  await expect(panel.getByText("Beyond the video")).toBeVisible();
  // The formula's source is hidden while the page is only being read.
  await expect(panel.getByText(/\$\$/)).toBeHidden();
  await page.screenshot({ path: "/tmp/learnspace-notes-guide.png" });
  await panel.getByText("Beyond the video").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/learnspace-notes-guide-more.png" });

  // Luny moves the lesson without drawing on it, her words are spoken without the command, and the scribe writes the
  // exchange up, diagram included.
  await you.say("Explain the learning rate with a diagram");
  await expect.poll(() => you.spoken()).toContain("It sets the size of each step.");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks)).toContain(70);
  await expect(page.locator(".tutor-overlay")).toHaveCount(0);
  expect(await you.spoken()).not.toContain("[[");
  await expect(panel.getByRole("figure", { name: /Diagram:/ })).toBeVisible();
  await expect(panel.getByText("[1:10]")).toBeVisible();
  const db = database;
  if (!db) throw new Error("the database is not connected");
  const saved = await db<{ speaker: string; text: string }[]>`SELECT speaker, text FROM study.session_transcript WHERE study_session_id = ${sessionId} ORDER BY seq`;
  expect(saved.map((row) => [row.speaker, row.text])).toEqual([["luna", "Hey! What are you working through right now?"], ["you", "Explain the learning rate with a diagram"], ["luna", "It sets the size of each step."]]);

  // A timestamp in the notes plays the lesson from there.
  await panel.getByText("[1:10]").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks.at(-1))).toBe(70);

  // The learner reworks the diagram: renames a box and recolours it, and the drawing is saved with their changes.
  const diagram = panel.getByRole("figure", { name: /Diagram:/ });
  await diagram.getByText("Step", { exact: true }).dblclick();
  await diagram.getByRole("textbox", { name: "Label" }).fill("Update");
  await page.keyboard.press("Enter");
  await diagram.getByText("Update", { exact: true }).click();
  await diagram.getByRole("button", { name: "rose" }).click();
  await expect.poll(async () => {
    const { blocks } = await (await page.request.get(`/api/v1/study-sessions/${sessionId}/notes`)).json() as { blocks: { type: string; text: string }[] };
    const drawn = blocks.find((block) => block.type === "diagram");
    return drawn ? JSON.parse(drawn.text).nodes.find((node: { id: string }) => node.id === "b") : null;
  }).toMatchObject({ label: "Update", color: "rose", x: 0.85, y: 0.5 });
  await expect(panel.getByRole("figure", { name: "Diagram: Gradient, Update" })).toBeVisible();

  // The learner writes in the notebook like any document; their change is saved a moment after they stop typing.
  await panel.getByText("The learning rate controls the step size").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" My own explanation: the step size controls progress.");
  await expect.poll(async () => (await (await page.request.get(`/api/v1/study-sessions/${sessionId}/notes`)).json()).blocks.some((block: { text: string }) => block.text.includes("My own explanation"))).toBe(true);
  await page.keyboard.press("Enter");
  await page.keyboard.type("[] check momentum");
  await expect.poll(async () => (await (await page.request.get(`/api/v1/study-sessions/${sessionId}/notes`)).json()).blocks.some((block: { type: string; text: string }) => block.type === "task" && block.text === "check momentum")).toBe(true);

  // The scribe rewrites a note when the learner changes their mind, and undo brings the learner's version back.
  await you.say("Actually change the paragraph to a shorter explanation");
  await expect.poll(() => you.spoken()).toContain("Done, shorter now.");
  await expect(panel.getByText("Smaller steps can help avoid overshooting.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Undo Luny's last edit" }).click();
  await expect(panel.getByText(/My own explanation: the step size controls progress\./)).toBeVisible();

  // Everything is still there after a reload.
  await page.reload();
  // The session reopens with the panel the learner left open.
  await expect(studyTool(page, "Notes")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText(/My own explanation: the step size controls progress\./)).toBeVisible();
  await expect(panel.getByText("check momentum")).toBeVisible();
  await expect(panel.getByRole("figure", { name: /Diagram:/ })).toBeVisible();
  await page.screenshot({ path: "/tmp/learnspace-notes-document.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole("button", { name: /^(Talk to|End the talk with) Luny$/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "/tmp/learnspace-notes-mobile.png" });
});

test("opening Notes shares the lesson; Luny sees a cropped frame with each turn, stays on when Notes closes, and leaving the lesson releases her", async ({ page }) => {
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
  // The lesson is shared only from the learner's own click on Notes (the browser asks for a gesture), so the lesson
  // reopens with no panel instead of the Notes panel the last test left open.
  expect((await page.request.patch(`/api/v1/study-sessions/${sessionId}/workspace`, { data: { panel: null } })).status()).toBe(204);
  const sent = turns(page);
  await page.goto(`/app/study/video/${sessionId}`);
  const you = learner(page);
  await openTool(page, "Notes");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel.getByText("Listening", { exact: true })).toBeAttached();
  await expect(panel.getByRole("button", { name: "Share this tab" })).toHaveCount(0);
  await you.say("What is this box on the screen?");
  await expect.poll(() => sent.find((body) => body.utterance === "What is this box on the screen?")?.frame).toMatch(/^data:image\/jpeg;base64,/);
  expect(String(sent.find((body) => body.utterance === "What is this box on the screen?")?.frame).length).toBeLessThan(700_000);
  // Closing Notes stops sharing the lesson, but Luny stays in the conversation, and the Notes tool shows she is listening.
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __captureStopped: () => boolean }).__captureStopped())).toBe(true);
  await expect(page.getByRole("button", { name: "Notes", exact: true })).toHaveClass(/is-live/);
  expect(await you.open()).toBe(3);
  // Turned off by hand, she keeps her models warm, so turning her on again is instant and loads nothing.
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await panel.getByRole("button", { name: "End the talk with Luny" }).click();
  await expect(panel.getByText("Luny is off")).toBeAttached();
  await expect(page.getByRole("button", { name: "Notes", exact: true })).not.toHaveClass(/is-live/);
  expect(await you.open()).toBe(3);
  // Leaving the lesson hangs up and lets Silero, the listener and the voice go with the microphone.
  await page.getByRole("link", { name: "Back to Home" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/app/study/"));
  await expect.poll(() => you.open()).toBe(0);
});

test("talking over Luny before she answers asks again with everything the learner said", async ({ page }) => {
  // The first turn is slow to reach the server, so the learner carries on before Luny says anything.
  let voiceRequests = 0;
  await page.route("**/api/v1/study-sessions/*/voice", async (route) => {
    if (++voiceRequests === 2) await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue().catch(() => undefined);
  });
  const sent = turns(page);
  await page.goto(`/app/study/video/${sessionId}`);
  const you = learner(page);
  await openTool(page, "Notes");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect.poll(() => sent.length).toBe(1);
  await expect(panel.getByText("Listening", { exact: true })).toBeAttached();
  await you.say("So the step size is");
  await expect(panel.getByText("Thinking…", { exact: true })).toBeAttached();
  await you.say("the learning rate times the gradient");
  await expect.poll(() => sent.at(-1)?.utterance).toBe("So the step size is the learning rate times the gradient");
  // Luny chose to listen: nothing of hers is saved, and the learner's whole thought is saved once.
  const db = database;
  if (!db) throw new Error("the database is not connected");
  await expect.poll(async () => (await db<{ text: string }[]>`SELECT text FROM study.session_transcript WHERE study_session_id = ${sessionId} AND text LIKE 'So the step size is%'`).map((row) => row.text)).toEqual(["So the step size is the learning rate times the gradient"]);
  // The learner then goes quiet: they are waiting, so Luny answers what she let go by instead of staying silent.
  await expect.poll(() => sent.at(-1)?.cue).toBe("waiting");
  await expect.poll(() => you.spoken()).toContain("Right, so the step is the rate times the gradient.");
  await panel.getByRole("button", { name: "End the talk with Luny" }).click();
  await expect(panel.getByText("Luny is off")).toBeAttached();
});

test("a cough while Luny is thinking never drops the learner's question", async ({ page }) => {
  // Luny's answer is slow to arrive, and a noise reaches the microphone meanwhile.
  let voiceRequests = 0;
  await page.route("**/api/v1/study-sessions/*/voice", async (route) => {
    if (++voiceRequests === 2) await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue().catch(() => undefined);
  });
  const sent = turns(page);
  await page.goto(`/app/study/video/${sessionId}`);
  const you = learner(page);
  await openTool(page, "Notes");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect.poll(() => sent.length).toBe(1);
  await expect(panel.getByText("Listening", { exact: true })).toBeAttached();
  await you.say("What does two to the power three mean?");
  await expect(panel.getByText("Thinking…", { exact: true })).toBeAttached();
  await you.noise();
  // Her turn was kept, not cancelled: the question is asked once and answered.
  await expect.poll(() => you.spoken()).toContain("Two times two times two, so eight.");
  expect(sent.filter((body) => body.utterance === "What does two to the power three mean?")).toHaveLength(1);
  await panel.getByRole("button", { name: "End the talk with Luny" }).click();
});

test("nothing the learner says or writes is lost while the server is flaky", async ({ page }) => {
  let patches = 0;
  let voiceRequests = 0;
  let scribes = 0;
  const unavailable = { status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Try again." } }) };
  await page.route("**/api/v1/study-sessions/*/notes", (route) => route.request().method() === "PATCH" && ++patches <= 2 ? route.fulfill(unavailable) : route.continue());
  // Luny's opening and the learner's first turn both fail.
  await page.route("**/api/v1/study-sessions/*/voice", (route) => ++voiceRequests <= 2 ? route.fulfill(unavailable) : route.continue());
  await page.route("**/api/v1/study-sessions/*/notes/consolidate", (route) => ++scribes === 1 ? route.fulfill({ ...unavailable, status: 502 }) : route.continue());
  const sent = turns(page);
  await page.goto(`/app/study/video/${sessionId}`);
  const you = learner(page);
  await openTool(page, "Notes");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel.getByRole("alert").getByText("Try again.")).toBeVisible();
  const db = database;
  if (!db) throw new Error("the database is not connected");

  // Words Luny never answered are sent again with what the learner says next, and saved once she does.
  await you.say("This line has to survive");
  await expect.poll(() => voiceRequests).toBe(2);
  await you.say("a flaky server");
  await expect.poll(() => you.spoken()).toContain("It will, I keep it until it is saved.");
  expect(sent.at(-1)?.utterance).toBe("This line has to survive a flaky server");
  await expect.poll(async () => (await db<{ text: string }[]>`SELECT text FROM study.session_transcript WHERE study_session_id = ${sessionId} AND text IN ('This line has to survive a flaky server', 'It will, I keep it until it is saved.')`).length).toBe(2);
  await expect(panel.getByRole("alert").getByText("Try again.")).toHaveCount(0);
  // The scribe pass that failed runs again by itself.
  await expect.poll(() => scribes, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // The learner's edit waits through the failures and lands.
  await panel.getByText("check momentum").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" twice");
  await expect(panel.getByText("Saving… your change is kept until it's saved.")).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/study-sessions/${sessionId}/notes`)).json()).blocks.some((block: { text: string }) => block.text === "check momentum twice"), { timeout: 20_000 }).toBe(true);
  await expect(panel.getByText("Saving… your change is kept until it's saved.")).toHaveCount(0);
  await expect(panel.getByText("check momentum twice")).toBeVisible();
});

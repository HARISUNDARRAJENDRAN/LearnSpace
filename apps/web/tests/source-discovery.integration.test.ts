import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { hashPassword } from "../lib/auth/crypto";

const databaseAvailable = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL,
);

test(
  "an unseen YouTube source starts a playable Study session and accepts captions before metadata ingestion",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { resolveSource }, { getStudySession, startOrResumeStudySession }, { submitTranscript, transcriptStatus }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("../lib/study/service"),
      import("../lib/transcripts/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const email = `source-import-${randomUUID()}@example.test`;
    const user = await createEmailUser({ email, displayName: "Source Import Test", passwordHash: await hashPassword("source-import-password-123") });
    const youtubeId = `v${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const url = `https://www.youtube.com/watch?v=${youtubeId}`;
    const captionUrl = `https://www.youtube.com/api/timedtext?v=${youtubeId}&fmt=json3`;
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (async (input) => {
      const requestUrl = String(input);
      assert.match(requestUrl, /^https:\/\/www\.youtube\.com\/oembed/);
      providerCalls += 1;
      return new Response(JSON.stringify({ title: "An unseen imported lesson", thumbnail_url: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`, author_name: "Import Lab" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    let resourceId = "";
    let sessionId = "";
    try {
      const first = await resolveSource(user.id, { mode: "learn", url, correlationId: randomUUID() });
      resourceId = first.resourceId;
      assert.equal(first.sourceOrigin, "direct_url");
      const second = await resolveSource(user.id, { mode: "learn", url, correlationId: randomUUID() });
      assert.equal(second.resourceId, resourceId);
      assert.equal(providerCalls, 1);

      const resources = await migrator<{ id: string; status: string; current_version_id: string | null; count: string }[]>`
        SELECT id, status, current_version_id, count(*) OVER ()::text AS count
        FROM catalog.resources
        WHERE id = ${resourceId} AND owner_user_id = ${user.id}
      `;
      assert.equal(resources[0]?.count, "1");
      assert.equal(resources[0]?.status, "pending");
      assert.equal(resources[0]?.current_version_id, null);
      const ingestionEvents = await migrator<{ count: string; payload: Record<string, unknown> }[]>`
        SELECT count(*)::text AS count, (array_agg(payload))[1] AS payload
        FROM ops.outbox_events
        WHERE user_id = ${user.id} AND aggregate_id = ${resourceId} AND event_type = 'resource.ingestion_requested'
        GROUP BY aggregate_id
      `;
      assert.equal(ingestionEvents[0]?.count, "1");
      assert.equal(ingestionEvents[0]?.payload.sourceUrl, url);

      const started = await startOrResumeStudySession(user.id, {
        resourceId,
        origin: "discover",
        idempotencyKey: `source-import-${randomUUID()}`,
        correlationId: randomUUID(),
      });
      sessionId = started.sessionId;
      assert.equal(started.resourceType, "video");
      assert.equal(started.readiness, "preparing");
      assert.equal(started.route, `/app/study/video/${sessionId}`);
      const session = await getStudySession(user.id, sessionId);
      assert.equal(session.activeResource?.video?.youtubeId, youtubeId);
      assert.equal((await transcriptStatus(user.id, resourceId)).status, "queued");
      const [request] = await migrator`UPDATE ops.transcript_requests
        SET status = 'signed', caption_url = ${captionUrl}, language = 'en', expires_at = now() + interval '1 hour'
        WHERE resource_id = ${resourceId} RETURNING youtube_id`;
      assert.equal(request?.youtube_id, youtubeId);
      assert.deepEqual(await transcriptStatus(user.id, resourceId), { status: "signed", captionUrl, language: "en" });
      assert.deepEqual(await submitTranscript(user.id, resourceId, { language: "en", segments: [[0, 1_000, "Hello"]] }), { status: "submitted" });
      const bindings = await migrator<{ binding_status: string; resource_version_id: string | null }[]>`
        SELECT binding_status, resource_version_id
        FROM study.session_resources
        WHERE study_session_id = ${sessionId} AND resource_id = ${resourceId}
      `;
      assert.deepEqual(bindings[0], { binding_status: "preparing", resource_version_id: null });
    } finally {
      globalThis.fetch = originalFetch;
      await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM activity.activity_events WHERE user_id = ${user.id}`;
      if (resourceId) {
        await migrator`DELETE FROM study.user_resource_progress WHERE resource_id = ${resourceId}`;
        await migrator`DELETE FROM activity.activity_events WHERE resource_id = ${resourceId}`;
      }
      await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${user.id}`;
      if (resourceId) {
        await migrator`DELETE FROM discovery.discovery_interactions WHERE resource_id = ${resourceId}`;
      }
      await migrator`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${user.id}`;
      if (resourceId) {
        await migrator`DELETE FROM discovery.recommendation_impressions WHERE resource_id = ${resourceId}`;
      }
      if (sessionId) {
        await migrator`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
        await migrator`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
      }
      await migrator`DELETE FROM ops.idempotency_records WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      if (resourceId) {
        await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${resourceId}`;
        await migrator`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
      }
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "unseen arXiv and DOI sources create preparing paper resources without duplicate ingestion requests",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const { paperPdfUrl } = await import("../lib/research/pdf-source");
    const { getPaperContent } = await import("../lib/research/paper-content");
    const [{ createEmailUser }, { resolveSource }, { startOrResumeStudySession }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("../lib/study/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `paper-import-${randomUUID()}@example.test`, displayName: "Paper Import Test", passwordHash: await hashPassword("paper-import-password-123") });
    const arxivId = `2601.${String(parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 100_000).padStart(5, "0")}`;
    const arxivUrl = `https://arxiv.org/abs/${arxivId}v7`;
    const doiUrl = `https://doi.org/10.5555/source-import-${randomUUID()}`;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const requestUrl = String(input);
      if (requestUrl.startsWith("https://export.arxiv.org/api/query")) {
        return new Response("<feed><entry><title>Attention Is All You Need</title><summary>Attention metadata.</summary><published>2017-06-12T00:00:00Z</published><author><name>A. Author</name></author></entry></feed>", { status: 200, headers: { "content-type": "application/xml" } });
      }
      assert.match(requestUrl, /^https:\/\/api\.crossref\.org\/works\//);
      return new Response(JSON.stringify({ message: { title: ["A DOI research paper"], author: [{ given: "D", family: "Author" }], "published-online": { "date-parts": [[2024]] }, "container-title": ["Research Venue"] } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const resourceIds: string[] = [];
    let sessionId = "";
    try {
      const arxiv = await resolveSource(user.id, { mode: "research", url: arxivUrl, correlationId: randomUUID() });
      const arxivAgain = await resolveSource(user.id, { mode: "research", url: arxivUrl, correlationId: randomUUID() });
      const doi = await resolveSource(user.id, { mode: "research", url: doiUrl, correlationId: randomUUID() });
      resourceIds.push(arxiv.resourceId, doi.resourceId);
      assert.equal(arxiv.arxivId, arxivId);
      assert.equal(arxiv.sourceOrigin, "direct_url");
      assert.equal(arxivAgain.resourceId, arxiv.resourceId);
      assert.notEqual(arxiv.resourceId, doi.resourceId);
      const ingestionEvents = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM ops.outbox_events
        WHERE user_id = ${user.id} AND event_type = 'resource.ingestion_requested' AND aggregate_id IN ${migrator(resourceIds)}
      `;
      assert.equal(ingestionEvents[0]?.count, "2");

      const started = await startOrResumeStudySession(user.id, {
        resourceId: arxiv.resourceId,
        origin: "research",
        idempotencyKey: `paper-import-${randomUUID()}`,
        correlationId: randomUUID(),
      });
      sessionId = started.sessionId;
      assert.equal(started.resourceType, "paper");
      assert.equal(started.readiness, "preparing");
      assert.equal(started.route, `/app/study/paper/${sessionId}`);
      assert.equal((await paperPdfUrl(user.id, arxiv.resourceId)).href, `https://arxiv.org/pdf/${arxivId}`);
      await assert.rejects(paperPdfUrl(user.id, doi.resourceId), { code: "PAPER_PDF_UNAVAILABLE" });
      const content = await getPaperContent(user.id, arxiv.resourceId);
      assert.equal(content.status, "preparing");
      assert.equal(content.arxivId, arxivId);
      assert.deepEqual(content.blocks, []);
    } finally {
      globalThis.fetch = originalFetch;
      await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM activity.activity_events WHERE user_id = ${user.id}`;
      if (sessionId) {
        await migrator`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
        await migrator`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
      }
      await migrator`DELETE FROM ops.idempotency_records WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${user.id}`;
      if (resourceIds.length > 0) {
        await migrator`DELETE FROM catalog.paper_authors WHERE paper_resource_id IN ${migrator(resourceIds)}`;
        await migrator`DELETE FROM catalog.paper_details WHERE resource_id IN ${migrator(resourceIds)}`;
        await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(resourceIds)}`;
      }
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

const videoId = (name: string) => name.padEnd(11, "x").slice(0, 11);

/** Exa, the YouTube Data API, YouTube oEmbed and OpenAI, faked for the video agent; `calls` counts what each was asked. */
function videoProviders(options: { exa: string[] | "fail"; youtube: string[]; picks: string[] }) {
  const calls = { exa: 0, youtube: 0, openai: 0 };
  const fake = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "api.exa.ai") {
      calls.exa += 1;
      if (options.exa === "fail") return new Response("{}", { status: 503 });
      return Response.json({ results: options.exa.map((id) => ({ url: `https://www.youtube.com/watch?v=${id}`, title: `Exa ${id}`, author: "Exa Channel" })) });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/search")) {
      calls.youtube += 1;
      return Response.json({ items: options.youtube.map((id) => ({ id: { videoId: id }, snippet: { title: `Search ${id}`, channelTitle: "Search Channel" } })) });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/videos")) {
      calls.youtube += 1;
      const ids = url.searchParams.get("id")?.split(",") ?? [];
      return Response.json({ items: ids.filter((id) => !id.startsWith("short")).map((id) => ({
        id, snippet: { title: `Lesson ${id}`, channelTitle: `Channel ${id}`, description: "A clear lesson.", publishedAt: "2024-05-01T00:00:00Z", liveBroadcastContent: "none" },
        contentDetails: { duration: "PT25M" }, statistics: { viewCount: "120000", likeCount: "4000" }, status: { embeddable: true, privacyStatus: "public" },
      })).concat(ids.filter((id) => id.startsWith("short")).map((id) => ({
        id, snippet: { title: `Short ${id}`, channelTitle: "Shorts", description: "", publishedAt: "2024-05-01T00:00:00Z", liveBroadcastContent: "none" },
        contentDetails: { duration: "PT40S" }, statistics: { viewCount: "9", likeCount: "1" }, status: { embeddable: true, privacyStatus: "public" },
      }))) });
    }
    if (url.hostname === "www.youtube.com" && url.pathname === "/oembed") {
      return Response.json({ title: "Picked lesson", author_name: "Picked Channel", thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg" });
    }
    if (url.hostname === "openai.test") {
      calls.openai += 1;
      const picks = options.picks.map((id, index) => ({ id, why: `Reason ${index + 1} for ${id}`, level: "beginner", format: "tutorial" }));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ picks }) } }] });
    }
    throw new Error(`unexpected fetch ${url.hostname}${url.pathname}`);
  }) as typeof fetch;
  return { calls, fake };
}

/** Points the agent at the fakes, and puts every key and the real fetch back afterwards. */
async function withVideoProviders<T>(fake: typeof fetch, run: () => Promise<T>): Promise<T> {
  const keys = ["EXA_API_KEY", "YOUTUBE_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { EXA_API_KEY: "test-exa", YOUTUBE_API_KEY: " test-youtube", OPENAI_API_KEY: "test-openai", OPENAI_BASE_URL: "https://openai.test/v1" });
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test(
  "research source discovery uses one Exa search and completes without provider enrichment",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { searchSources, getSourceDiscoveryRun }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `exa-paper-search-${randomUUID()}@example.test`, displayName: "Exa Paper Search", passwordHash: await hashPassword("exa-paper-search-password-123") });
    const originalFetch = globalThis.fetch;
    const originalExaKey = process.env.EXA_API_KEY;
    const requests: string[] = [];
    process.env.EXA_API_KEY = "test-key";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      assert.equal(url, "https://api.exa.ai/search");
      return Response.json({ results: [
        { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", text: "A transformer architecture.", publishedDate: "2017-06-12", authors: ["Ashish Vaswani"] },
      ] });
    }) as typeof fetch;
    try {
      const result = await searchSources(user.id, { mode: "research", query: "Attention Is All You Need", rankingIntent: "best_match", correlationId: randomUUID() }, () => assert.fail("Exa retrieval has no deferred enrichment"));
      assert.equal(result.status, "completed");
      assert.equal(result.candidates[0]?.externalId, "1706.03762");
      assert.equal(result.candidates[0]?.canonicalUrl, "https://arxiv.org/abs/1706.03762");
      assert.deepEqual(requests, ["https://api.exa.ai/search"]);
      const run = await getSourceDiscoveryRun(user.id, result.runId!);
      assert.equal(run.status, "completed");
      assert.equal(run.candidates[0]?.title, "Attention Is All You Need");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = originalExaKey;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "the video agent answers with checked videos at once, then the model's ranked picks, which start Study and are shared",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { searchSources, getSourceDiscoveryRun, resolveSource }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const learner = await createEmailUser({ email: `video-agent-${randomUUID()}@example.test`, displayName: "Video Agent Test", passwordHash: await hashPassword("video-agent-password-123") });
    const other = await createEmailUser({ email: `video-agent-other-${randomUUID()}@example.test`, displayName: "Video Agent Other", passwordHash: await hashPassword("video-agent-password-123") });
    const seed = randomUUID().replaceAll("-", "").slice(0, 6);
    const shared = videoId(`a${seed}`);
    const exaOnly = videoId(`b${seed}`);
    const ytOnly = videoId(`c${seed}`);
    const short = videoId(`short${seed}`);
    const query = `Graph colouring ${seed}`;
    const { calls, fake } = videoProviders({ exa: [exaOnly, shared, short], youtube: [shared, ytOnly], picks: [ytOnly, shared, videoId(`zz${seed}`), exaOnly] });
    const createdResources: string[] = [];
    try {
      await withVideoProviders(fake, async () => {
        const deferred: Array<() => Promise<void>> = [];
        const first = await searchSources(learner.id, { mode: "learn", query, rankingIntent: "beginner_friendly", correlationId: randomUUID() }, (work) => { deferred.push(work); });
        // Checked and ordered by agreement across searches; the short is gone, the model is still ranking.
        assert.equal(first.status, "searching");
        assert.equal(first.agent?.stage, "ranking");
        assert.equal(first.agent?.checked, 3);
        assert.deepEqual(first.candidates.map((candidate) => candidate.externalId), [shared, exaOnly, ytOnly]);
        assert.equal(first.candidates[0]?.durationMs, 25 * 60_000);
        assert.equal(first.candidates[0]?.viewCount, 120_000);
        assert.equal(calls.openai, 0);

        const [ranking] = deferred;
        assert.equal(deferred.length, 1);
        assert.ok(ranking && first.runId);
        await ranking();
        const ranked = await getSourceDiscoveryRun(learner.id, first.runId);
        assert.equal(ranked.status, "completed");
        assert.deepEqual(ranked.agent, { stage: "done", searches: 4, checked: 3, ranked: true });
        // The model's order and reasons; an id it invented is dropped.
        assert.deepEqual(ranked.candidates.map((candidate) => candidate.externalId), [ytOnly, shared, exaOnly]);
        assert.equal(ranked.candidates[0]?.reason, `Reason 1 for ${ytOnly}`);
        assert.equal(ranked.candidates[0]?.level, "beginner");
        assert.equal(ranked.candidates[0]?.format, "tutorial");

        // Picking one starts it the way any found video starts, linked to the run that recommended it.
        const pickedUrl = ranked.candidates[0]?.canonicalUrl;
        assert.ok(pickedUrl);
        const preview = await resolveSource(learner.id, { mode: "learn", url: pickedUrl, correlationId: randomUUID(), recommendationRunId: first.runId });
        createdResources.push(preview.resourceId);
        const linked = await migrator<{ count: number }[]>`SELECT count(*)::int AS count FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${first.runId} AND resource_id = ${preview.resourceId}`;
        assert.equal(linked[0]?.count, 1);

        // The same search again reuses the run; another learner's gets the shared ranking without asking any provider.
        const providerCalls = { ...calls };
        const again = await searchSources(learner.id, { mode: "learn", query, rankingIntent: "beginner_friendly", correlationId: randomUUID() });
        assert.equal(again.runId, first.runId);
        const theirs = await searchSources(other.id, { mode: "learn", query, rankingIntent: "beginner_friendly", correlationId: randomUUID() }, () => assert.fail("a cached ranking has nothing left to do"));
        assert.notEqual(theirs.runId, first.runId);
        assert.equal(theirs.status, "completed");
        assert.deepEqual(theirs.candidates.map((candidate) => candidate.externalId), [ytOnly, shared, exaOnly]);
        assert.deepEqual(calls, providerCalls);
      });
    } finally {
      for (const user of [learner, other]) {
        await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
        await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${user.id})`;
        await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      }
      if (createdResources.length) await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(createdResources)}`;
      await migrator`DELETE FROM identity.users WHERE id IN ${migrator([learner.id, other.id])}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "a video search every provider fails is a terminal failed run, not one the picker polls forever",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { searchSources }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `video-agent-outage-${randomUUID()}@example.test`, displayName: "Video Agent Outage", passwordHash: await hashPassword("video-agent-password-123") });
    const { fake } = videoProviders({ exa: "fail", youtube: [], picks: [] });
    try {
      await withVideoProviders(fake, async () => {
        const result = await searchSources(user.id, { mode: "learn", query: `Topology ${randomUUID().slice(0, 6)}`, rankingIntent: "best_match", correlationId: randomUUID() }, () => assert.fail("nothing to rank"));
        assert.equal(result.status, "failed");
        assert.equal(result.candidates.length, 0);
        assert.equal(result.refreshError?.code, "DISCOVERY_PROVIDER_UNAVAILABLE");
      });
    } finally {
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

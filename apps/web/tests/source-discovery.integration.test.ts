import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { hashPassword } from "../lib/auth/crypto";

/** Exa search results carrying the same videos a discovery batch fixture lists. */
function exaResults(batch: { youtube: Record<string, unknown>[] } & Record<string, unknown>): Response {
  return new Response(JSON.stringify({ results: batch.youtube.map((video) => ({ url: video.canonical_url, title: video.title, author: video.channel, highlights: video.evidence ?? [] })) }), { headers: { "content-type": "application/json" } });
}

const databaseAvailable = Boolean(
  process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL,
);

test(
  "an unseen direct YouTube source is deduplicated, queued for ingestion, and starts preparing Study",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { resolveSource }, { startOrResumeStudySession }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("../lib/study/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const email = `source-import-${randomUUID()}@example.test`;
    const user = await createEmailUser({ email, displayName: "Source Import Test", passwordHash: await hashPassword("source-import-password-123") });
    const youtubeId = "aB3dE5fG7hJ";
    const url = `https://www.youtube.com/watch?v=${youtubeId}`;
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (async (input) => {
      const requestUrl = String(input);
      assert.match(requestUrl, /^https:\/\/www\.youtube\.com\/oembed/);
      providerCalls += 1;
      return new Response(JSON.stringify({ title: "An unseen imported lesson", thumbnail_url: "https://i.ytimg.com/vi/aB3dE5fG7hJ/hqdefault.jpg", author_name: "Import Lab" }), { status: 200, headers: { "content-type": "application/json" } });
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
    const [{ createEmailUser }, { resolveSource }, { startOrResumeStudySession }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("../lib/study/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `paper-import-${randomUUID()}@example.test`, displayName: "Paper Import Test", passwordHash: await hashPassword("paper-import-password-123") });
    const arxivUrl = "https://arxiv.org/abs/1706.03762v7";
    const doiUrl = "https://doi.org/10.48550/arXiv.1706.03762";
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
      assert.equal(arxiv.arxivId, "1706.03762");
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
        await migrator`DELETE FROM catalog.paper_details WHERE resource_id IN ${migrator(resourceIds)}`;
        await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(resourceIds)}`;
      }
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "irrelevant catalog volume still queues refreshes and ranking intent creates a distinct run",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { searchSources }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `source-ranking-${randomUUID()}@example.test`, displayName: "Source Ranking Test", passwordHash: await hashPassword("source-ranking-password-123") });
    const resourceIds: string[] = [];
    const runIds: string[] = [];
    const originalFetch = globalThis.fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    const query = `Variational autoencoders ${randomUUID().slice(0, 8)}`;
    process.env.EXA_API_KEY = "test-exa-key";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl !== "https://api.exa.ai/search") return originalFetch(input, init);
      return exaResults({ youtube: [] });
    }) as typeof fetch;
    try {
      for (let index = 0; index < 6; index += 1) {
        const resourceId = randomUUID();
        const youtubeId = randomUUID().replaceAll("-", "").slice(0, 11);
        resourceIds.push(resourceId);
        await migrator`
          INSERT INTO catalog.resources
            (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
          VALUES
            (${resourceId}, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${`Unrelated catalog lesson ${index}`}, 'A topic unrelated to the explicit source-picker query.', 'public', 'ready', 0.95, '{}'::jsonb)
        `;
        await migrator`
          INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
          VALUES (${resourceId}, ${youtubeId}, 'Unrelated Catalog Lab', 600000, now())
        `;
      }
      const best = await searchSources(user.id, { mode: "learn", query, rankingIntent: "best_match", correlationId: randomUUID() });
      const practical = await searchSources(user.id, { mode: "learn", query, rankingIntent: "practical", correlationId: randomUUID() });
      runIds.push(best.runId ?? "", practical.runId ?? "");
      assert.ok(best.runId);
      assert.ok(practical.runId);
      assert.notEqual(best.runId, practical.runId);
      assert.equal(best.status, "searching");
      assert.equal(practical.status, "searching");
      const runs = await migrator<{ id: string; status: string; context_snapshot: Record<string, unknown> }[]>`
        SELECT id, status, context_snapshot
        FROM discovery.recommendation_runs
        WHERE id IN ${migrator(runIds)}
      `;
      assert.ok(runs.every((run) => run.status === "running"));
      assert.deepEqual(new Set(runs.map((run) => run.context_snapshot.rankingIntent)), new Set(["best_match", "practical"]));
      const refreshes = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM ops.outbox_events
        WHERE user_id = ${user.id} AND event_type = 'discovery.refresh_requested'
          AND payload->>'source' = 'source-picker'
      `;
      assert.equal(refreshes[0]?.count, "2");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      if (runIds.some(Boolean)) await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN ${migrator(runIds.filter(Boolean))}`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      if (resourceIds.length > 0) {
        await migrator`DELETE FROM catalog.video_details WHERE resource_id IN ${migrator(resourceIds)}`;
        await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(resourceIds)}`;
      }
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "python beginner regression keeps unrelated catalog rows out and returns qualified fast candidates",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { getSourceDiscoveryRun, searchSources }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `source-python-${randomUUID()}@example.test`, displayName: "Python Source Test", passwordHash: await hashPassword("source-python-password-123") });
    const catalogResourceIds: string[] = [];
    let runId = "";
    const originalFetch = globalThis.fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    const query = `python for beginners ${randomUUID().slice(0, 8)}`;
    let seenQuery = "";
    let seenLimit = 0;
    process.env.EXA_API_KEY = "test-exa-key";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl !== "https://api.exa.ai/search") return originalFetch(input, init);
      const request = JSON.parse(String(init?.body ?? "{}")) as { query?: string; numResults?: number };
      seenQuery = request.query ?? "";
      seenLimit = request.numResults ?? 0;
      return exaResults({
        trace_id: "python-regression-test",
        youtube: Array.from({ length: 30 }, (_, index) => {
          const youtubeId = `A${index.toString(36).padStart(10, "0")}`;
          return {
            youtube_id: youtubeId,
            canonical_url: `https://www.youtube.com/watch?v=${youtubeId}`,
            title: `${query} - Lesson ${index + 1}`,
            channel: "Fresh Python Lab",
            confidence: 0.95 - index * 0.01,
            learning_format: index % 2 === 0 ? "clear_explanations" : "hands_on",
            estimated_level: "beginner",
            has_implementation: index % 2 === 1,
            evidence: ["beginner Python course"],
          };
        }),
        arxiv: [],
      });
    }) as typeof fetch;
    try {
      const unrelatedTitles = [
        "Meet Pi: The Minimalist, Self-Modifying Coding Agent",
        "OpenAI Image Generation Tutorial",
        "Kubernetes Networking Explained",
        "React Component Patterns",
        "Docker Containers for Developers",
        "How to Add an Auto-Updater to ANY Python App",
      ];
      for (const [index, title] of unrelatedTitles.entries()) {
        const resourceId = randomUUID();
        const youtubeId = randomUUID().replaceAll("-", "").slice(0, 11);
        catalogResourceIds.push(resourceId);
        await migrator`
          INSERT INTO catalog.resources
            (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
          VALUES
            (${resourceId}, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${title}, ${index === 5 ? "A production app walkthrough for experienced developers." : "A high quality lesson about a different subject."}, 'public', 'ready', 0.95, ${migrator.json(index === 5 ? {} : { estimatedLevel: "beginner" })})
        `;
        await migrator`
          INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
          VALUES (${resourceId}, ${youtubeId}, 'Catalog Fixture Lab', 600000, now())
        `;
      }

      let initial = await searchSources(user.id, { mode: "learn", query, rankingIntent: "best_match", correlationId: randomUUID() });
      runId = initial.runId ?? "";
      if (initial.candidates.length === 0) {
        const deadline = Date.now() + 2_000;
        while (!seenQuery && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
        await new Promise((resolve) => setTimeout(resolve, 50));
        initial = await searchSources(user.id, { mode: "learn", query, rankingIntent: "best_match", correlationId: randomUUID() });
        runId = initial.runId ?? runId;
      }
      assert.equal(initial.status, "completed");
      assert.equal(seenQuery, `videos on ${query}`);
      assert.equal(seenLimit, 30);
      assert.equal(initial.candidates.length, 30);
      assert.ok(initial.candidates.every((candidate) => candidate.title.includes(query.slice(-8))));
      assert.ok(initial.candidates.every((candidate) => candidate.sourceOrigin === "external_refresh"));
      assert.ok(initial.candidates.every((candidate) => !candidate.resourceId));
      const candidateOutbox = await migrator<{ id: string }[]>`
        SELECT id
        FROM ops.outbox_events
        WHERE user_id = ${user.id} AND event_type = 'discovery.candidates_discovered'
        ORDER BY created_at DESC
        LIMIT 30
      `;
      assert.equal(candidateOutbox.length, 0);
      const [pendingRun] = await migrator<{ status: string; context_snapshot: Record<string, unknown> }[]>`
        SELECT status, context_snapshot FROM discovery.recommendation_runs WHERE id = ${runId}
      `;
      assert.equal(pendingRun?.status, "completed");
      assert.equal(pendingRun?.context_snapshot.qualifiedCatalogCandidateCount, 0);
      const [persistedRun] = await migrator<{ status: string; refresh_status: string; diagnostics: Array<Record<string, unknown>> }[]>`
        SELECT status, context_snapshot->>'refreshStatus' AS refresh_status, context_snapshot->'candidateDiagnostics' AS diagnostics
        FROM discovery.recommendation_runs WHERE id = ${runId}
      `;
      assert.equal(persistedRun?.status, "completed");
      assert.equal(persistedRun?.refresh_status, "not_needed");
      assert.equal(persistedRun?.diagnostics.length, 30);
      assert.ok(persistedRun?.diagnostics.every((diagnostic) => diagnostic.sourceOrigin === "external_refresh" && String(diagnostic.resourceId).startsWith("external:youtube:") && typeof diagnostic.queryRelevance === "number" && typeof diagnostic.qualificationReason === "string"));
      const [polled] = await migrator<{ context_snapshot: Record<string, unknown> }[]>`
        SELECT context_snapshot FROM discovery.recommendation_runs WHERE id = ${runId}
      `;
      const ephemeralCandidates = polled?.context_snapshot.ephemeralCandidates;
      assert.ok(Array.isArray(ephemeralCandidates));
      assert.equal(ephemeralCandidates.length, 30);
      const polledResponse = await getSourceDiscoveryRun(user.id, runId);
      assert.equal(polledResponse.status, "completed");
      assert.equal(polledResponse.candidates.length, 30);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      if (runId) await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${runId}`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      if (catalogResourceIds.length > 0) {
        await migrator`DELETE FROM catalog.video_details WHERE resource_id IN ${migrator(catalogResourceIds)}`;
        await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(catalogResourceIds)}`;
      }
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "interactive Rust discovery avoids false concept matches and returns qualified candidates without worker latency",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { searchSources, resolveSource }, { startOrResumeStudySession }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("../lib/study/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `source-fast-${randomUUID()}@example.test`, displayName: "Fast Source Test", passwordHash: await hashPassword("source-fast-password-123") });
    const originalFetch = globalThis.fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    const query = `Rust for beginners ${randomUUID().slice(0, 8)}`;
    let seenQuery = "";
    process.env.EXA_API_KEY = "test-exa-key";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl.startsWith("https://www.youtube.com/oembed")) {
        return new Response(JSON.stringify({ title: "Rust for Beginners - Full Course", thumbnail_url: "https://i.ytimg.com/vi/aB3dE5fG7hJ/hqdefault.jpg", author_name: "Fast Source Lab" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (requestUrl !== "https://api.exa.ai/search") return originalFetch(input, init);
      seenQuery = JSON.parse(String(init?.body ?? "{}")).query as string;
      return exaResults({
        trace_id: "instant-test",
        youtube: [
          { youtube_id: "aB3dE5fG7hJ", canonical_url: "https://www.youtube.com/watch?v=aB3dE5fG7hJ", title: `${query} - Full Course`, channel: "Fast Source Lab", confidence: 0.95, evidence: ["beginner Rust course"] },
          { youtube_id: "bC4eF6gH8iK", canonical_url: "https://www.youtube.com/watch?v=bC4eF6gH8iK", title: `Learn ${query} step by step`, channel: "Fast Source Lab", confidence: 0.9, evidence: ["Rust fundamentals for beginners"] },
          { youtube_id: "cD5fG7hI9jL", canonical_url: "https://www.youtube.com/watch?v=cD5fG7hI9jL", title: `Beginner projects — ${query}`, channel: "Fast Source Lab", confidence: 0.88, evidence: ["hands-on beginner Rust projects"] },
        ],
        arxiv: [],
      });
    }) as typeof fetch;
    let runId = "";
    let resourceId = "";
    let sessionId = "";
    try {
      const result = await searchSources(user.id, { mode: "learn", query, rankingIntent: "best_match", correlationId: randomUUID() });
      runId = result.runId ?? "";
      assert.equal(result.status, "completed");
      assert.equal(seenQuery, `videos on ${query}`);
      assert.equal(result.candidates.length, 3);
      assert.equal(result.candidates.every((candidate) => candidate.sourceOrigin === "external_refresh"), true);
      assert.equal(result.candidates.every((candidate) => !candidate.resourceId), true);
      const [run] = await migrator<{ canonical_concept_name: string | null }[]>`
        SELECT context_snapshot->>'canonicalConceptName' AS canonical_concept_name
        FROM discovery.recommendation_runs
        WHERE id = ${runId}
      `;
      assert.equal(run?.canonical_concept_name, null);
      const outbox = await migrator<{ event_type: string }[]>`
        SELECT event_type FROM ops.outbox_events
        WHERE user_id = ${user.id} AND aggregate_id = ${runId}
      `;
      assert.deepEqual(outbox.map((row) => row.event_type), []);
      assert.equal(result.timings?.totalMs !== undefined, true);
      const selected = result.candidates[0];
      assert.ok(selected?.canonicalUrl);
      const preview = await resolveSource(user.id, {
        mode: "learn",
        url: selected.canonicalUrl,
        correlationId: randomUUID(),
        recommendationRunId: result.runId ?? undefined,
      });
      resourceId = preview.resourceId;
      const started = await startOrResumeStudySession(user.id, {
        resourceId,
        origin: "discover",
        recommendationRunId: result.runId ?? undefined,
        idempotencyKey: `source-fast-${randomUUID()}`,
        correlationId: randomUUID(),
      });
      sessionId = started.sessionId;
      assert.equal(started.route, `/app/study/video/${sessionId}`);
      assert.equal(started.readiness, "preparing");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM activity.activity_events WHERE user_id = ${user.id}`;
      if (sessionId) {
        await migrator`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
        await migrator`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
      }
      await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM ops.idempotency_records WHERE user_id = ${user.id}`;
      if (runId) await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${runId}`;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
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
  "a provider result arriving after the response budget completes the existing partial run",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { getSourceDiscoveryRun, searchSources }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `source-late-${randomUUID()}@example.test`, displayName: "Late Source Test", passwordHash: await hashPassword("source-late-password-123") });
    const originalFetch = globalThis.fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    const query = `Rust ownership for beginners ${randomUUID().slice(0, 8)}`;
    process.env.EXA_API_KEY = "test-exa-key";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl !== "https://api.exa.ai/search") return originalFetch(input, init);
      await new Promise((resolve) => setTimeout(resolve, 650));
      return exaResults({
        trace_id: "late-source-test",
        youtube: [
          { youtube_id: "dE7fG9hJ1kL", canonical_url: "https://www.youtube.com/watch?v=dE7fG9hJ1kL", title: `${query} — Full Course`, channel: "Late Source Lab", confidence: 0.95, evidence: ["Rust ownership for beginners"] },
          { youtube_id: "eF8gH0iK2mN", canonical_url: "https://www.youtube.com/watch?v=eF8gH0iK2mN", title: `Learn ${query} step by step`, channel: "Late Source Lab", confidence: 0.92, evidence: ["beginner ownership lesson"] },
          { youtube_id: "fG9hI1jK3nP", canonical_url: "https://www.youtube.com/watch?v=fG9hI1jK3nP", title: `Practical ${query} projects`, channel: "Late Source Lab", confidence: 0.9, evidence: ["hands-on Rust ownership"] },
        ],
        arxiv: [],
      });
    }) as typeof fetch;
    let runId = "";
    try {
      const initial = await searchSources(user.id, { mode: "learn", query, rankingIntent: "best_match", correlationId: randomUUID() });
      runId = initial.runId ?? "";
      assert.equal(initial.status, "searching");
      assert.equal(initial.candidates.length, 0);
      const deadline = Date.now() + 3_000;
      let completed: Awaited<ReturnType<typeof getSourceDiscoveryRun>> | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        completed = await getSourceDiscoveryRun(user.id, runId);
        if (completed.status === "completed") break;
      }
      assert.equal(completed?.status, "completed");
      assert.equal(completed?.candidates.length, 3);
      assert.ok(completed?.candidates.every((candidate) => candidate.sourceOrigin === "external_refresh"));
    } finally {
      globalThis.fetch = originalFetch;
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      if (runId) await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${runId}`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

test(
  "a fast provider failure reaches a terminal run instead of polling forever",
  { skip: databaseAvailable ? false : "database URLs are required" },
  async () => {
    const [{ createEmailUser }, { getSourceDiscoveryRun, searchSources }, { closeDb }] = await Promise.all([
      import("../lib/auth/repository"),
      import("../lib/source-discovery/service"),
      import("@learnspace/db"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const user = await createEmailUser({ email: `source-failure-${randomUUID()}@example.test`, displayName: "Provider Failure Test", passwordHash: await hashPassword("source-failure-password-123") });
    const originalFetch = globalThis.fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    const query = `Rust error handling ${randomUUID().slice(0, 8)}`;
    process.env.EXA_API_KEY = "test-exa-key";
    globalThis.fetch = (async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl !== "https://api.exa.ai/search") return originalFetch(input, init);
      assert.equal(JSON.parse(String(init?.body ?? "{}")).query, `videos on ${query}`);
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    let runId = "";
    try {
      const initial = await searchSources(user.id, { mode: "learn", query, rankingIntent: "best_match", correlationId: randomUUID() });
      runId = initial.runId ?? "";
      assert.equal(initial.status, "searching");
      const deadline = Date.now() + 2_000;
      let terminal: Awaited<ReturnType<typeof getSourceDiscoveryRun>> | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        terminal = await getSourceDiscoveryRun(user.id, runId);
        if (terminal.status === "failed") break;
      }
      assert.equal(terminal?.status, "failed");
      assert.equal(terminal?.refreshError?.code, "DISCOVERY_PROVIDER_UNAVAILABLE");
    } finally {
      globalThis.fetch = originalFetch;
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${user.id}`;
      if (runId) await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${runId}`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${user.id}`;
      await migrator`DELETE FROM identity.users WHERE id = ${user.id}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

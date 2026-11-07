import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";
import postgres from "postgres";
import { runDiscoveryWorker, runDiscoveryWorkerLoop } from "./discovery.js";
import { handleWorkerRequest } from "./edge.js";

const databaseAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_WORKER_URL);
after(closeRecommendationRedis);

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test(
  "source-picker refreshes complete or fail terminally through the worker lifecycle",
  { skip: databaseAvailable ? false : "DATABASE_MIGRATOR_URL and DATABASE_WORKER_URL are required" },
  async () => {
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const traceId = `source-picker-worker-${randomUUID()}`;
    const userId = randomUUID();
    const conceptId = randomUUID();
    const runId = randomUUID();
    const outboxId = randomUUID();
    const globalJobId = randomUUID();
    const correlationId = randomUUID();
    const email = `${traceId}@example.test`;
    const youtubeIds = [0, 1, 2].map(() => randomUUID().replaceAll("-", "").slice(0, 11));
    const failedRunId = randomUUID();
    const failedJobId = randomUUID();
    const leaseRunId = randomUUID();
    const leaseJobId = randomUUID();
    const instantRunId = randomUUID();
    const instantOutboxId = randomUUID();
    const instantTraceId = `instant-source-picker-${randomUUID()}`;
    const instantYoutubeId = "zY7xW5vU3tS";
    let reportAgentFailure = false;
    const sourceResourceIds: string[] = [];
    let seenRequest: Record<string, unknown> | null = null;
    const realFetch = globalThis.fetch;
    // Exa is the only provider; a rejected key is a hard failure that the source picker must surface.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== "https://api.exa.ai/search") return realFetch(input, init);
      seenRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (reportAgentFailure) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({
        results: youtubeIds.map((youtubeId, index) => ({
          url: `https://www.youtube.com/watch?v=${youtubeId}`,
          title: ["Python for Beginners - Full Course", "Learn Python Variables", "Beginner Python Projects"][index],
          author: "Source Picker Lab",
          highlights: ["Deterministic worker integration candidate"],
        })),
      }));
    }) as typeof fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = "source-picker-worker-test";

    try {
      await migrator.begin(async (tx) => {
        await tx`
          INSERT INTO identity.users (id, email, email_verified, status, display_name)
          VALUES (${userId}, ${email}, true, 'active', 'Source Picker Worker Test')
        `;
        await tx`
          INSERT INTO knowledge.concepts (id, slug, name, kind, status)
          VALUES (${conceptId}, ${`source-picker-worker-${randomUUID()}`}, 'Python', 'topic', 'active')
        `;
        await tx`
          INSERT INTO discovery.recommendation_runs
            (id, user_id, surface, query_text, strategy_version, feature_version, context_snapshot, status)
          VALUES
            (${runId}, ${userId}, 'source_picker', 'python for beginners', 'test', 'test', ${tx.json({ mode: "learn", canonicalConceptId: conceptId, canonicalConceptName: "Python", rankingIntent: "best_match", refreshStatus: "requested" })}, 'running')
        `;
        await tx`
          INSERT INTO ops.outbox_events
            (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id, correlation_id)
          VALUES
            (${outboxId}, 'resource', ${runId}, 'discovery.refresh_requested', 1, ${userId}, ${tx.json({ conceptIds: [conceptId], conceptNames: ["Python"], queryText: "python for beginners", sourceKind: "video", sourcePickerRunId: runId })}, ${traceId}, ${correlationId})
        `;
        await tx`
          INSERT INTO ops.jobs
            (id, queue, job_type, payload, status, priority, dedup_key, idempotency_key, trace_id, finished_at)
          VALUES
            (${globalJobId}, 'discovery', 'discovery.refresh_concept', ${tx.json({ concept_id: conceptId, concept_name: "Python", concept_ids: [conceptId], concept_names: ["Python"], refresh_reason: "scheduled" })}, 'done', 0, ${`discovery:${conceptId}:refresh`}, ${`existing-${traceId}`}, ${`existing-${traceId}`}, now())
        `;
      });

      const result = await runDiscoveryWorker();
      assert.equal(result.status, "done");
      const requestPayload = seenRequest as Record<string, unknown> | null;
      assert.ok(requestPayload);
      assert.match(String(requestPayload.query), /python for beginners$/);

      const [run] = await migrator<{ status: string; context_snapshot: Record<string, unknown> }[]>`
        SELECT status, context_snapshot FROM discovery.recommendation_runs WHERE id = ${runId}
      `;
      assert.equal(run?.status, "completed");
      assert.equal(run?.context_snapshot.refreshStatus, "done");

      const [sourceJob] = await migrator<{ status: string; source_picker_run_id: string; priority: number }[]>`
        SELECT status, payload->>'source_picker_run_id' AS source_picker_run_id, priority
        FROM ops.jobs
        WHERE dedup_key = ${`discovery:source-picker:${runId}`}
      `;
      assert.equal(sourceJob?.status, "done");
      assert.equal(sourceJob?.source_picker_run_id, runId);
      assert.equal(sourceJob?.priority, 10);

      const resources = await migrator<{ id: string; title: string; owner_user_id: string | null; visibility: string }[]>`
        SELECT id, title, owner_user_id, visibility FROM catalog.resources
        WHERE provider = 'youtube' AND external_id IN ${migrator(youtubeIds)} AND owner_user_id = ${userId}
      `;
      sourceResourceIds.push(...resources.map((resource) => resource.id));
      assert.deepEqual(new Set(resources.map((resource) => resource.title)), new Set(["Python for Beginners - Full Course", "Learn Python Variables", "Beginner Python Projects"]));
      assert.ok(resources.every((resource) => resource.owner_user_id === userId && resource.visibility === "private"));
      const publicResources = await migrator<{ id: string }[]>`
        SELECT id
        FROM catalog.resources
        WHERE provider = 'youtube' AND external_id IN ${migrator(youtubeIds)} AND owner_user_id IS NULL
      `;
      assert.equal(publicResources.length, 0);

      await migrator`
        INSERT INTO discovery.recommendation_runs
          (id, user_id, surface, query_text, strategy_version, feature_version, context_snapshot, status, completed_at)
        VALUES
          (${instantRunId}, ${userId}, 'source_picker', 'python for beginners', 'test', 'test', ${migrator.json({ mode: "learn", canonicalConceptId: conceptId, canonicalConceptName: "Python", rankingIntent: "best_match", refreshStatus: "pending_persistence" })}, 'completed', now())
      `;
      await migrator`
        INSERT INTO ops.outbox_events
          (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id, correlation_id)
        VALUES
          (${instantOutboxId}, 'recommendation_run', ${instantRunId}, 'discovery.candidates_discovered', 1, ${userId}, ${migrator.json({
            sourcePickerRunId: instantRunId,
            queryText: "python for beginners",
            sourceKind: "video",
            conceptIds: [conceptId],
            candidateBatch: {
              trace_id: instantTraceId,
              youtube: [{
                youtube_id: instantYoutubeId,
                canonical_url: `https://www.youtube.com/watch?v=${instantYoutubeId}`,
                title: "Python for Beginners - Persisted Fast Candidate",
                channel: "Fast Candidate Lab",
                matched_concept_ids: [conceptId],
                learning_format: "clear_explanations",
                estimated_level: "beginner",
                has_implementation: false,
                confidence: 0.9,
                evidence: ["fast-path persistence fixture"],
              }],
              arxiv: [],
            },
          })}, ${instantTraceId}, ${randomUUID()})
      `;
      const originalFetch = globalThis.fetch;
      const originalKey = process.env.OPENAI_API_KEY;
      const originalSemantic = process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED;
      process.env.OPENAI_API_KEY = "worker-integration-key";
      process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED = "true";
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
      globalThis.fetch = async (input, init) => {
        if (String(input) !== "https://api.openai.com/v1/embeddings") return originalFetch(input, init);
        entered(); await gate;
        const count = (JSON.parse(String(init?.body)) as { input: string[] }).input.length;
        return new Response(JSON.stringify({ data: Array.from({ length: count }, (_, index) => ({ index, embedding: Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0) })) }), { status: 200, headers: { "content-type": "application/json" } });
      };
      // Claim one immediate job, then keep maintenance waiting on the provider.
      // A second queued job must finish before that provider is released.
      const stop = new AbortController();
      const loop = runDiscoveryWorkerLoop({ signal: stop.signal, intervalMs: 1000 });
      try {
        await Promise.race([providerEntered, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("maintenance did not reach the provider")), 10000); timer.unref(); })]);
        const queuedId = randomUUID();
        await migrator`INSERT INTO ops.jobs (id,queue,job_type,payload,status,priority,trace_id) VALUES (${queuedId},'discovery','discovery.persist_candidates',${migrator.json({ candidate_batch: { trace_id: traceId, youtube: [], arxiv: [], failures: [] } })},'pending',100,${traceId})`;
        const deadline = Date.now() + 5000;
        let done = false;
        while (Date.now() < deadline) {
          const [job] = await migrator<{ status: string }[]>`SELECT status FROM ops.jobs WHERE id = ${queuedId}`;
          if (job?.status === "done") { done = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(done, "a slow embedding provider cannot starve queued discovery jobs");
      } finally {
        stop.abort(); release(); await loop;
        globalThis.fetch = originalFetch;
        restoreEnv("OPENAI_API_KEY", originalKey);
        restoreEnv("LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED", originalSemantic);
      }
      const [instantRun] = await migrator<{ status: string; refresh_status: string }[]>`
        SELECT status, context_snapshot->>'refreshStatus' AS refresh_status
        FROM discovery.recommendation_runs WHERE id = ${instantRunId}
      `;
      assert.deepEqual(instantRun, { status: "completed", refresh_status: "done" });
      const [instantJob] = await migrator<{ status: string; job_type: string }[]>`
        SELECT status, job_type FROM ops.jobs
        WHERE dedup_key = ${`discovery:source-picker-persist:${instantRunId}`}
      `;
      assert.deepEqual(instantJob, { status: "done", job_type: "discovery.persist_candidates" });
      const [instantResource] = await migrator<{ id: string }[]>`
        SELECT id FROM catalog.resources WHERE provider = 'youtube' AND external_id = ${instantYoutubeId} AND owner_user_id = ${userId}
      `;
      if (instantResource) sourceResourceIds.push(instantResource.id);

      await migrator`
        INSERT INTO discovery.recommendation_runs
          (id, user_id, surface, query_text, strategy_version, feature_version, context_snapshot, status)
        VALUES
          (${failedRunId}, ${userId}, 'source_picker', 'A failing source search', 'test', 'test', ${migrator.json({ mode: "learn", rankingIntent: "best_match", refreshStatus: "requested" })}, 'running')
      `;
      await migrator`
        INSERT INTO ops.jobs
          (id, queue, job_type, payload, status, priority, max_attempts, dedup_key, idempotency_key, trace_id)
        VALUES
          (${failedJobId}, 'discovery', 'discovery.refresh_concept', ${migrator.json({ concept_ids: [conceptId], concept_names: ["Python"], query_text: "A failing source search", source_kind: "video", source_picker_run_id: failedRunId, audit_user_id: userId, force_refresh: true })}, 'pending', 10, 1, ${`discovery:source-picker:${failedRunId}`}, ${`failed-${failedRunId}`}, ${`failed-${failedRunId}`})
      `;
      reportAgentFailure = true;
      await assert.rejects(() => runDiscoveryWorker(), /discovery found no candidates: youtube:.*ExaHTTP401/);
      const [failedRun] = await migrator<{ status: string; context_snapshot: Record<string, unknown> }[]>`
        SELECT status, context_snapshot FROM discovery.recommendation_runs WHERE id = ${failedRunId}
      `;
      assert.equal(failedRun?.status, "failed");
      assert.equal(failedRun?.context_snapshot.refreshStatus, "failed");
      const [failedJob] = await migrator<{ status: string }[]>`SELECT status FROM ops.jobs WHERE id = ${failedJobId}`;
      assert.equal(failedJob?.status, "dead");

      await migrator`
        INSERT INTO discovery.recommendation_runs
          (id, user_id, surface, query_text, strategy_version, feature_version, context_snapshot, status)
        VALUES
          (${leaseRunId}, ${userId}, 'source_picker', 'Lease expiry search', 'test', 'test', ${migrator.json({ mode: "learn", rankingIntent: "best_match", refreshStatus: "requested" })}, 'running')
      `;
      await migrator`
        INSERT INTO ops.jobs
          (id, queue, job_type, payload, status, attempts, max_attempts, lease_expires_at, dedup_key, idempotency_key, trace_id)
        VALUES
          (${leaseJobId}, 'discovery', 'discovery.refresh_concept', ${migrator.json({ query_text: "Lease expiry search", source_kind: "video", source_picker_run_id: leaseRunId })}, 'running', 1, 1, now() - interval '1 minute', ${`discovery:source-picker:${leaseRunId}`}, ${`lease-${leaseRunId}`}, ${`lease-${leaseRunId}`})
      `;
      const reclaimed = await runDiscoveryWorker();
      assert.equal(reclaimed.status, "idle");
      const [reclaimedRun] = await migrator<{ status: string; context_snapshot: Record<string, unknown> }[]>`
        SELECT status, context_snapshot FROM discovery.recommendation_runs WHERE id = ${leaseRunId}
      `;
      assert.equal(reclaimedRun?.status, "failed");
      assert.equal(reclaimedRun?.context_snapshot.refreshStatus, "failed");
    } finally {
      globalThis.fetch = realFetch;
      restoreEnv("EXA_API_KEY", previousExaKey);
      await migrator`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (${runId}, ${failedRunId}, ${instantRunId}, ${leaseRunId})`;
      await migrator`DELETE FROM catalog.resource_concepts WHERE concept_id = ${conceptId}`;
      if (sourceResourceIds.length > 0) {
        await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id IN ${migrator(sourceResourceIds)}`;
        await migrator`DELETE FROM catalog.video_details WHERE resource_id IN ${migrator(sourceResourceIds)}`;
        await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(sourceResourceIds)}`;
      } else {
        await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id IN (SELECT id FROM catalog.resources WHERE provider = 'youtube' AND external_id IN ${migrator(youtubeIds)} AND owner_user_id IS NULL)`;
        await migrator`DELETE FROM catalog.video_details WHERE resource_id IN (SELECT id FROM catalog.resources WHERE provider = 'youtube' AND external_id IN ${migrator(youtubeIds)} AND owner_user_id IS NULL)`;
        await migrator`DELETE FROM catalog.resources WHERE provider = 'youtube' AND external_id IN ${migrator(youtubeIds)} AND owner_user_id IS NULL`;
      }
      await migrator`DELETE FROM ops.jobs WHERE trace_id IN (${traceId}, ${`existing-${traceId}`}, ${`failed-${failedRunId}`}, ${instantTraceId}, ${`lease-${leaseRunId}`}) OR id IN (${failedJobId}, ${leaseJobId}) OR dedup_key IN (${`discovery:source-picker:${runId}`}, ${`discovery:source-picker-persist:${instantRunId}`}, ${`discovery:source-picker:${leaseRunId}`})`;
      await migrator`DELETE FROM ops.outbox_events WHERE id IN (${outboxId}, ${instantOutboxId})`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE id IN (${runId}, ${failedRunId}, ${instantRunId}, ${leaseRunId})`;
      await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id IN (SELECT id FROM catalog.resources WHERE owner_user_id = ${userId})`;
      await migrator`DELETE FROM catalog.video_details WHERE resource_id IN (SELECT id FROM catalog.resources WHERE owner_user_id = ${userId})`;
      await migrator`DELETE FROM catalog.resources WHERE owner_user_id = ${userId}`;
      await migrator`DELETE FROM knowledge.concepts WHERE id = ${conceptId}`;
      await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
      await migrator.end({ timeout: 5 });
    }
  },
);

test(
  "a committed discovery request wakes idle lanes, runs its concept lanes in parallel and shares lanes across learners",
  { skip: databaseAvailable ? false : "DATABASE_MIGRATOR_URL and DATABASE_WORKER_URL are required" },
  async () => {
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const traceId = `discovery-wake-${randomUUID()}`;
    const userId = randomUUID();
    const conceptIds = [randomUUID(), randomUUID()];
    const outboxId = randomUUID();
    const secondOutboxId = randomUUID();
    let inFlight = 0;
    let maxInFlight = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://export.arxiv.org/")) return new Response("<feed></feed>");
      if (url !== "https://api.exa.ai/search") return realFetch(input, init);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 600));
      inFlight -= 1;
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;
    const previousExaKey = process.env.EXA_API_KEY;
    const previousSemantic = process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED;
    process.env.EXA_API_KEY = "discovery-wake-test";
    process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED = "false";
    // A minute-long poll interval: only the NOTIFY can start these jobs within the deadline.
    const stop = new AbortController();
    const loop = runDiscoveryWorkerLoop({ signal: stop.signal, intervalMs: 60_000, concurrency: 2 });
    try {
      await migrator`INSERT INTO identity.users (id, email, email_verified, status, display_name) VALUES (${userId}, ${`${traceId}@example.test`}, true, 'active', 'Discovery Wake Test')`;
      for (const [index, id] of conceptIds.entries()) {
        await migrator`INSERT INTO knowledge.concepts (id, slug, name, kind, status) VALUES (${id}, ${`${traceId}-${index}`}, ${`Wake concept ${index}`}, 'topic', 'active')`;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const committedAt = Date.now();
      await migrator`
        INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id)
        VALUES (${outboxId}, 'user', ${userId}, 'discovery.refresh_requested', 1, ${userId}, ${migrator.json({ conceptIds, conceptNames: ["Wake concept 0", "Wake concept 1"], persona: "builder" })}, ${traceId})
      `;
      const waitForDone = async (count: number) => {
        let finished = 0;
        while (Date.now() - committedAt < 10_000) {
          const [row] = await migrator<{ done: string }[]>`SELECT count(*) AS done FROM ops.jobs WHERE trace_id = ${traceId} AND status = 'done'`;
          finished = Number(row?.done ?? 0);
          if (finished >= count) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return finished;
      };
      assert.equal(await waitForDone(4), 4, "a builder's two lanes per concept finish long before the next poll");
      assert.equal(maxInFlight, 2, "concept lanes are discovered in parallel");
      // A researcher on the same concepts adds only the missing lane; the shared recent lane is reused.
      await migrator`
        INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id)
        VALUES (${secondOutboxId}, 'user', ${userId}, 'discovery.refresh_requested', 1, ${userId}, ${migrator.json({ conceptIds, conceptNames: ["Wake concept 0", "Wake concept 1"], persona: "researcher" })}, ${traceId})
      `;
      assert.equal(await waitForDone(6), 6);
      const lanes = await migrator<{ lane: string; jobs: string }[]>`
        SELECT payload->>'ranking_intent' AS lane, count(*) AS jobs FROM ops.jobs WHERE trace_id = ${traceId} GROUP BY 1 ORDER BY 1
      `;
      assert.deepEqual(lanes.map(({ lane, jobs }) => [lane, Number(jobs)]), [["in_depth", 2], ["practical", 2], ["recent", 2]]);
    } finally {
      stop.abort();
      await loop;
      globalThis.fetch = realFetch;
      restoreEnv("EXA_API_KEY", previousExaKey);
      restoreEnv("LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED", previousSemantic);
      await migrator`DELETE FROM ops.jobs WHERE trace_id = ${traceId}`;
      await migrator`DELETE FROM ops.outbox_events WHERE id IN (${outboxId}, ${secondOutboxId})`;
      await migrator`DELETE FROM knowledge.concepts WHERE id IN ${migrator(conceptIds)}`;
      await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
      await migrator.end({ timeout: 5 });
    }
  },
);

test(
  "the serverless entry rejects a wrong secret and drains a committed request in the background",
  { skip: databaseAvailable ? false : "DATABASE_MIGRATOR_URL and DATABASE_WORKER_URL are required" },
  async () => {
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL as string, { max: 1, prepare: false, connect_timeout: 10 });
    const traceId = `discovery-edge-${randomUUID()}`;
    const userId = randomUUID();
    const conceptIds = [randomUUID(), randomUUID()];
    const outboxId = randomUUID();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://export.arxiv.org/")) return new Response("<feed></feed>");
      if (url !== "https://api.exa.ai/search") return realFetch(input, init);
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;
    const previous = { EXA_API_KEY: process.env.EXA_API_KEY, LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED: process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED, WORKER_TRIGGER_SECRET: process.env.WORKER_TRIGGER_SECRET };
    process.env.EXA_API_KEY = "discovery-edge-test";
    process.env.LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED = "false";
    process.env.WORKER_TRIGGER_SECRET = "edge-test-secret";
    const work: Promise<unknown>[] = [];
    const call = (authorization: string) => handleWorkerRequest(
      new Request("http://worker.test/", { method: "POST", headers: { authorization }, body: "{}" }),
      (promise) => work.push(promise),
    );
    try {
      assert.equal((await call("Bearer wrong-secret")).status, 401);
      assert.equal(work.length, 0);
      await migrator`INSERT INTO identity.users (id, email, email_verified, status, display_name) VALUES (${userId}, ${`${traceId}@example.test`}, true, 'active', 'Discovery Edge Test')`;
      for (const [index, id] of conceptIds.entries()) {
        await migrator`INSERT INTO knowledge.concepts (id, slug, name, kind, status) VALUES (${id}, ${`${traceId}-${index}`}, ${`Edge concept ${index}`}, 'topic', 'active')`;
      }
      await migrator`
        INSERT INTO ops.outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id)
        VALUES (${outboxId}, 'user', ${userId}, 'discovery.refresh_requested', 1, ${userId}, ${migrator.json({ conceptIds, conceptNames: ["Edge concept 0", "Edge concept 1"], persona: "builder" })}, ${traceId})
      `;
      assert.equal((await call("Bearer edge-test-secret")).status, 202);
      await Promise.all(work);
      const [row] = await migrator<{ done: string }[]>`SELECT count(*) AS done FROM ops.jobs WHERE trace_id = ${traceId} AND status = 'done'`;
      assert.equal(Number(row?.done), 4, "one invocation runs every lane the request created");
    } finally {
      globalThis.fetch = realFetch;
      for (const [name, value] of Object.entries(previous)) restoreEnv(name, value);
      await migrator`DELETE FROM ops.jobs WHERE trace_id = ${traceId}`;
      await migrator`DELETE FROM ops.outbox_events WHERE id = ${outboxId}`;
      await migrator`DELETE FROM knowledge.concepts WHERE id IN ${migrator(conceptIds)}`;
      await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
      await migrator.end({ timeout: 5 });
    }
  },
);

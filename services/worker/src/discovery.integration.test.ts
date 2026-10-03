import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";
import postgres from "postgres";
import { runDiscoveryWorker } from "./discovery.js";

const databaseAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_WORKER_URL);
after(closeRecommendationRedis);

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("fake discovery agent did not bind a port"));
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

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
    const agent = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      seenRequest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (reportAgentFailure) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          trace_id: traceId,
          youtube: [],
          arxiv: [],
          failures: ["youtube:TimeoutError"],
        }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        trace_id: traceId,
        youtube: youtubeIds.map((youtubeId, index) => ({
          youtube_id: youtubeId,
          canonical_url: `https://www.youtube.com/watch?v=${youtubeId}`,
          title: ["Python for Beginners - Full Course", "Learn Python Variables", "Beginner Python Projects"][index],
          channel: "Source Picker Lab",
          matched_concept_ids: [conceptId],
          learning_format: index === 2 ? "hands_on" : "clear_explanations",
          estimated_level: "beginner",
          has_implementation: index === 2,
          confidence: 0.9,
          evidence: ["Deterministic worker integration candidate"],
        })),
        arxiv: [],
      }));
    });
    const port = await listen(agent);
    const previousAgentUrl = process.env.DISCOVERY_AGENT_URL;
    const previousToken = process.env.INTERNAL_SERVICE_TOKEN;
    process.env.DISCOVERY_AGENT_URL = `http://127.0.0.1:${port}`;
    process.env.INTERNAL_SERVICE_TOKEN = "source-picker-worker-test";

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
      assert.equal(requestPayload.query_text, "python for beginners");
      assert.deepEqual(requestPayload.concept_ids, [conceptId]);

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
      const instantResult = await runDiscoveryWorker();
      assert.equal(instantResult.status, "done");
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
      await assert.rejects(() => runDiscoveryWorker(), /discovery agent reported no candidates/);
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
      restoreEnv("DISCOVERY_AGENT_URL", previousAgentUrl);
      restoreEnv("INTERNAL_SERVICE_TOKEN", previousToken);
      await close(agent);
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

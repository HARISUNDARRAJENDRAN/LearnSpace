import { randomUUID } from "node:crypto";
import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";
import postgres from "postgres";
import { resourceIdsFromJobResult, runDiscoveryWorker } from "./discovery.js";
import { provisionSmokeLearner } from "./discovery-smoke-provision.js";

type SqlClient = ReturnType<typeof postgres>;

type HomeSectionCard = { resourceId?: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function feedContainsResource(value: unknown, resourceIds: Set<string>): boolean {
  if (!isObject(value) || !isObject(value.sections)) return false;
  return Object.values(value.sections).some((section) => (
    Array.isArray(section)
    && section.some((card): card is HomeSectionCard => (
      isObject(card) && typeof card.resourceId === "string" && resourceIds.has(card.resourceId)
    ))
  ));
}

async function linkedResourceCount(
  sql: SqlClient,
  conceptId: string,
  resourceIds: Set<string>,
): Promise<number> {
  if (resourceIds.size === 0) return 0;
  const rows = await sql<{ id: string }[]>`
    SELECT resource.id
    FROM catalog.resources AS resource
    INNER JOIN catalog.resource_concepts AS relation ON relation.resource_id = resource.id
    WHERE relation.concept_id = ${conceptId}
      AND resource.id IN ${sql([...resourceIds])}
  `;
  return rows.length;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cleanup(
  sql: SqlClient,
  traceId: string,
): Promise<void> {
  await sql`DELETE FROM ops.jobs WHERE trace_id = ${traceId}`;
}

function responseErrorCode(value: unknown): string {
  if (!isObject(value) || !isObject(value.error) || typeof value.error.code !== "string") {
    return "UNKNOWN";
  }
  return value.error.code;
}

async function stagingHomeContainsResource(
  webUrl: string,
  email: string,
  password: string,
  resourceIds: Set<string>,
): Promise<{ contains: boolean; runId: string | null; hasRecommendations: boolean }> {
  const baseUrl = webUrl.replace(/\/$/, "");
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, next: "/app" }),
  });
  if (!login.ok) {
    let body: unknown = null;
    try {
      body = await login.json();
    } catch {
      body = null;
    }
    throw new Error(`staging smoke learner login failed with HTTP ${login.status} (${responseErrorCode(body)})`);
  }
  const sessionCookie = login.headers.get("set-cookie")?.match(/learnspace_session=[^;]+/)?.[0];
  if (!sessionCookie) throw new Error("staging smoke login did not return a session cookie");
  const home = await fetch(`${baseUrl}/api/v1/discovery/home`, {
    headers: { Cookie: sessionCookie },
  });
  if (!home.ok) throw new Error(`staging smoke Home API failed with HTTP ${home.status}`);
  const body: unknown = await home.json();
  return {
    contains: feedContainsResource(body, resourceIds),
    runId: isObject(body) && typeof body.runId === "string" ? body.runId : null,
    hasRecommendations: isObject(body) && isObject(body.sections)
      && Array.isArray(body.sections.recommendedVideos) && body.sections.recommendedVideos.length > 0,
  };
}

async function main(): Promise<void> {
  const workerUrl = required("DATABASE_WORKER_URL");
  const migratorUrl = required("DATABASE_MIGRATOR_URL");
  const worker = postgres(workerUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const migrator = postgres(migratorUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const traceId = `staging-smoke-${randomUUID()}`;
  const conceptSlug = process.env.DISCOVERY_SMOKE_CONCEPT_SLUG ?? "ai-machine-learning";
  const webUrl = required("DISCOVERY_SMOKE_WEB_URL");
  const learnerEmail = required("DISCOVERY_SMOKE_EMAIL");
  const learnerPassword = required("DISCOVERY_SMOKE_PASSWORD");
  const [concept] = await worker<{ id: string; name: string }[]>`
    SELECT id, name FROM knowledge.concepts WHERE slug = ${conceptSlug} AND status = 'active'
  `;
  if (!concept) throw new Error(`staging smoke concept was not found: ${conceptSlug}`);
  try {
    await provisionSmokeLearner(migrator, {
      email: learnerEmail,
      password: learnerPassword,
      conceptId: concept.id,
    });
    const [job] = await worker<{ id: string }[]>`
      INSERT INTO ops.jobs (queue, job_type, payload, dedup_key, idempotency_key, trace_id)
      VALUES (
        'discovery',
        'discovery.refresh_concept',
        ${worker.json({
          concept_id: concept.id,
          concept_name: concept.name,
          concept_ids: [concept.id],
          concept_names: [concept.name],
          level: "mixed",
          preferred_formats: [],
          paper_strategy: "current",
          window_days: 30,
          force_refresh: true,
          trace_id: traceId,
        })},
        ${`staging-smoke:${traceId}`},
        ${traceId},
        ${traceId}
      )
      RETURNING id
    `;
    if (!job) throw new Error("staging discovery smoke job was not created");

    const deadline = Date.now() + Number(process.env.DISCOVERY_SMOKE_TIMEOUT_MS ?? 120_000);
    while (Date.now() < deadline) {
      try {
        if (process.env.DISCOVERY_SMOKE_EXTERNAL_WORKER !== "true") await runDiscoveryWorker();
      } catch {
        await sleep(2_000);
      }
      const [status] = await worker<{
        status: string;
        attempts: number;
        result: Record<string, unknown> | null;
      }[]>`
        SELECT status, attempts, result FROM ops.jobs WHERE id = ${job.id}
      `;
      if (status?.status === "dead") {
        throw new Error(`staging discovery smoke job became dead after ${status.attempts} attempts`);
      }
      if (status?.status === "done") {
        const resourceIds = new Set(resourceIdsFromJobResult(status.result));
        const providerCalls = typeof status.result?.providerCalls === "number"
          ? status.result.providerCalls
          : 0;
        const fallbackCalls = typeof status.result?.fallbackCalls === "number"
          ? status.result.fallbackCalls
          : 0;
        const requireProvider = process.env.DISCOVERY_SMOKE_REQUIRE_PROVIDER !== "false";
        if (resourceIds.size === 0) {
          throw new Error("staging discovery smoke completed without touched resource IDs");
        }
        if (requireProvider && providerCalls + fallbackCalls < 1) {
          throw new Error("staging discovery smoke completed without live provider-call evidence");
        }
        const linkedResources = await linkedResourceCount(worker, concept.id, resourceIds);
        if (linkedResources === 0) {
          throw new Error("staging discovery smoke completed without a persisted resource-concept relation");
        }
        const home = await stagingHomeContainsResource(
          webUrl,
          learnerEmail,
          learnerPassword,
          resourceIds,
        );
        // Ingestion makes a resource eligible; it should not force it above
        // stronger existing lessons or bypass the ranker's diversity rules.
        const ranked = home.runId ? await migrator<{ resource_id: string }[]>`
          SELECT resource_id FROM discovery.recommendation_candidates
          WHERE recommendation_run_id = ${home.runId}
            AND resource_id IN ${migrator([...resourceIds])}
        ` : [];
        if (home.hasRecommendations && (home.contains || ranked.length > 0)) {
          process.stdout.write(JSON.stringify({
            status: "passed",
            traceId,
            jobId: job.id,
            resources: resourceIds.size,
            linkedResources,
            providerCalls,
            fallbackCalls,
            liveToolCalls: providerCalls + fallbackCalls,
            cacheHit: status.result?.cacheHit === true,
            homeRunId: home.runId,
            homeSelectedCandidate: home.contains,
            homeRankedResources: ranked.length,
          }) + "\n");
          return;
        }
        throw new Error("staging discovery smoke completed but the authenticated Home feed did not rank any persisted candidate");
      }
      await sleep(2_000);
    }
    throw new Error("staging discovery smoke timed out");
  } finally {
    try {
      await cleanup(migrator, traceId);
    } finally {
      await Promise.all([
        worker.end({ timeout: 5 }),
        migrator.end({ timeout: 5 }),
        closeRecommendationRedis(),
      ]);
    }
  }
}

await main();

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { runDiscoveryWorker } from "./discovery.js";

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
  resourceIds: string[],
  traceId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    if (resourceIds.length > 0) {
      await tx`DELETE FROM discovery.discovery_interactions WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM discovery.recommendation_impressions WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM discovery.recommendation_candidates WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM activity.activity_events WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.library_items WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.resource_concepts WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.video_details WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.paper_details WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.resources WHERE id IN ${tx(resourceIds)}`;
    }
    await tx`DELETE FROM ops.jobs WHERE trace_id = ${traceId}`;
  });
}

async function stagingHomeContainsResource(
  webUrl: string,
  email: string,
  password: string,
  resourceIds: Set<string>,
): Promise<boolean> {
  const baseUrl = webUrl.replace(/\/$/, "");
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, next: "/app" }),
  });
  if (!login.ok) throw new Error(`staging smoke learner login failed with HTTP ${login.status}`);
  const sessionCookie = login.headers.get("set-cookie")?.match(/learnspace_session=[^;]+/)?.[0];
  if (!sessionCookie) throw new Error("staging smoke login did not return a session cookie");
  const home = await fetch(`${baseUrl}/api/v1/discovery/home`, {
    headers: { Cookie: sessionCookie },
  });
  if (!home.ok) throw new Error(`staging smoke Home API failed with HTTP ${home.status}`);
  return feedContainsResource(await home.json() as unknown, resourceIds);
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
  const startedAt = new Date();
  try {
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
        await runDiscoveryWorker();
      } catch {
        await sleep(2_000);
      }
      const [status] = await worker<{ status: string; attempts: number }[]>`
        SELECT status, attempts FROM ops.jobs WHERE id = ${job.id}
      `;
      if (status?.status === "dead") {
        throw new Error(`staging discovery smoke job became dead after ${status.attempts} attempts`);
      }
      if (status?.status === "done") {
        const resources = await worker<{ id: string }[]>`
          SELECT DISTINCT resource.id
          FROM catalog.resources AS resource
          INNER JOIN catalog.resource_concepts AS relation ON relation.resource_id = resource.id
          WHERE relation.concept_id = ${concept.id}
            AND resource.created_at >= ${startedAt}
        `;
        const resourceIds = new Set(resources.map((resource) => resource.id));
        if (resourceIds.size > 0 && await stagingHomeContainsResource(webUrl, learnerEmail, learnerPassword, resourceIds)) {
          process.stdout.write(JSON.stringify({ status: "passed", traceId, jobId: job.id, resources: resourceIds.size }) + "\n");
          return;
        }
        throw new Error("staging discovery smoke completed but the test learner Home feed did not contain the persisted candidate");
      }
      await sleep(2_000);
    }
    throw new Error("staging discovery smoke timed out");
  } finally {
    try {
      const resources = await worker<{ id: string }[]>`
        SELECT DISTINCT resource.id
        FROM catalog.resources AS resource
        INNER JOIN catalog.resource_concepts AS relation ON relation.resource_id = resource.id
        WHERE relation.concept_id = ${concept.id}
          AND resource.created_at >= ${startedAt}
      `;
      await cleanup(migrator, resources.map((resource) => resource.id), traceId);
    } finally {
      await Promise.all([
        worker.end({ timeout: 5 }),
        migrator.end({ timeout: 5 }),
      ]);
    }
  }
}

await main();

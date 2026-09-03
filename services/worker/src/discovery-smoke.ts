import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { runDiscoveryWorker } from "./discovery.js";

type SqlClient = ReturnType<typeof postgres>;

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
  conceptId: string,
  traceId: string,
  startedAt: Date,
): Promise<void> {
  await sql.begin(async (tx) => {
    const resources = await tx<{ id: string }[]>`
      SELECT DISTINCT resource.id
      FROM catalog.resources AS resource
      INNER JOIN catalog.resource_concepts AS relation ON relation.resource_id = resource.id
      WHERE relation.concept_id = ${conceptId}
        AND resource.created_at >= ${startedAt}
    `;
    const resourceIds = resources.map((resource) => resource.id);
    await tx`DELETE FROM catalog.resource_concepts WHERE concept_id = ${conceptId}`;
    if (resourceIds.length > 0) {
      await tx`DELETE FROM catalog.video_details WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.paper_details WHERE resource_id IN ${tx(resourceIds)}`;
      await tx`DELETE FROM catalog.resources WHERE id IN ${tx(resourceIds)}`;
    }
    await tx`DELETE FROM ops.jobs WHERE trace_id = ${traceId}`;
    await tx`DELETE FROM knowledge.concepts WHERE id = ${conceptId}`;
  });
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
  const conceptId = randomUUID();
  const startedAt = new Date();
  try {
    await worker`
      INSERT INTO knowledge.concepts (id, slug, name, kind, summary, status, metadata)
      VALUES (${conceptId}, ${traceId}, 'AI / Machine Learning', 'topic', 'staging discovery smoke concept', 'active', '{"discoverySmoke":true}'::jsonb)
    `;
    const [job] = await worker<{ id: string }[]>`
      INSERT INTO ops.jobs (queue, job_type, payload, dedup_key, idempotency_key, trace_id)
      VALUES (
        'discovery',
        'discovery.refresh_concept',
        ${worker.json({
          concept_id: conceptId,
          concept_name: "AI / Machine Learning",
          concept_ids: [conceptId],
          concept_names: ["AI / Machine Learning"],
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
        const [result] = await worker<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM catalog.resources AS resource
          INNER JOIN catalog.resource_concepts AS relation ON relation.resource_id = resource.id
          WHERE relation.concept_id = ${conceptId}
        `;
        if (Number(result?.count ?? 0) > 0) {
          process.stdout.write(JSON.stringify({ status: "passed", traceId, jobId: job.id }) + "\n");
          return;
        }
        throw new Error("staging discovery smoke completed without a persisted candidate");
      }
      await sleep(2_000);
    }
    throw new Error("staging discovery smoke timed out");
  } finally {
    try {
      await cleanup(migrator, conceptId, traceId, startedAt);
    } finally {
      await Promise.all([
        worker.end({ timeout: 5 }),
        migrator.end({ timeout: 5 }),
      ]);
    }
  }
}

await main();

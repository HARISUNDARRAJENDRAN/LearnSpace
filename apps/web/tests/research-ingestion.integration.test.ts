import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { claimPaperIngestion } from "../lib/research/ingestion";

const databaseAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_WORKER_URL);

test("An ingestion claim is exclusive and reopens parser startup failures only", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const worker = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const externalId = `ingestion-claim-${randomUUID()}`;
  const [paper] = await migrator<{ id: string }[]>`
    INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, visibility, status)
    VALUES ('paper', 'arxiv', ${externalId}, ${`https://arxiv.org/abs/${externalId}`}, 'Claim test paper', 'public', 'ready') RETURNING id`;
  const id = paper!.id;
  try {
    assert.equal(await claimPaperIngestion(worker, id), true, "the first request claims it");
    assert.equal(await claimPaperIngestion(worker, id), false, "a second request inside the window does not");

    await migrator`UPDATE catalog.resources SET metadata = metadata || jsonb_build_object('paperIngestionRequestedAt', now() - interval '11 minutes') WHERE id = ${id}`;
    assert.equal(await claimPaperIngestion(worker, id), true, "an expired window is claimed again");

    await migrator`UPDATE catalog.resources SET metadata = metadata - 'paperIngestionRequestedAt', status = 'failed' WHERE id = ${id}`;
    assert.equal(await claimPaperIngestion(worker, id), false, "a failed paper is not retried");

    const [version] = await migrator<{ id: string }[]>`
      INSERT INTO catalog.resource_versions (resource_id, version_no, source_sha256, raw_object_key, mime_type, byte_size, parser_name, parser_version, processing_status)
      VALUES (${id}, 1, ${"0".repeat(64)}, ${`external/${id}`}, 'application/pdf', 1, 'test', 'test', 'failed') RETURNING id`;
    await migrator`
      UPDATE catalog.resource_versions SET failure_code = 'parse_failed', failure_detail = 'PDF parser child exited with code 1'
      WHERE id = ${version!.id}`;
    assert.equal(await claimPaperIngestion(worker, id), true, "a parser startup failure can be retried");
    const [reopened] = await migrator<{ status: string }[]>`SELECT status FROM catalog.resources WHERE id = ${id}`;
    assert.equal(reopened?.status, "pending");
    assert.equal(await claimPaperIngestion(worker, id), false, "only one request reopens the paper");
    await migrator`UPDATE catalog.resource_versions SET processing_status = 'ready' WHERE id = ${version!.id}`;
    await migrator`UPDATE catalog.resources SET status = 'ready', current_version_id = ${version!.id} WHERE id = ${id}`;
    assert.equal(await claimPaperIngestion(worker, id), false, "a parsed paper is not claimed");
  } finally {
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${id}`;
    await migrator`DELETE FROM catalog.resource_versions WHERE resource_id = ${id}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${id}`;
    await Promise.all([migrator.end(), worker.end()]);
  }
});

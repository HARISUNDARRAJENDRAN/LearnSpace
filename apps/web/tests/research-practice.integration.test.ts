import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { GuideWriter } from "../lib/research/practice";

const enabled = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);

test("paper guide GET is pending then failed, POST is per-version idempotent, and sessions stay user-scoped", { skip: enabled ? false : "database URLs are required", timeout: 60_000 }, async () => {
  const [{ closeDb }, { createEmailUser }, study, practice] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/study/service"), import("../lib/research/practice"),
  ]);
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const owner = await createEmailUser({ email: `paper-practice-${randomUUID()}@example.test`, displayName: "Paper Practice", passwordHash: "test-hash" });
  const other = await createEmailUser({ email: `paper-practice-other-${randomUUID()}@example.test`, displayName: "Other Learner", passwordHash: "test-hash" });
  const resourceId = randomUUID();
  const versionId = randomUUID();
  const arxivId = `2511.${randomUUID().replaceAll("-", "").slice(0, 5)}`;
  let sessionId: string | null = null;
  let jobs: Promise<unknown>[] = [];
  const writes: Array<string | undefined> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const failingWriter: GuideWriter = async (input) => {
    writes.push(input.rejectedBecause);
    await gate; // hold the claim until the competing start has given up
    throw new Error("scripted guide failure");
  };
  const enqueue = (work: Promise<unknown>) => { jobs.push(work); };
  try {
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES (${resourceId}, NULL, 'paper', 'arxiv', ${arxivId}, ${`https://arxiv.org/abs/${arxivId}`}, 'Attention practice fixture', 'CPU attention fixture.', 'en', 'public', 'ready', 0.9, '{}'::jsonb)`;
    await migrator`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, pdf_source_url) VALUES (${resourceId}, ${arxivId}, 'A small deterministic attention paper.', 'arXiv', current_date, NULL)`;
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${resourceId}, 1, ${"e".repeat(64)}, ${"e".repeat(64)}, ${`papers/${resourceId}`}, 'application/pdf', 'fixture-parser', '1', 'ready', now(), now())`;
    const passage = "Scaled dot-product attention scales query-key scores before softmax.";
    await migrator`
      INSERT INTO retrieval.resource_chunks (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, page_from, anchor)
      VALUES (${versionId}, 0, 'paragraph', ${passage}, ${createHash("sha256").update(passage).digest("hex")}, 14, 3, ${migrator.json({ page: 3, sectionId: "3-attention" })})`;
    await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${resourceId}`;
    ({ sessionId } = await study.startOrResumeStudySession(owner.id, { resourceId, origin: "research", idempotencyKey: `paper-practice-${randomUUID()}` }));

    assert.deepEqual(await practice.getPaperGuide(owner.id, sessionId), { status: "pending", guide: null });
    await assert.rejects(practice.getPaperGuide(other.id, sessionId));
    await Promise.all([
      practice.startPaperGuide(owner.id, sessionId, enqueue, failingWriter),
      practice.startPaperGuide(owner.id, sessionId, enqueue, failingWriter),
    ]);
    await Promise.race(jobs.map((job) => job.catch(() => undefined)));
    release();
    const settled = await Promise.allSettled(jobs);
    assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
    assert.deepEqual(writes, [undefined, "scripted guide failure"], "concurrent POSTs get one writer, which redrafts once with the rejection reason");
    assert.equal((await practice.getPaperGuide(owner.id, sessionId)).status, "failed");
  } finally {
    await Promise.allSettled(jobs);
    if (sessionId) {
      await migrator`DELETE FROM study.user_resource_progress WHERE last_session_id = ${sessionId}`;
      await migrator`DELETE FROM activity.activity_events WHERE study_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
    }
    await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE resource_id = ${resourceId}`;
    await migrator`DELETE FROM discovery.recommendation_impressions WHERE resource_id = ${resourceId}`;
    await migrator`DELETE FROM catalog.paper_details WHERE resource_id = ${resourceId}`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${resourceId}`;
    await migrator`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
    await migrator`DELETE FROM identity.users WHERE id IN (${owner.id}, ${other.id})`;
    await migrator.end();
    await closeDb();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { discoveryAgentPayload, discoveryPayload, nextRefreshAt, parseBatch, refreshIntervalHours, resourceIdsFromJobResult, sourcePickerJobPayload } from "./discovery.js";
import { extractPdfChunks, hasPdfHeader } from "./document-ingestion.js";
import { DISCOVERY_SMOKE_SYSTEM_ACCOUNT, hasSmokeAccountMarker } from "./discovery-smoke-provision.js";
import { signPrivateUpload } from "@learnspace/shared/private-storage";

test("discovery jobs are scoped to one canonical concept", () => {
  const payload = discoveryPayload(
    "trace",
    "00000000-0000-0000-0000-000000000101",
    "Physics",
  );
  assert.deepEqual(payload.concept_ids, ["00000000-0000-0000-0000-000000000101"]);
  assert.deepEqual(payload.concept_names, ["Physics"]);
  assert.equal(payload.concept_id, "00000000-0000-0000-0000-000000000101");
  assert.equal(payload.level, "mixed");
  assert.deepEqual(payload.preferred_formats, []);
  assert.equal(payload.audit_user_id, null);
  assert.equal(payload.force_refresh, false);
});

test("agent requests exclude worker-only scheduling fields", () => {
  const payload = discoveryAgentPayload({
    ...discoveryPayload(
      "trace",
      "00000000-0000-0000-0000-000000000101",
      "Physics",
    ),
    refresh_reason: "scheduled",
  });
  assert.equal("concept_id" in payload, false);
  assert.equal("concept_name" in payload, false);
  assert.equal("refresh_reason" in payload, false);
  assert.deepEqual(payload.concept_ids, ["00000000-0000-0000-0000-000000000101"]);
  assert.deepEqual(payload.concept_names, ["Physics"]);
  assert.equal(payload.level, "mixed");
  assert.deepEqual(payload.preferred_formats, []);
  assert.equal(payload.audit_user_id, null);
});

test("shared concept agent requests cannot inherit a learner profile", () => {
  const payload = discoveryAgentPayload({
    concept_ids: ["00000000-0000-0000-0000-000000000101"],
    concept_names: ["Physics"],
    level: "beginner",
    preferred_formats: ["clear_explanations"],
    audit_user_id: "00000000-0000-0000-0000-000000000001",
  });
  assert.equal(payload.level, "mixed");
  assert.deepEqual(payload.preferred_formats, []);
  assert.equal(payload.audit_user_id, null);
});

test("smoke agent requests can explicitly bypass a stale cache", () => {
  const payload = discoveryAgentPayload({
    ...discoveryPayload(
      "trace",
      "00000000-0000-0000-0000-000000000101",
      "Physics",
    ),
    force_refresh: true,
  });
  assert.equal(payload.force_refresh, true);
});

test("uploaded documents must have a PDF header within the file signature window", () => {
  const pdf = new TextEncoder().encode(`${" ".repeat(900)}%PDF-1.7`);
  assert.equal(hasPdfHeader(pdf), true);
  assert.equal(hasPdfHeader(new TextEncoder().encode("not a PDF")), false);
  assert.equal(hasPdfHeader(new TextEncoder().encode(`${" ".repeat(1024)}%PDF-1.7`)), false);
});

test("presigned PDF uploads are content-bound and cannot be overwritten", async () => {
  const envKeys = ["VERCEL", "VERCEL_ENV", "S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  process.env.VERCEL = "0";
  process.env.S3_BUCKET = "learnspace-upload-test";
  process.env.S3_REGION = "us-east-1";
  delete process.env.VERCEL_ENV;
  delete process.env.S3_ENDPOINT;
  process.env.AWS_ACCESS_KEY_ID = "AKIDEXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "local-test-secret-not-a-credential";
  delete process.env.AWS_SESSION_TOKEN;
  try {
    const signed = await signPrivateUpload("pending/user/resource/version/random.pdf", 123);
    assert.equal(signed.headers["If-None-Match"], "*");
    const requiredHeaders = new URL(signed.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    assert.ok(requiredHeaders.includes("content-length"));
    assert.ok(requiredHeaders.includes("content-type"));
    assert.ok(requiredHeaders.includes("if-none-match"));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("PDF ingestion extracts bounded page text into searchable chunks", async () => {
  const stream = "BT /F1 12 Tf 50 200 Td (LearnSpace private PDF) Tj ET";
  const bodies = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const body of bodies) {
    offsets.push(source.length);
    source += body;
  }
  const xrefOffset = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const result = await extractPdfChunks(new TextEncoder().encode(source));
  assert.equal(result.pageCount, 1);
  assert.equal(result.chunks.length, 1);
  assert.match(result.chunks[0]?.content ?? "", /LearnSpace private PDF/);
  assert.equal(result.chunks[0]?.page, 1);
});

test("agent payload construction rejects multi-concept refreshes", () => {
  assert.throws(() => discoveryAgentPayload({
    concept_ids: ["concept-a", "concept-b"],
    concept_names: ["A", "B"],
  }), /one canonical concept/);
});

test("source-picker refreshes always use a run-specific job, even with a canonical concept", () => {
  const payload = sourcePickerJobPayload(
    "trace",
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "Python generators",
    "video",
    ["00000000-0000-0000-0000-000000000003"],
    ["Python"],
  );
  assert.deepEqual(payload.concept_ids, ["00000000-0000-0000-0000-000000000003"]);
  assert.deepEqual(payload.concept_names, ["Python"]);
  assert.equal(payload.query_text, "Python generators");
  assert.equal(payload.source_picker_run_id, "00000000-0000-0000-0000-000000000002");
  assert.equal(payload.refresh_reason, "source_picker");
  const queryOnly = sourcePickerJobPayload("trace", "user", "run", "Python generators", "video", [], ["ignored"]);
  assert.deepEqual(queryOnly.concept_ids, []);
  assert.deepEqual(queryOnly.concept_names, []);
  assert.throws(() => sourcePickerJobPayload("trace", "user", "run", "Python generators", "video", ["concept"], []), /same length/);
});

test("refresh policy is tiered, configurable, and jittered deterministically", () => {
  assert.equal(refreshIntervalHours("AI / Machine Learning"), 12);
  assert.equal(refreshIntervalHours("Physics"), 72);
  const finishedAt = new Date("2026-01-01T00:00:00.000Z");
  const first = nextRefreshAt("concept-a", "Physics", finishedAt);
  assert.equal(first.getTime(), nextRefreshAt("concept-a", "Physics", finishedAt).getTime());
  assert.ok(first.getTime() > finishedAt.getTime() + 60 * 60 * 1000);
});

test("scheduled payloads contain no learner-specific state", () => {
  const scheduled = {
    ...discoveryPayload("trace", "concept", "Physics"),
    level: "beginner",
    preferred_formats: ["hands_on"],
    audit_user_id: "user",
    refresh_reason: "scheduled",
  };
  const agentPayload = discoveryAgentPayload(scheduled);
  assert.equal(agentPayload.level, "mixed");
  assert.deepEqual(agentPayload.preferred_formats, []);
  assert.equal(agentPayload.audit_user_id, null);
  assert.equal("refresh_reason" in agentPayload, false);
});

test("worker rejects YouTube candidates with an unknown learning format", () => {
  const result = parseBatch({
    trace_id: "trace",
    youtube: [{
      youtube_id: "dQw4w9WgXcQ",
      canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "A practical lesson",
      confidence: 0.8,
      learning_format: "not-a-learning-format",
    }],
  });
  assert.deepEqual(result.youtube, []);
});

test("smoke ownership comes only from bounded job result resource IDs", () => {
  const createdResourceId = "00000000-0000-0000-0000-000000000201";
  const existingResourceId = "00000000-0000-0000-0000-000000000202";
  const unrelatedResourceId = "00000000-0000-0000-0000-000000000203";
  assert.deepEqual(
    resourceIdsFromJobResult({
      resourceIds: [createdResourceId, existingResourceId, unrelatedResourceId, createdResourceId, "not-a-uuid"],
    }),
    [createdResourceId, existingResourceId, unrelatedResourceId],
  );
  assert.deepEqual(resourceIdsFromJobResult({}), []);
});

test("smoke provisioning requires the permanent system-account marker", () => {
  assert.equal(DISCOVERY_SMOKE_SYSTEM_ACCOUNT, "discovery-smoke-v1");
  assert.equal(hasSmokeAccountMarker({ systemAccount: "discovery-smoke-v1" }), true);
  assert.equal(hasSmokeAccountMarker({}), false);
  assert.equal(hasSmokeAccountMarker({ systemAccount: "user-account" }), false);
});

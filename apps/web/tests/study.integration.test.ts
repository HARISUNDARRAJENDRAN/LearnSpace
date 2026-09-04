import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDb } from "@learnspace/db";
import { createEmailUser } from "../lib/auth/repository";
import { AuthError } from "../lib/auth/errors";
import { attachSessionResource, getStudySession, startOrResumeStudySession, updateStudyProgress } from "../lib/study/service";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);

test("StudySession starts provisionally, switches resources in place, and preserves meaningful progress", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required");
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const owner = await createEmailUser({ email: `study-${randomUUID()}@example.test`, displayName: "Study Owner", passwordHash: "test-hash" });
  const foreign = await createEmailUser({ email: `study-foreign-${randomUUID()}@example.test`, displayName: "Foreign Learner", passwordHash: "test-hash" });
  const videoId = randomUUID();
  const paperId = randomUUID();
  const privateId = randomUUID();
  const videoYoutubeId = `s${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const paperArxivId = `study.${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  let conceptId: string | null = null;
  let sessionId: string | null = null;
  try {
    const conceptRows = await migrator<{ id: string }[]>`SELECT id FROM knowledge.concepts WHERE slug = 'ai-machine-learning' LIMIT 1`;
    conceptId = conceptRows[0]?.id ?? null;
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
      VALUES
        (${videoId}, NULL, 'video', 'youtube', ${videoYoutubeId}, ${`https://www.youtube.com/watch?v=${videoYoutubeId}`}, 'Study video without an ingested version', 'The video begins before ingestion.', 'public', 'ready', 0.9, '{}'::jsonb),
        (${paperId}, NULL, 'paper', 'arxiv', ${paperArxivId}, ${`https://arxiv.org/abs/${paperArxivId}`}, 'Study paper with a real version', 'The paper has a real catalogue version.', 'public', 'ready', 0.9, '{}'::jsonb),
        (${privateId}, ${foreign.id}, 'video', 'youtube', ${`private-${videoYoutubeId}`}, ${`https://www.youtube.com/watch?v=${videoYoutubeId}`}, 'Private foreign video', 'Not visible to the foreign learner.', 'private', 'ready', 0.9, '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms)
      VALUES (${videoId}, ${videoYoutubeId}, 'Study Test Lab', 600000), (${privateId}, ${`e2ePriv${randomUUID().replaceAll("-", "").slice(0, 5)}`}, 'Private Test Lab', 600000)
    `;
    await migrator`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, pdf_source_url)
      VALUES (${paperId}, ${paperArxivId}, 'A real paper abstract for the integration test.', 'arXiv', current_date, ${`https://arxiv.org/pdf/${paperArxivId}.pdf`})
    `;
    const versionId = randomUUID();
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, raw_object_key, mime_type, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${paperId}, 1, ${"b".repeat(64)}, ${`study/${paperId}/paper.pdf`}, 'application/pdf', 'ready', now(), now())
    `;
    await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${paperId}`;
    if (conceptId) {
      await migrator`INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary) VALUES (${videoId}, ${conceptId}, 'study-test', 1, true), (${paperId}, ${conceptId}, 'study-test', 1, true)`;
    }

    const first = await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: `study-start-${randomUUID()}` });
    sessionId = first.sessionId;
    assert.equal(first.route, `/app/study/video/${sessionId}`);
    assert.equal(first.readiness, "preparing");
    const sameKey = `study-same-${randomUUID()}`;
    const replay = await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: sameKey });
    const replayAgain = await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: sameKey });
    assert.equal(replay.sessionId, sessionId);
    assert.equal(replayAgain.sessionId, sessionId);
    assert.equal(replayAgain.resumed, true);

    const researchStart = await startOrResumeStudySession(owner.id, { resourceId: paperId, origin: "research", idempotencyKey: `research-start-${randomUUID()}` });
    assert.equal(researchStart.route, `/app/study/paper/${researchStart.sessionId}`);
    assert.equal(researchStart.readiness, "ready");
    assert.equal((await getStudySession(owner.id, researchStart.sessionId)).mode, "research");

    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 25, anchor: { kind: "video", positionMs: 150000 }, event: "checkpoint", idempotencyKey: `checkpoint-${randomUUID()}` });
    const affinityBeforeControls = conceptId ? await migrator<{ positive_weight: number }[]>`SELECT positive_weight FROM discovery.user_concept_affinity WHERE user_id = ${owner.id} AND concept_id = ${conceptId}` : [];
    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 3, anchor: { kind: "video", positionMs: 18000 }, event: "seek", idempotencyKey: `seek-${randomUUID()}` });
    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 3, anchor: { kind: "video", positionMs: 18000 }, event: "pause", idempotencyKey: `pause-${randomUUID()}` });
    const afterControls = await migrator<{ progress_pct: number; positive_weight: number }[]>`SELECT p.progress_pct, a.positive_weight FROM study.user_resource_progress p LEFT JOIN discovery.user_concept_affinity a ON a.user_id = p.user_id AND a.concept_id = ${conceptId} WHERE p.user_id = ${owner.id} AND p.resource_id = ${videoId}`;
    assert.equal(Number(afterControls[0]?.progress_pct), 25);
    assert.equal(Number(afterControls[0]?.positive_weight ?? 0), Number(affinityBeforeControls[0]?.positive_weight ?? 0));

    const switchedToPaper = await attachSessionResource(owner.id, sessionId, { resourceId: paperId, role: "related", idempotencyKey: `switch-paper-${randomUUID()}` });
    assert.equal(switchedToPaper.sessionId, sessionId);
    assert.equal(switchedToPaper.route, `/app/study/paper/${sessionId}`);
    const paperView = await getStudySession(owner.id, sessionId);
    assert.equal(paperView.activeResource?.type, "paper");
    assert.equal(paperView.resources.length, 2);
    assert.equal(paperView.resources.find((resource) => resource.resourceId === videoId)?.role, "primary");
    assert.equal(paperView.resources.find((resource) => resource.resourceId === paperId)?.role, "related");
    assert.equal(paperView.resources.find((resource) => resource.resourceId === paperId)?.readiness, "ready");

    const switchedBack = await attachSessionResource(owner.id, sessionId, { resourceId: videoId, idempotencyKey: `switch-video-${randomUUID()}` });
    assert.equal(switchedBack.route, `/app/study/video/${sessionId}`);
    const videoView = await getStudySession(owner.id, sessionId);
    assert.equal(videoView.activeResource?.type, "video");
    assert.equal(videoView.activeResource?.lastAnchor?.kind, "video");
    if (videoView.activeResource?.lastAnchor?.kind === "video") assert.equal(videoView.activeResource.lastAnchor.positionMs, 18000);

    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 100, anchor: { kind: "video", positionMs: 600000 }, event: "complete", idempotencyKey: `complete-${randomUUID()}` });
    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 100, anchor: { kind: "video", positionMs: 600000 }, event: "complete", idempotencyKey: `complete-retry-${randomUUID()}` });
    const completed = await migrator<{ status: string; progress_pct: number }[]>`SELECT status, progress_pct FROM study.user_resource_progress WHERE user_id = ${owner.id} AND resource_id = ${videoId}`;
    assert.equal(completed[0]?.status, "completed");
    assert.equal(Number(completed[0]?.progress_pct), 100);
    const completionEvents = await migrator<{ count: number }[]>`SELECT count(*)::int AS count FROM activity.activity_events WHERE user_id = ${owner.id} AND study_session_id = ${sessionId} AND resource_id = ${videoId} AND event_type = 'resource.completed'`;
    assert.equal(completionEvents[0]?.count, 1);

    await assert.rejects(() => getStudySession(foreign.id, sessionId ?? ""), (error: unknown) => error instanceof AuthError && error.status === 404);
    await assert.rejects(() => startOrResumeStudySession(owner.id, { resourceId: privateId, origin: "discover", idempotencyKey: `private-${randomUUID()}` }), (error: unknown) => error instanceof AuthError && error.status === 404);
  } finally {
    await migrator`DELETE FROM ops.outbox_events WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM ops.idempotency_records WHERE user_id IN (${owner.id}, ${foreign.id})`;
    if (sessionId) {
      await migrator`DELETE FROM activity.activity_events WHERE study_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.user_resource_progress WHERE last_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
    }
    await migrator`DELETE FROM activity.activity_events WHERE user_id IN (${owner.id}, ${foreign.id}) OR resource_id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id}))`;
    await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id}))`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM discovery.user_concept_affinity WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id IN (${owner.id}, ${foreign.id}) OR resource_id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id})) OR resource_id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM catalog.resource_versions WHERE resource_id = ${paperId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM catalog.paper_details WHERE resource_id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM catalog.resources WHERE id IN (${videoId}, ${paperId}, ${privateId})`;
    await migrator`DELETE FROM identity.users WHERE id IN (${owner.id}, ${foreign.id})`;
    await migrator.end({ timeout: 5 });
    await closeDb();
  }
});

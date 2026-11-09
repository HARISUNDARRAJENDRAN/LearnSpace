import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { AuthError } from "../lib/auth/errors";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);

test("StudySession starts provisionally, switches resources in place, and preserves meaningful progress", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required");
  const [{ closeDb }, { createEmailUser }, { addCourseToLibrary, getCollectionDetail, getLibraryPage }, { getResearchPage }, { attachSessionResource, getStudySession, pauseSession, startOrResumeStudySession, updateStudyProgress }] = await Promise.all([
    import("@learnspace/db"),
    import("../lib/auth/repository"),
    import("../lib/library/service"),
    import("../lib/research/service"),
    import("../lib/study/service"),
  ]);
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const owner = await createEmailUser({ email: `study-${randomUUID()}@example.test`, displayName: "Study Owner", passwordHash: "test-hash" });
  const foreign = await createEmailUser({ email: `study-foreign-${randomUUID()}@example.test`, displayName: "Foreign Learner", passwordHash: "test-hash" });
  const videoId = randomUUID();
  const concurrentVideoId = randomUUID();
  const paperId = randomUUID();
  const lowQualityPaperId = randomUUID();
  const highQualityPaperId = randomUUID();
  const privateId = randomUUID();
  const ownCollectionId = randomUUID();
  const foreignCollectionId = randomUUID();
  const privateForeignCollectionId = randomUUID();
  const curatedCollectionId = randomUUID();
  const curatedSlug = `curated-${randomUUID()}`;
  const generatedCollectionId = randomUUID();
  const collectionSectionId = randomUUID();
  const collectionVideoItemId = randomUUID();
  const curatedSectionId = randomUUID();
  const curatedItemId = randomUUID();
  const collectionPaperItemId = randomUUID();
  const videoYoutubeId = `s${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const concurrentYoutubeId = `c${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const paperArxivId = `study.${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const lowQualityArxivId = `low.${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const highQualityArxivId = `high.${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  let conceptId: string | null = null;
  const relatedConceptId = randomUUID();
  let sessionId: string | null = null;
  try {
    const conceptRows = await migrator<{ id: string }[]>`SELECT id FROM knowledge.concepts WHERE slug = 'ai-machine-learning' LIMIT 1`;
    conceptId = conceptRows[0]?.id ?? null;
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
      VALUES
        (${videoId}, NULL, 'video', 'youtube', ${videoYoutubeId}, ${`https://www.youtube.com/watch?v=${videoYoutubeId}`}, 'Study video without an ingested version', 'The video begins before ingestion.', 'public', 'ready', 0.9, '{}'::jsonb),
        (${concurrentVideoId}, NULL, 'video', 'youtube', ${concurrentYoutubeId}, ${`https://www.youtube.com/watch?v=${concurrentYoutubeId}`}, 'Concurrent start video', 'Two tabs should share one learning context.', 'public', 'ready', 0.9, '{}'::jsonb),
        (${paperId}, NULL, 'paper', 'arxiv', ${paperArxivId}, ${`https://arxiv.org/abs/${paperArxivId}`}, 'Study paper with a real version', 'The paper has a real catalogue version.', 'public', 'ready', 0.9, '{}'::jsonb),
        (${lowQualityPaperId}, NULL, 'paper', 'arxiv', ${lowQualityArxivId}, ${`https://arxiv.org/abs/${lowQualityArxivId}`}, 'Low quality related paper', 'A lower quality related candidate.', 'public', 'ready', 0.1, '{}'::jsonb),
        (${highQualityPaperId}, NULL, 'paper', 'arxiv', ${highQualityArxivId}, ${`https://arxiv.org/abs/${highQualityArxivId}`}, 'High quality related paper', 'A higher quality related candidate.', 'public', 'ready', 0.99, '{}'::jsonb),
        (${privateId}, ${foreign.id}, 'video', 'youtube', ${`private-${videoYoutubeId}`}, ${`https://www.youtube.com/watch?v=${videoYoutubeId}`}, 'Private foreign video', 'Not visible to the foreign learner.', 'private', 'ready', 0.9, '{}'::jsonb)
    `;
    await migrator`
      INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms)
      VALUES (${videoId}, ${videoYoutubeId}, 'Study Test Lab', 600000), (${concurrentVideoId}, ${concurrentYoutubeId}, 'Concurrent Study Test Lab', 600000), (${privateId}, ${`e2ePriv${randomUUID().replaceAll("-", "").slice(0, 5)}`}, 'Private Test Lab', 600000)
    `;
    await migrator`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, pdf_source_url)
      VALUES
        (${paperId}, ${paperArxivId}, 'A real paper abstract for the integration test.', 'arXiv', current_date, ${`https://arxiv.org/pdf/${paperArxivId}.pdf`}),
        (${lowQualityPaperId}, ${lowQualityArxivId}, 'A lower quality related paper abstract.', 'arXiv', current_date, NULL),
        (${highQualityPaperId}, ${highQualityArxivId}, 'A higher quality related paper abstract.', 'arXiv', current_date, NULL)
    `;
    await migrator`
      INSERT INTO knowledge.concepts (id, slug, name, kind, summary, status)
      VALUES (${relatedConceptId}, ${`study-related-${randomUUID()}`}, 'Study related concept', 'topic', 'A test-only related-resource concept.', 'active')
    `;
    await migrator`
      INSERT INTO catalog.collections (id, owner_user_id, kind, slug, visibility, title, description)
      VALUES
        (${ownCollectionId}, ${owner.id}, 'manual', ${`own-${randomUUID()}`}, 'private', 'Owner playlist', 'A learner-owned playlist.'),
        (${foreignCollectionId}, ${foreign.id}, 'manual', ${`foreign-${randomUUID()}`}, 'public', 'Foreign public playlist', 'A public playlist from another learner.'),
        (${privateForeignCollectionId}, ${foreign.id}, 'manual', ${`private-${randomUUID()}`}, 'private', 'Private foreign playlist', 'This collection is not visible to the owner.'),
        (${curatedCollectionId}, NULL, 'curated', ${curatedSlug}, 'public', 'Editorial collection', 'A LearnSpace collection.'),
        (${generatedCollectionId}, ${owner.id}, 'generated', ${`generated-${randomUUID()}`}, 'private', 'Generated learner collection', 'A real generated collection.')
    `;
    await migrator`
      INSERT INTO catalog.collection_sections (id, collection_id, title, description, position)
      VALUES (${collectionSectionId}, ${ownCollectionId}, 'One thread', 'Video then paper.', 0), (${curatedSectionId}, ${curatedCollectionId}, 'Course units', NULL, 0)
    `;
    await migrator`
      INSERT INTO catalog.collection_items (id, section_id, resource_id, position, required)
      VALUES (${collectionVideoItemId}, ${collectionSectionId}, ${videoId}, 0, true), (${collectionPaperItemId}, ${collectionSectionId}, ${paperId}, 1, true), (${curatedItemId}, ${curatedSectionId}, ${concurrentVideoId}, 0, true)
    `;
    await migrator`
      INSERT INTO catalog.collection_enrollments (user_id, collection_id, current_item_id, status, progress_pct)
      VALUES (${owner.id}, ${ownCollectionId}, ${collectionPaperItemId}, 'active', 50)
    `;
    const versionId = randomUUID();
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, raw_object_key, mime_type, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${paperId}, 1, ${"b".repeat(64)}, ${`study/${paperId}/paper.pdf`}, 'application/pdf', 'ready', now(), now())
    `;
    await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${paperId}`;
    if (conceptId) {
      await migrator`INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary) VALUES (${videoId}, ${conceptId}, 'study-test', 1, true), (${concurrentVideoId}, ${conceptId}, 'study-test', 1, true), (${paperId}, ${conceptId}, 'study-test', 1, true), (${lowQualityPaperId}, ${conceptId}, 'study-test', 1, true), (${highQualityPaperId}, ${conceptId}, 'study-test', 1, true)`;
    }
    await migrator`INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary) VALUES (${concurrentVideoId}, ${relatedConceptId}, 'study-related-test', 1, true), (${lowQualityPaperId}, ${relatedConceptId}, 'study-related-test', 1, true), (${highQualityPaperId}, ${relatedConceptId}, 'study-related-test', 1, true)`;

    const first = await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: `study-start-${randomUUID()}` });
    sessionId = first.sessionId;
    if (!sessionId) throw new Error("Study session ID was not returned");
    const studySessionId = sessionId;
    assert.equal(first.route, `/app/study/video/${sessionId}`);
    assert.equal(first.readiness, "preparing");

    // Sessions holds one thing at a time: the owner cannot start a second video while this one is in progress.
    await assert.rejects(startOrResumeStudySession(owner.id, { resourceId: concurrentVideoId, origin: "home", idempotencyKey: `second-${randomUUID()}` }), (error: unknown) => error instanceof AuthError && error.code === "SESSION_IN_PROGRESS");
    // Two tabs of a learner with an empty Sessions share one session.
    const concurrentStarts = await Promise.all([
      startOrResumeStudySession(foreign.id, { resourceId: concurrentVideoId, origin: "home", idempotencyKey: `concurrent-a-${randomUUID()}` }),
      startOrResumeStudySession(foreign.id, { resourceId: concurrentVideoId, origin: "home", idempotencyKey: `concurrent-b-${randomUUID()}` }),
    ]);
    assert.equal(concurrentStarts[0]?.sessionId, concurrentStarts[1]?.sessionId);
    const concurrentSessions = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM study.study_sessions AS sessions
      INNER JOIN study.session_resources AS bindings ON bindings.study_session_id = sessions.id
      WHERE sessions.user_id = ${foreign.id} AND bindings.resource_id = ${concurrentVideoId} AND sessions.status IN ('active', 'paused')
    `;
    assert.equal(concurrentSessions[0]?.count, 1);
    const concurrentOpened = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM activity.activity_events
      WHERE user_id = ${foreign.id} AND resource_id = ${concurrentVideoId} AND event_type = 'resource.opened'
    `;
    assert.equal(concurrentOpened[0]?.count, 1);
    const concurrentDiscoveryStarts = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM discovery.discovery_interactions
      WHERE user_id = ${foreign.id} AND resource_id = ${concurrentVideoId} AND action = 'start_session'
    `;
    assert.equal(concurrentDiscoveryStarts[0]?.count, 1);
    const concurrentSessionId = concurrentStarts[0]?.sessionId;
    assert.ok(concurrentSessionId);
    const relatedView = await getStudySession(foreign.id, concurrentSessionId);
    const highQualityIndex = relatedView.related.findIndex((resource) => resource.resourceId === highQualityPaperId);
    const lowQualityIndex = relatedView.related.findIndex((resource) => resource.resourceId === lowQualityPaperId);
    assert.ok(highQualityIndex >= 0);
    assert.ok(lowQualityIndex >= 0);
    assert.ok(highQualityIndex < lowQualityIndex);

    const sameKey = `study-same-${randomUUID()}`;
    const replay = await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: sameKey });
    const replayAgain = await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: sameKey });
    assert.equal(replay.sessionId, sessionId);
    assert.equal(replayAgain.sessionId, sessionId);
    assert.equal(replayAgain.resumed, true);

    await pauseSession(foreign.id, concurrentSessionId, `finish-concurrent-${randomUUID()}`, "complete");
    const researchStart = await startOrResumeStudySession(foreign.id, { resourceId: paperId, origin: "research", idempotencyKey: `research-start-${randomUUID()}` });
    assert.equal(researchStart.route, `/app/study/paper/${researchStart.sessionId}`);
    assert.equal(researchStart.readiness, "ready");
    assert.equal((await getStudySession(foreign.id, researchStart.sessionId)).mode, "research");

    // The library holds only the learner's own collections and the courses they added.
    assert.equal((await getLibraryPage(owner.id)).collections.some((collection) => collection.id === curatedCollectionId), false);
    await addCourseToLibrary(owner.id, curatedSlug);
    await addCourseToLibrary(owner.id, curatedSlug);
    await assert.rejects(addCourseToLibrary(owner.id, `missing-${randomUUID()}`), /cannot be added/);
    const libraryPage = await getLibraryPage(owner.id);
    const ownPlaylist = libraryPage.collections.find((collection) => collection.id === ownCollectionId);
    const editorialCollection = libraryPage.collections.find((collection) => collection.id === curatedCollectionId);
    const generatedCollection = libraryPage.collections.find((collection) => collection.id === generatedCollectionId);
    assert.equal(ownPlaylist?.ownership, "user");
    assert.equal(ownPlaylist?.source, "user");
    assert.equal(libraryPage.collections.some((collection) => collection.id === foreignCollectionId), false);
    assert.equal(editorialCollection?.ownership, "learnspace");
    assert.equal(editorialCollection?.source, "learnspace");
    assert.equal(editorialCollection?.status, "queued");
    assert.equal(generatedCollection?.ownership, "user");
    assert.equal(generatedCollection?.source, "generated");
    const collectionDetail = await getCollectionDetail(owner.id, ownCollectionId);
    assert.deepEqual(collectionDetail.sections[0]?.items.map((item) => item.resourceId), [videoId, paperId]);
    assert.equal(collectionDetail.currentItemId, collectionPaperItemId);
    const researchPage = await getResearchPage(owner.id, "related paper");
    assert.deepEqual(new Set(researchPage.recommended.map((paper) => paper.resourceId)), new Set([lowQualityPaperId, highQualityPaperId]));
    assert.equal(researchPage.foundational.length, 0);
    await assert.rejects(
      () => getCollectionDetail(owner.id, privateForeignCollectionId),
      (error: unknown) => error instanceof AuthError && error.status === 404,
    );

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
    assert.deepEqual(paperView.resources.find((resource) => resource.resourceId === paperId)?.introducedFrom, {
      resourceId: videoId,
      title: "Study video without an ingested version",
      type: "video",
      anchor: { kind: "video", positionMs: 18000 },
      reasonCode: "deeper_dive",
    });
    const persistedProvenance = await migrator<{ introduced_by_resource_id: string; introduced_from_anchor: { kind: string; positionMs: number }; introduced_reason_code: string }[]>`
      SELECT introduced_by_resource_id, introduced_from_anchor, introduced_reason_code
      FROM study.session_resources
      WHERE study_session_id = ${sessionId} AND resource_id = ${paperId}
    `;
    assert.equal(persistedProvenance[0]?.introduced_by_resource_id, videoId);
    assert.deepEqual(persistedProvenance[0]?.introduced_from_anchor, { kind: "video", positionMs: 18000 });
    assert.equal(persistedProvenance[0]?.introduced_reason_code, "deeper_dive");

    const activationKey = `activate-video-${randomUUID()}`;
    const activationRequest = { resourceId: videoId, role: "related" as const, idempotencyKey: activationKey };
    const activatedVideo = await attachSessionResource(owner.id, sessionId, activationRequest);
    const openedBeforeReplay = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM activity.activity_events
      WHERE user_id = ${owner.id} AND study_session_id = ${sessionId} AND resource_id = ${videoId} AND event_type = 'resource.opened'
    `;
    const checkpointsBeforeReplay = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count FROM study.session_checkpoints WHERE study_session_id = ${sessionId}
    `;
    const affinityBeforeReplay = conceptId ? await migrator<{ positive_weight: number }[]>`
      SELECT positive_weight FROM discovery.user_concept_affinity WHERE user_id = ${owner.id} AND concept_id = ${conceptId}
    ` : [];
    const activatedVideoReplay = await attachSessionResource(owner.id, sessionId, activationRequest);
    assert.deepEqual(activatedVideoReplay, activatedVideo);
    const openedAfterReplay = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM activity.activity_events
      WHERE user_id = ${owner.id} AND study_session_id = ${sessionId} AND resource_id = ${videoId} AND event_type = 'resource.opened'
    `;
    const checkpointsAfterReplay = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count FROM study.session_checkpoints WHERE study_session_id = ${sessionId}
    `;
    const affinityAfterReplay = conceptId ? await migrator<{ positive_weight: number }[]>`
      SELECT positive_weight FROM discovery.user_concept_affinity WHERE user_id = ${owner.id} AND concept_id = ${conceptId}
    ` : [];
    assert.equal(openedAfterReplay[0]?.count, openedBeforeReplay[0]?.count);
    assert.equal(checkpointsAfterReplay[0]?.count, checkpointsBeforeReplay[0]?.count);
    assert.equal(Number(affinityAfterReplay[0]?.positive_weight ?? 0), Number(affinityBeforeReplay[0]?.positive_weight ?? 0));
    await assert.rejects(
      () => attachSessionResource(owner.id, studySessionId, { resourceId: paperId, role: "related", idempotencyKey: activationKey }),
      (error: unknown) => error instanceof AuthError && error.status === 409,
    );
    const concurrentActivations = await Promise.all([
      attachSessionResource(owner.id, sessionId, { resourceId: highQualityPaperId, role: "related", idempotencyKey: `activate-high-a-${randomUUID()}` }),
      attachSessionResource(owner.id, sessionId, { resourceId: highQualityPaperId, role: "related", idempotencyKey: `activate-high-b-${randomUUID()}` }),
    ]);
    assert.equal(concurrentActivations[0]?.sessionId, sessionId);
    assert.equal(concurrentActivations[1]?.sessionId, sessionId);
    const concurrentActivationBindings = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count FROM study.session_resources WHERE study_session_id = ${sessionId} AND resource_id = ${highQualityPaperId}
    `;
    const concurrentActivationEvents = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count FROM activity.activity_events WHERE study_session_id = ${sessionId} AND resource_id = ${highQualityPaperId} AND event_type = 'resource.opened'
    `;
    assert.equal(concurrentActivationBindings[0]?.count, 1);
    assert.equal(concurrentActivationEvents[0]?.count, 1);

    const returnedToPaper = await attachSessionResource(owner.id, sessionId, { resourceId: paperId, idempotencyKey: `return-paper-${randomUUID()}` });
    assert.equal(returnedToPaper.route, `/app/study/paper/${sessionId}`);
    await updateStudyProgress(owner.id, sessionId, { resourceId: paperId, progressPct: 40, anchor: { kind: "paper", page: 3, sectionId: "scaled-dot-product" }, event: "checkpoint", idempotencyKey: `paper-checkpoint-${randomUUID()}` });
    const switchedBack = await attachSessionResource(owner.id, sessionId, { resourceId: videoId, idempotencyKey: `switch-video-${randomUUID()}` });
    assert.equal(switchedBack.route, `/app/study/video/${sessionId}`);
    const returnedToPaperAgain = await attachSessionResource(owner.id, sessionId, { resourceId: paperId, idempotencyKey: `return-paper-again-${randomUUID()}` });
    assert.equal(returnedToPaperAgain.sessionId, sessionId);
    assert.equal(returnedToPaperAgain.route, `/app/study/paper/${sessionId}`);
    const paperReturnView = await getStudySession(owner.id, sessionId);
    assert.equal(paperReturnView.activeResource?.type, "paper");
    assert.equal(paperReturnView.activeResource?.lastAnchor?.kind, "paper");
    if (paperReturnView.activeResource?.lastAnchor?.kind === "paper") {
      assert.equal(paperReturnView.activeResource.lastAnchor.page, 3);
      assert.equal(paperReturnView.activeResource.lastAnchor.sectionId, "scaled-dot-product");
    }

    const resumedVideo = await attachSessionResource(owner.id, sessionId, { resourceId: videoId, idempotencyKey: `complete-video-${randomUUID()}` });
    assert.equal(resumedVideo.route, `/app/study/video/${sessionId}`);
    await pauseSession(owner.id, sessionId, `pause-${randomUUID()}`, "pause");
    const pauseEvents = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count FROM activity.activity_events WHERE user_id = ${owner.id} AND study_session_id = ${sessionId} AND event_type = 'session.paused'
    `;
    assert.equal(pauseEvents[0]?.count, 1);
    await startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: `resume-after-pause-${randomUUID()}` });

    // Finishing the last unit of the current course completes it, but the queued course waits while this session is still open.
    await migrator`UPDATE catalog.collection_items SET required = false WHERE id = ${collectionPaperItemId}`;
    await migrator`UPDATE catalog.collection_enrollments SET current_item_id = ${collectionVideoItemId} WHERE user_id = ${owner.id} AND collection_id = ${ownCollectionId}`;
    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 100, anchor: { kind: "video", positionMs: 600000 }, event: "complete", idempotencyKey: `complete-${randomUUID()}` });
    const enrollments = await migrator<{ collection_id: string; status: string; current_item_id: string | null }[]>`SELECT collection_id, status, current_item_id FROM catalog.collection_enrollments WHERE user_id = ${owner.id} AND collection_id IN (${ownCollectionId}, ${curatedCollectionId})`;
    assert.equal(enrollments.find((row) => row.collection_id === ownCollectionId)?.status, "completed");
    assert.equal(enrollments.find((row) => row.collection_id === curatedCollectionId)?.status, "queued");
    await updateStudyProgress(owner.id, sessionId, { resourceId: videoId, progressPct: 100, anchor: { kind: "video", positionMs: 600000 }, event: "complete", idempotencyKey: `complete-retry-${randomUUID()}` });
    const completed = await migrator<{ status: string; progress_pct: number }[]>`SELECT status, progress_pct FROM study.user_resource_progress WHERE user_id = ${owner.id} AND resource_id = ${videoId}`;
    assert.equal(completed[0]?.status, "completed");
    assert.equal(Number(completed[0]?.progress_pct), 100);
    const completionEvents = await migrator<{ count: number }[]>`SELECT count(*)::int AS count FROM activity.activity_events WHERE user_id = ${owner.id} AND study_session_id = ${sessionId} AND resource_id = ${videoId} AND event_type = 'resource.completed'`;
    assert.equal(completionEvents[0]?.count, 1);
    await pauseSession(owner.id, sessionId, `complete-session-${randomUUID()}`, "complete");
    const sessionCompletionEvents = await migrator<{ count: number }[]>`
      SELECT count(*)::int AS count FROM activity.activity_events WHERE user_id = ${owner.id} AND study_session_id = ${sessionId} AND event_type = 'session.completed'
    `;
    assert.equal(sessionCompletionEvents[0]?.count, 1);
    // Completing the session empties Sessions, so the queued course starts.
    const [queuedCourse] = await migrator<{ status: string; current_item_id: string | null }[]>`SELECT status, current_item_id FROM catalog.collection_enrollments WHERE user_id = ${owner.id} AND collection_id = ${curatedCollectionId}`;
    assert.deepEqual(queuedCourse, { status: "active", current_item_id: curatedItemId });

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
    await migrator`DELETE FROM activity.activity_events WHERE user_id IN (${owner.id}, ${foreign.id}) OR resource_id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id}))`;
    await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id}))`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM discovery.user_concept_affinity WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM catalog.collection_enrollments WHERE collection_id IN (${ownCollectionId}, ${foreignCollectionId}, ${privateForeignCollectionId}, ${curatedCollectionId}, ${generatedCollectionId})`;
    await migrator`DELETE FROM catalog.collection_items WHERE id IN (${collectionVideoItemId}, ${collectionPaperItemId}, ${curatedItemId})`;
    await migrator`DELETE FROM catalog.collection_sections WHERE id IN (${collectionSectionId}, ${curatedSectionId})`;
    await migrator`DELETE FROM catalog.collections WHERE id IN (${ownCollectionId}, ${foreignCollectionId}, ${privateForeignCollectionId}, ${curatedCollectionId}, ${generatedCollectionId})`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id IN (${owner.id}, ${foreign.id}) OR resource_id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id})) OR resource_id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM study.study_sessions WHERE user_id IN (${owner.id}, ${foreign.id})`;
    await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM catalog.resource_versions WHERE resource_id = ${paperId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM catalog.paper_details WHERE resource_id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM catalog.resources WHERE id IN (${videoId}, ${concurrentVideoId}, ${paperId}, ${lowQualityPaperId}, ${highQualityPaperId}, ${privateId})`;
    await migrator`DELETE FROM knowledge.concepts WHERE id = ${relatedConceptId}`;
    await migrator`DELETE FROM identity.users WHERE id IN (${owner.id}, ${foreign.id})`;
    await migrator.end({ timeout: 5 });
    await closeDb();
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { AuthError } from "../lib/auth/errors";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);

test("A Discover course imports as a session of its own whose lessons unlock in order", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required");
  const [{ closeDb }, { createEmailUser }, study, library] = await Promise.all([
    import("@learnspace/db"),
    import("../lib/auth/repository"),
    import("../lib/study/service"),
    import("../lib/library/service"),
  ]);
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const learner = await createEmailUser({ email: `course-${randomUUID()}@example.test`, displayName: "Course Learner", passwordHash: "test-hash" });
  const slug = `course-${randomUUID()}`;
  const collectionId = randomUUID();
  const queuedSlug = `course-${randomUUID()}`;
  const queuedCollectionId = randomUUID();
  const queuedSectionId = randomUUID();
  const trackCollectionId = randomUUID();
  const trackSectionId = randomUUID();
  const trackResourceIds = [randomUUID(), randomUUID()];
  const trackAuthorId = randomUUID();
  const trackId = `track-${randomUUID()}`;
  const sectionIds = [randomUUID(), randomUUID()];
  const videoIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const youtubeIds = videoIds.map(() => `c${randomUUID().replaceAll("-", "").slice(0, 10)}`);
  const complete = (sessionId: string, resourceId: string) => study.updateStudyProgress(learner.id, sessionId, { resourceId, progressPct: 100, anchor: { kind: "video", positionMs: 600_000 }, event: "complete", idempotencyKey: randomUUID() });
  try {
    for (const [index, id] of videoIds.entries()) {
      const youtubeId = youtubeIds[index];
      await migrator`
        INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, visibility, status, quality_score, metadata)
        VALUES (${id}, NULL, 'video', 'youtube', ${youtubeId ?? ""}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${`Course lesson ${index + 1}`}, 'public', 'ready', 0.9, '{}'::jsonb)
      `;
      await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id) VALUES (${id}, ${youtubeId ?? ""})`;
    }
    await migrator`INSERT INTO catalog.collections (id, owner_user_id, kind, slug, visibility, title) VALUES (${collectionId}, NULL, 'curated', ${slug}, 'public', 'Course under test')`;
    await migrator`INSERT INTO catalog.collection_sections (id, collection_id, title, position) VALUES (${sectionIds[0] ?? ""}, ${collectionId}, 'Foundations', 0), (${sectionIds[1] ?? ""}, ${collectionId}, 'Practice', 1)`;
    await migrator`
      INSERT INTO catalog.collection_items (section_id, resource_id, position)
      VALUES (${sectionIds[0] ?? ""}, ${videoIds[0] ?? ""}, 0), (${sectionIds[0] ?? ""}, ${videoIds[1] ?? ""}, 1), (${sectionIds[1] ?? ""}, ${videoIds[2] ?? ""}, 0)
    `;
    await migrator`INSERT INTO catalog.collections (id, owner_user_id, kind, slug, visibility, title) VALUES (${queuedCollectionId}, NULL, 'curated', ${queuedSlug}, 'public', 'Queued course')`;
    await migrator`INSERT INTO catalog.collection_sections (id, collection_id, title, position) VALUES (${queuedSectionId}, ${queuedCollectionId}, 'Course units', 0)`;
    await migrator`INSERT INTO catalog.collection_items (section_id, resource_id, position) VALUES (${queuedSectionId}, ${videoIds[3] ?? ""}, 0)`;

    const openSessions = () => study.listStudySessions(learner.id);
    const librarySessions = async () => (await library.getLibraryPage(learner.id)).sessions.map((session) => session.id);
    assert.deepEqual(await openSessions(), []);
    assert.equal(await study.isCourseImportable(slug, learner.id), true);
    const imported = await study.importCourseToSessions(learner.id, slug);
    assert.equal(imported.resourceType, "video");
    assert.deepEqual((await openSessions()).map((session) => [session.id, session.isCourse]), [[imported.sessionId, true]]);

    // Importing the course again, or starting it from the Library, reopens its session instead of making a second one.
    assert.equal((await study.importCourseToSessions(learner.id, slug)).sessionId, imported.sessionId);
    assert.equal((await study.startCollection(learner.id, collectionId, randomUUID())).sessionId, imported.sessionId);
    // Anything else starts a session of its own beside the course, which stays where it was.
    const single = await study.startOrResumeStudySession(learner.id, { resourceId: videoIds[3] ?? "", origin: "discover", idempotencyKey: randomUUID() });
    assert.notEqual(single.sessionId, imported.sessionId);
    assert.deepEqual((await openSessions()).map((session) => session.id), [single.sessionId, imported.sessionId]);
    await study.endStudySession(learner.id, single.sessionId);
    await library.addCourseToLibrary(learner.id, queuedSlug);

    let view = await study.getStudySession(learner.id, imported.sessionId);
    assert.equal(view.activeResourceId, videoIds[0]);
    assert.deepEqual(view.course?.sections.map((section) => section.title), ["Foundations", "Practice"]);
    assert.deepEqual(view.course?.sections.flatMap((section) => section.lessons.map((lesson) => lesson.state)), ["current", "locked", "locked"]);

    // A later lesson stays locked until the ones before it are complete.
    await assert.rejects(
      study.attachSessionResource(learner.id, imported.sessionId, { resourceId: videoIds[2] ?? "", idempotencyKey: randomUUID() }),
      (error: unknown) => error instanceof AuthError && error.code === "LESSON_LOCKED",
    );

    await complete(imported.sessionId, videoIds[0] ?? "");
    view = await study.getStudySession(learner.id, imported.sessionId);
    assert.equal(view.activeResourceId, videoIds[1]);
    assert.deepEqual(view.course?.sections.flatMap((section) => section.lessons.map((lesson) => lesson.state)), ["completed", "current", "locked"]);
    // A finished lesson stays inside its course: the course moves to the Library only once every lesson is done.
    assert.deepEqual(await librarySessions(), []);

    // A lesson whose completion was already logged once (an earlier watch) still moves the course on when it is finished.
    const copied = await migrator`
      INSERT INTO activity.activity_events (schema_version, user_id, study_session_id, resource_id, event_type, actor_type, source, idempotency_key, occurred_at, payload)
      SELECT schema_version, user_id, study_session_id, ${videoIds[1] ?? ""}, event_type, actor_type, source, replace(idempotency_key, ${videoIds[0] ?? ""}, ${videoIds[1] ?? ""}), now() - interval '5 days', payload
      FROM activity.activity_events WHERE user_id = ${learner.id} AND idempotency_key = ${`study:milestone:${imported.sessionId}:${videoIds[0]}:completed`}`;
    assert.equal(copied.count, 1);
    await complete(imported.sessionId, videoIds[1] ?? "");
    assert.equal((await study.getStudySession(learner.id, imported.sessionId)).activeResourceId, videoIds[2]);
    await complete(imported.sessionId, videoIds[2] ?? "");
    view = await study.getStudySession(learner.id, imported.sessionId);
    assert.equal(view.status, "completed");
    assert.deepEqual(view.course?.sections.flatMap((section) => section.lessons.map((lesson) => lesson.state)), ["completed", "completed", "completed"]);
    const [enrollment] = await migrator<{ status: string }[]>`SELECT status FROM catalog.collection_enrollments WHERE user_id = ${learner.id} AND collection_id = ${collectionId}`;
    assert.equal(enrollment?.status, "completed");

    // The finished course hands over to the queued Library course, which opens as its own course board.
    const [next, ...others] = await openSessions();
    assert.ok(next && next.id !== imported.sessionId);
    assert.deepEqual(others, []);
    const nextView = await study.getStudySession(learner.id, next.id);
    assert.equal(nextView.course?.collectionId, queuedCollectionId);
    assert.equal(nextView.activeResourceId, videoIds[3]);
    await complete(next.id, videoIds[3] ?? "");
    assert.deepEqual(await openSessions(), []);
    assert.deepEqual(await librarySessions(), [next.id, imported.sessionId]);

    // Reopening a finished video is a rewatch: ended before it is finished again, it is let go rather than kept.
    const rewatch = await study.startOrResumeStudySession(learner.id, { resourceId: videoIds[0] ?? "", origin: "discover", idempotencyKey: randomUUID() });
    await study.endStudySession(learner.id, rewatch.sessionId);
    assert.deepEqual(await librarySessions(), [next.id, imported.sessionId]);
    // A session still open with its video finished (mastery check and all) moves to the Library when it is ended.
    const revisit = await study.startOrResumeStudySession(learner.id, { resourceId: videoIds[0] ?? "", origin: "discover", idempotencyKey: randomUUID() });
    await migrator`UPDATE study.user_resource_progress SET status = 'completed', progress_pct = 100, completed_at = now() WHERE user_id = ${learner.id} AND resource_id = ${videoIds[0] ?? ""}`;
    await study.endStudySession(learner.id, revisit.sessionId);
    assert.deepEqual(await openSessions(), []);
    assert.deepEqual(await librarySessions(), [revisit.sessionId, next.id, imported.sessionId]);

    // A finished course is revisited from the Library, never reopened as a session.
    await assert.rejects(study.startCollection(learner.id, collectionId, randomUUID()), (error: unknown) => error instanceof AuthError && error.code === "COURSE_COMPLETED");
    const detail = await library.getCollectionDetail(learner.id, collectionId);
    assert.equal(detail.status, "completed");
    assert.deepEqual(detail.sections.flatMap((section) => section.items.map((item) => [item.completed, item.youtubeId])), youtubeIds.slice(0, 3).map((id) => [true, id]));

    const paperIds = [`paper-${randomUUID()}`, `paper-${randomUUID()}`];
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status)
      VALUES
        (${trackResourceIds[0] ?? ""}, NULL, 'paper', 'arxiv', ${paperIds[0] ?? ""}, ${`https://arxiv.org/abs/${paperIds[0]}`}, 'Track paper one', 'First abstract.', 'public', 'ready'),
        (${trackResourceIds[1] ?? ""}, NULL, 'paper', 'arxiv', ${paperIds[1] ?? ""}, ${`https://arxiv.org/abs/${paperIds[1]}`}, 'Track paper two', 'Second abstract.', 'public', 'ready')
    `;
    await migrator`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, pdf_source_url)
      VALUES (${trackResourceIds[0] ?? ""}, ${paperIds[0] ?? ""}, 'First abstract.', 'arXiv', ${`https://arxiv.org/pdf/${paperIds[0]}`}),
        (${trackResourceIds[1] ?? ""}, ${paperIds[1] ?? ""}, 'Second abstract.', 'arXiv', ${`https://arxiv.org/pdf/${paperIds[1]}`})
    `;
    await migrator`INSERT INTO catalog.authors (id, normalized_name, preferred_name) VALUES (${trackAuthorId}, 'tracktestauthor', 'Track Test Author')`;
    await migrator`INSERT INTO catalog.paper_authors (paper_resource_id, author_id, ordinal) VALUES (${trackResourceIds[0] ?? ""}, ${trackAuthorId}, 0), (${trackResourceIds[1] ?? ""}, ${trackAuthorId}, 0)`;
    await migrator`INSERT INTO catalog.collections (id, kind, slug, visibility, title) VALUES (${trackCollectionId}, 'learning_path', ${`research-track-${trackId}`}, 'public', 'Paper track')`;
    await migrator`INSERT INTO catalog.collection_sections (id, collection_id, title, position, metadata) VALUES (${trackSectionId}, ${trackCollectionId}, 'Paper module', 0, '{"concepts":[]}'::jsonb)`;
    await migrator`INSERT INTO catalog.collection_items (section_id, resource_id, position, required) VALUES (${trackSectionId}, ${trackResourceIds[0] ?? ""}, 0, true), (${trackSectionId}, ${trackResourceIds[1] ?? ""}, 1, true)`;
    const trackSession = await study.startResearchTrack(learner.id, trackId, randomUUID());
    assert.equal(trackSession.resourceType, "paper");
    assert.equal(trackSession.route, `/app/study/paper/${trackSession.sessionId}`);
    assert.equal((await study.startResearchTrack(learner.id, trackId, randomUUID())).sessionId, trackSession.sessionId);
    assert.equal((await openSessions()).find((session) => session.id === trackSession.sessionId)?.isCourse, true);
    const paperCourse = await study.getStudySession(learner.id, trackSession.sessionId);
    assert.deepEqual(paperCourse.course?.sections[0]?.lessons.map((lesson) => [lesson.type, lesson.byline, lesson.summary, lesson.state]), [
      ["paper", "Track Test Author", "First abstract.", "current"],
      ["paper", "Track Test Author", "Second abstract.", "locked"],
    ]);
    await study.updateStudyProgress(learner.id, trackSession.sessionId, {
      resourceId: trackResourceIds[0] ?? "", progressPct: 100, anchor: { kind: "paper", page: 1 }, event: "complete", idempotencyKey: randomUUID(),
    });
    assert.equal((await study.getStudySession(learner.id, trackSession.sessionId)).activeResourceId, trackResourceIds[1]);
  } finally {
    try {
      await migrator`DELETE FROM knowledge.artifact_details WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM knowledge.mastery_signals WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM knowledge.unresolved_questions WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM agent.agent_runs WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM discovery.recommendation_runs WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM practice.coding_attempts WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM retrieval.retrieval_runs WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.focus_sessions WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.mastery_checks WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.schedule_items WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.session_transcript WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.tutor_threads WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM projection.session_summary WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM activity.activity_events WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${learner.id})`;
      await migrator`DELETE FROM study.study_sessions WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM catalog.collection_enrollments WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM catalog.library_items WHERE user_id = ${learner.id}`;
      await migrator`DELETE FROM identity.users WHERE id = ${learner.id}`;

      await migrator`DELETE FROM catalog.collection_items WHERE section_id IN (${sectionIds[0] ?? ""}, ${sectionIds[1] ?? ""}, ${queuedSectionId}, ${trackSectionId})`;
      await migrator`DELETE FROM catalog.collection_sections WHERE id IN (${sectionIds[0] ?? ""}, ${sectionIds[1] ?? ""}, ${queuedSectionId}, ${trackSectionId})`;
      await migrator`DELETE FROM catalog.collections WHERE id IN (${collectionId}, ${queuedCollectionId}, ${trackCollectionId})`;
      await migrator`DELETE FROM catalog.paper_authors WHERE paper_resource_id IN (${trackResourceIds[0] ?? ""}, ${trackResourceIds[1] ?? ""})`;
      await migrator`DELETE FROM catalog.paper_details WHERE resource_id IN (${trackResourceIds[0] ?? ""}, ${trackResourceIds[1] ?? ""})`;
      await migrator`DELETE FROM catalog.video_details WHERE resource_id IN (${videoIds[0] ?? ""}, ${videoIds[1] ?? ""}, ${videoIds[2] ?? ""}, ${videoIds[3] ?? ""})`;
      await migrator`DELETE FROM catalog.resources WHERE id IN (${trackResourceIds[0] ?? ""}, ${trackResourceIds[1] ?? ""}, ${videoIds[0] ?? ""}, ${videoIds[1] ?? ""}, ${videoIds[2] ?? ""}, ${videoIds[3] ?? ""})`;
      await migrator`DELETE FROM catalog.authors WHERE id = ${trackAuthorId}`;
    } finally {
      await migrator.end();
      await closeDb();
    }
  }
});

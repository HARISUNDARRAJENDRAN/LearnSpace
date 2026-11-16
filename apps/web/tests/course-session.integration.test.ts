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
  } finally {
    await migrator`DELETE FROM identity.users WHERE id = ${learner.id}`.catch(() => undefined);
    await migrator.end();
    await closeDb();
  }
});

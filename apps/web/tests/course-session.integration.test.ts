import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { AuthError } from "../lib/auth/errors";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);

test("A Discover course imports as one session whose lessons unlock in order", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
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

    assert.equal(await study.findCurrentStudySession(learner.id), null);
    assert.equal(await study.isCourseImportable(slug, learner.id), true);
    const imported = await study.importCourseToSessions(learner.id, slug);
    assert.equal(imported.resourceType, "video");
    assert.deepEqual(await study.findCurrentStudySession(learner.id), { id: imported.sessionId });

    // Only one session at a time: another import, a single video or a Library course waits for this course to finish.
    const inProgress = (error: unknown) => error instanceof AuthError && error.code === "SESSION_IN_PROGRESS";
    await assert.rejects(study.importCourseToSessions(learner.id, slug), inProgress);
    await assert.rejects(study.startOrResumeStudySession(learner.id, { resourceId: videoIds[3] ?? "", origin: "discover", idempotencyKey: randomUUID() }), inProgress);
    await assert.rejects(study.startCollection(learner.id, queuedCollectionId, randomUUID()), inProgress);
    // Continuing the course that is already in Sessions reopens it instead.
    assert.equal((await study.startCollection(learner.id, collectionId, randomUUID())).sessionId, imported.sessionId);
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

    await complete(imported.sessionId, videoIds[1] ?? "");
    await complete(imported.sessionId, videoIds[2] ?? "");
    view = await study.getStudySession(learner.id, imported.sessionId);
    assert.equal(view.status, "completed");
    assert.deepEqual(view.course?.sections.flatMap((section) => section.lessons.map((lesson) => lesson.state)), ["completed", "completed", "completed"]);
    const [enrollment] = await migrator<{ status: string }[]>`SELECT status FROM catalog.collection_enrollments WHERE user_id = ${learner.id} AND collection_id = ${collectionId}`;
    assert.equal(enrollment?.status, "completed");

    // The finished course hands over to the queued Library course, which opens as its own course board.
    const next = await study.findCurrentStudySession(learner.id);
    assert.ok(next && next.id !== imported.sessionId);
    const nextView = await study.getStudySession(learner.id, next.id);
    assert.equal(nextView.course?.collectionId, queuedCollectionId);
    assert.equal(nextView.activeResourceId, videoIds[3]);
    await complete(next.id, videoIds[3] ?? "");
    assert.equal(await study.findCurrentStudySession(learner.id), null);

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

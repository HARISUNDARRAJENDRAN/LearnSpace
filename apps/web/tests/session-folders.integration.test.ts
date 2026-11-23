import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { changeSessionFolderSchema, createSessionFolderSchema, researchGuideSchema } from "@learnspace/shared";
import postgres from "postgres";
import { AuthError } from "../lib/auth/errors";

test("folder request contracts require explicit moves and validate writable fields", () => {
  assert.equal(createSessionFolderSchema.safeParse({ title: " ", userId: randomUUID() }).success, false);
  assert.equal(createSessionFolderSchema.safeParse({ title: "Research", sessionId: randomUUID() }).success, false);
  assert.equal(createSessionFolderSchema.safeParse({ title: "Research", sessionId: randomUUID(), fromFolderId: null }).success, true);
  assert.equal(changeSessionFolderSchema.safeParse({ action: "move-session", sessionId: randomUUID(), fromFolderId: "wrong" }).success, false);
  assert.equal(changeSessionFolderSchema.safeParse({ action: "reorder-folder", direction: "up", position: 1 }).success, false);
});

const dbAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL);
const status = (expected: number) => (error: unknown) => error instanceof AuthError && error.status === expected;

test("folders preserve mixed-mode histories and enforce ownership, idempotency, and ordering", { skip: !dbAvailable }, async (t) => {
  const [{ closeDb }, { createEmailUser }, folders, { getSessionFolderDetails }, study, notes, history] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/folders/service"), import("../lib/folders/details"),
    import("../lib/study/service"), import("../lib/notes/service"), import("../lib/library/sessions"),
  ]);
  const db = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1 });
  const app = postgres(process.env.DATABASE_URL!, { max: 1 });
  const { id: owner } = await createEmailUser({ email: `folders-${randomUUID()}@example.test`, displayName: "Folder owner", passwordHash: "test-hash" });
  const { id: other } = await createEmailUser({ email: `folders-${randomUUID()}@example.test`, displayName: "Other learner", passwordHash: "test-hash" });
  const userIds = [owner, other];
  const videoId = randomUUID();
  const paperId = randomUUID();
  const secondPaperId = randomUUID();
  const privateId = randomUUID();
  const exerciseId = randomUUID();
  const guideVersion = randomUUID();
  const allResources = [videoId, paperId, secondPaperId, privateId];
  const overview = { section: "overview", page: 1 } as const;
  try {
    const youtubeId = `f${videoId.replaceAll("-", "").slice(0, 10)}`;
    await db`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, visibility, status)
      VALUES
        (${videoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'Video explanation', 'public', 'ready'),
        (${paperId}, NULL, 'paper', 'arxiv', ${paperId}, 'https://arxiv.org/abs/2301.00001', 'First paper', 'public', 'ready'),
        (${secondPaperId}, NULL, 'paper', 'arxiv', ${secondPaperId}, 'https://arxiv.org/abs/2301.00002', 'Second paper', 'public', 'ready'),
        (${privateId}, ${other}, 'paper', 'arxiv', ${privateId}, 'https://arxiv.org/abs/2301.00003', 'Private paper', 'private', 'ready')
    `;
    await db`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${videoId}, ${youtubeId}, 300000)`;
    await db`INSERT INTO catalog.paper_details (resource_id, arxiv_id) VALUES (${paperId}, ${paperId}), (${secondPaperId}, ${secondPaperId}), (${privateId}, ${privateId})`;
    const begin = (resourceId: string, origin: "home" | "research") => study.startOrResumeStudySession(owner, { resourceId, origin, idempotencyKey: randomUUID() });
    const [first, second] = await Promise.all([begin(paperId, "research"), begin(secondPaperId, "research")]);
    const ownerSession = first.sessionId;
    const otherSession = (await study.startOrResumeStudySession(other, { resourceId: privateId, origin: "research", idempotencyKey: randomUUID() })).sessionId;
    assert.equal((await study.listStudySessions(owner)).length, 2);
    assert.deepEqual(await folders.listSessionFolders(owner), []);
    const folder = await folders.createSessionFolder(owner, { title: "World Models Research", description: "Compare papers and lectures" });
    const destination = await folders.createSessionFolder(owner, { title: "Other project" });
    const foreign = await folders.createSessionFolder(other, { title: "Private project" });
    assert.deepEqual((await getSessionFolderDetails(owner, folder.id, overview)).counts, { sessions: 0, papers: 0, videos: 0 });
    await assert.rejects(getSessionFolderDetails(other, folder.id, overview), status(404));
    await assert.rejects(folders.changeSessionFolder(other, folder.id, { action: "edit", title: "Forbidden", description: null }), status(404));
    await folders.deleteSessionFolder(other, folder.id);
    await assert.rejects(folders.changeSessionFolder(owner, folder.id, { action: "move-session", sessionId: otherSession, fromFolderId: null }), status(404));
    await assert.rejects(folders.changeSessionFolder(owner, folder.id, { action: "save-resource", resourceId: privateId }), status(404));

    const asOwner = (operation: (tx: postgres.TransactionSql) => Promise<unknown>) => app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${owner}, true)`;
      return operation(tx);
    });
    await assert.rejects(asOwner((tx) => tx`INSERT INTO study.session_folder_memberships (folder_id, user_id, study_session_id, position) VALUES (${foreign.id}, ${owner}, ${ownerSession}, 0)`), { code: "23503" });
    await assert.rejects(asOwner((tx) => tx`INSERT INTO study.session_folder_memberships (folder_id, user_id, study_session_id, position) VALUES (${folder.id}, ${owner}, ${otherSession}, 0)`), { code: "23503" });
    await assert.rejects(asOwner((tx) => tx`INSERT INTO study.session_folder_resources (folder_id, user_id, resource_id, position) VALUES (${folder.id}, ${owner}, ${privateId}, 0)`), { code: "42501" });

    const move = (folderId: string, sessionId: string, fromFolderId: string | null = null) =>
      folders.changeSessionFolder(owner, folderId, { action: "move-session", sessionId, fromFolderId });
    const competing = await Promise.allSettled([move(folder.id, first.sessionId), move(destination.id, first.sessionId)]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    const winner = competing[0]?.status === "fulfilled" ? folder.id : destination.id;
    await move(folder.id, first.sessionId, winner);
    await move(folder.id, first.sessionId);
    const createdFromSession = await folders.createSessionFolder(owner, { title: "New from session", sessionId: second.sessionId, fromFolderId: null });
    await move(folder.id, second.sessionId, createdFromSession.id);
    await folders.deleteSessionFolder(owner, createdFromSession.id);

    await folders.changeSessionFolder(owner, folder.id, { action: "save-resource", resourceId: videoId });
    await folders.changeSessionFolder(owner, folder.id, { action: "save-resource", resourceId: videoId });
    assert.deepEqual((await getSessionFolderDetails(owner, folder.id, overview)).resources.map((item) => item.id), [videoId]);
    const start = { action: "start-resource", resourceId: videoId, idempotencyKey: randomUUID() } as const;
    const [video, retry] = await Promise.all([
      folders.changeSessionFolder(owner, folder.id, start), folders.changeSessionFolder(owner, folder.id, start),
    ]);
    assert.ok(video);
    assert.deepEqual(retry, video);
    assert.equal((await study.listStudySessions(owner)).length, 3);
    assert.match(video.route, /\/study\/video\//);
    assert.match(first.route, /\/study\/paper\//);
    assert.equal((await getSessionFolderDetails(owner, folder.id, overview)).resources.length, 0);
    const snapshot = await folders.listSessionFolders(owner);
    assert.deepEqual(snapshot[0]?.sessionIds, [first.sessionId, second.sessionId, video.sessionId]);
    await folders.changeSessionFolder(owner, folder.id, { action: "reorder-session", sessionId: video.sessionId, direction: "up" });
    await folders.changeSessionFolder(owner, destination.id, { action: "reorder-folder", direction: "up" });
    assert.deepEqual((await folders.listSessionFolders(owner)).map((item) => item.id), [destination.id, folder.id]);
    assert.deepEqual((await folders.listSessionFolders(owner))[1]?.sessionIds, [first.sessionId, video.sessionId, second.sessionId]);
    assert.ok((await folders.folderSessionCandidates(owner, destination.id, "Second")).some((item) => item.id === second.sessionId && item.folderId === folder.id));

    await folders.changeSessionFolder(owner, destination.id, { action: "save-resource", resourceId: videoId });
    await folders.changeSessionFolder(owner, destination.id, { action: "save-resource", resourceId: paperId });
    await folders.changeSessionFolder(owner, destination.id, { action: "reorder-resource", resourceId: paperId, direction: "up" });
    assert.deepEqual((await getSessionFolderDetails(owner, destination.id, overview)).resources.map((item) => item.id), [paperId, videoId]);
    await folders.changeSessionFolder(owner, destination.id, { action: "remove-resource", resourceId: paperId });
    await assert.rejects(folders.changeSessionFolder(owner, destination.id, start), status(409));
    const moved = await folders.changeSessionFolder(owner, destination.id, { ...start, moveFrom: { sessionId: video.sessionId, folderId: folder.id } });
    assert.equal(moved?.sessionId, video.sessionId);
    await folders.changeSessionFolder(owner, destination.id, { action: "unfile-session", sessionId: video.sessionId });
    await folders.changeSessionFolder(owner, destination.id, start);
    assert.equal((await folders.listSessionFolders(owner))[0]?.sessionIds.length, 0, "a replay does not refile the session");
    await move(folder.id, video.sessionId);

    const threadIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const materialSessions = [[first.sessionId, paperId], [second.sessionId, secondPaperId], [video.sessionId, videoId], [first.sessionId, paperId]] as const;
    for (const [index, [sessionId, resourceId]] of materialSessions.entries()) {
      const threadId = threadIds[index]!;
      await db`
        INSERT INTO study.tutor_threads (id, user_id, study_session_id, resource_id, mode, status, started_at)
        VALUES (${threadId}, ${owner}, ${sessionId}, ${resourceId}, 'test', 'ended', now() + ${index} * interval '1 second')`;
      await db`
        INSERT INTO study.tutor_messages (thread_id, actor_type, content_text, created_at)
        VALUES (${threadId}, 'user', ${`Question ${index + 1}`}, now()),
               (${threadId}, 'user', ${`Follow-up ${index + 1}`}, now() + interval '1 second')`;
    }
    await db`INSERT INTO study.session_transcript (study_session_id, user_id, resource_id, speaker, text) VALUES (${video.sessionId}, ${owner}, ${videoId}, 'you', 'Spoken observation')`;
    await db`INSERT INTO practice.coding_problems (id, resource_id, concept, difficulty, status, title, contract_version)
      VALUES (${exerciseId}, ${videoId}, 'Planning', 'easy', 'rejected', 'Rollout exercise', 'test')`;
    await db`INSERT INTO practice.coding_attempts (user_id, study_session_id, resource_id, problem_id, role, state, language, drafts)
      VALUES (${owner}, ${video.sessionId}, ${videoId}, ${exerciseId}, 'primary', 'working', 'python', '{"python":"rollout = []"}')`;
    await study.saveStudyWorkspace(owner, video.sessionId, { code: { language: "python", code: "print(42)" } });
    const anchors = [{ kind: "paper", page: 4, sectionId: "method", chunkId: randomUUID() }];
    const cited = { text: "Compare representations.", anchors };
    const guide = researchGuideSchema.parse({
      title: "Representation project", mechanism: "Predict a target representation", objective: "Compare loss curves.",
      prerequisites: [], relationship: cited, motivation: { scenario: "A latent prediction", prediction: "Loss falls", answer: "Check the curve", anchors },
      workedExample: { steps: [cited, cited] },
      explorer: { parameters: [], outputs: [{ id: "loss", label: "Loss", symbol: "" }], table: [{ parameters: {}, outputs: { loss: 0 } }] },
      edgeCases: [{ setup: "Constant input", prediction: "Collapse", answer: "Inspect variance", anchors }],
      mapping: [{ toy: "One view", fullSystem: "Many views", anchors }, { toy: "Short rollout", fullSystem: "Long rollout", anchors }],
      caveats: [cited], project: { steps: [cited, cited], expectedResults: ["Lower loss"], validation: "Measure variance.", misconceptions: [], furtherExploration: [] },
      takeaways: [cited, cited],
    });
    await db`INSERT INTO catalog.resource_versions
      (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES (${guideVersion}, ${paperId}, 1, ${"d".repeat(64)}, ${"d".repeat(64)}, ${`papers/${paperId}`}, 'application/pdf', 'test', '1', 'ready', now(), now())`;
    await db`UPDATE study.session_resources SET resource_version_id = ${guideVersion}, binding_status = 'ready' WHERE study_session_id = ${first.sessionId} AND resource_id = ${paperId}`;
    await db`INSERT INTO practice.paper_coding_profiles (resource_version_id, resource_id, status, guide_status, guide)
      VALUES (${guideVersion}, ${paperId}, 'ready', 'ready', ${db.json(guide)})`;
    await notes.editNotes(owner, first.sessionId, { ops: [{ action: "insert", id: "first-note", after: null, type: "paragraph", text: "Paper annotations", done: false }] });
    await notes.editNotes(owner, video.sessionId, { ops: [{ action: "insert", id: "video-note", after: null, type: "paragraph", text: "Lesson notes", done: false }] });
    await study.updateStudyProgress(owner, video.sessionId, { resourceId: videoId, event: "checkpoint", progressPct: 42, anchor: { kind: "video", positionMs: 126000 }, idempotencyKey: randomUUID() });
    await assert.rejects(notes.getNotes(other, first.sessionId), status(404));
    await assert.rejects(history.getFolderSessionContents(other, folder.id, first.sessionId), status(404));
    const detail = await getSessionFolderDetails(owner, folder.id, overview);
    assert.deepEqual(detail.counts, { sessions: 3, videos: 1, papers: 2 });
    assert.deepEqual(detail.sessions.find((item) => item.id === video.sessionId)?.lessons[0]?.anchor, { kind: "video", positionMs: 126000 });
    assert.equal((await getSessionFolderDetails(owner, folder.id, { section: "papers", page: 1 })).sessions.length, 2);
    assert.equal((await getSessionFolderDetails(owner, folder.id, { section: "videos", page: 1 })).sessions.length, 1);
    assert.equal((await getSessionFolderDetails(owner, folder.id, { section: "threads", page: 1 })).sessions.length, 3);
    assert.equal((await getSessionFolderDetails(owner, folder.id, { section: "notes", page: 1 })).sessions.length, 2);
    const paperHistory = await history.getFolderSessionContents(owner, folder.id, first.sessionId);
    assert.deepEqual(paperHistory.lessons[0]?.guide, guide);
    assert.deepEqual(paperHistory.lessons[0]?.chats.map((chat) => chat.id), [threadIds[0], threadIds[3]]);
    assert.deepEqual(paperHistory.lessons[0]?.chats[0]?.messages.map((message) => message.text), ["Question 1", "Follow-up 1"]);

    await study.endStudySession(owner, video.sessionId);
    const ended = await history.getFolderSessionContents(owner, folder.id, video.sessionId);
    assert.equal(ended.lessons[0]?.notes[0]?.text, "Lesson notes");
    assert.equal(ended.lessons[0]?.voice[0]?.text, "Spoken observation");
    assert.equal(ended.code?.code, "print(42)");
    assert.equal(ended.lessons[0]?.exercises[0]?.drafts.python, "rollout = []");
    assert.equal((await study.listStudySessions(owner, "ended"))[0]?.id, video.sessionId);
    assert.deepEqual(await history.getEndedSessionContents(owner, video.sessionId), ended);
    await assert.rejects(history.getEndedSessionContents(other, video.sessionId), status(404));
    await db`UPDATE study.study_sessions SET status = 'completed', ended_at = now() WHERE id = ${first.sessionId}`;
    assert.deepEqual(await history.getLibrarySessionContents(owner, first.sessionId), paperHistory);

    const bigFolder = await folders.createSessionFolder(owner, { title: "Large folder" });
    await db`
      WITH sessions AS (
        INSERT INTO study.study_sessions (user_id, mode, title, active_resource_id)
        SELECT ${owner}, 'guided_learning', 'Fixture session ' || i, ${videoId} FROM generate_series(1, 250) i RETURNING id
      ), members AS (
        INSERT INTO study.session_folder_memberships (user_id, folder_id, study_session_id, position)
        SELECT ${owner}, ${bigFolder.id}, id, row_number() OVER (ORDER BY id) FROM sessions
      )
      INSERT INTO study.session_resources (study_session_id, resource_id, role, added_by, binding_status)
      SELECT id, ${videoId}, 'primary', 'user', 'preparing' FROM sessions`;
    const mark = performance.now();
    const large = await getSessionFolderDetails(owner, bigFolder.id, overview);
    const elapsed = performance.now() - mark;
    assert.equal(large.counts.sessions, 250);
    assert.equal(large.sessions.length, 20);
    assert.equal(large.hasMore, true);
    assert.equal((await getSessionFolderDetails(owner, bigFolder.id, { section: "overview", page: 13 })).sessions.length, 10);
    t.diagnostic(`250-session folder, first page: ${elapsed.toFixed(1)} ms and ${Buffer.byteLength(JSON.stringify(large))} JSON bytes (local database)`);

    await folders.deleteSessionFolder(owner, folder.id);
    await assert.rejects(history.getFolderSessionContents(owner, folder.id, first.sessionId), status(404));
    assert.deepEqual(await history.getLibrarySessionContents(owner, first.sessionId), paperHistory);
    assert.equal((await notes.getNotes(owner, first.sessionId)).blocks[0]?.text, "Paper annotations");
    const [kept] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM study.study_sessions WHERE id IN ${db([first.sessionId, second.sessionId, video.sessionId])}`;
    assert.equal(kept?.count, 3);
  } finally {
    await db`DELETE FROM study.session_folders WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM practice.coding_attempts WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM practice.coding_problems WHERE id = ${exerciseId}`;
    await db`DELETE FROM study.tutor_messages WHERE thread_id IN (SELECT id FROM study.tutor_threads WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.tutor_threads WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM study.session_transcript WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM study.video_notes WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM ops.outbox_events WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM ops.idempotency_records WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM activity.activity_events WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM discovery.discovery_interactions WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.user_resource_progress WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${db(userIds)})`;
    await db`DELETE FROM study.study_sessions WHERE user_id IN ${db(userIds)}`;
    await db`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
    await db`DELETE FROM catalog.paper_details WHERE resource_id IN ${db(allResources)}`;
    await db`DELETE FROM practice.paper_coding_profiles WHERE resource_version_id = ${guideVersion}`;
    await db`DELETE FROM catalog.resource_versions WHERE id = ${guideVersion}`;
    await db`DELETE FROM catalog.resources WHERE id IN ${db(allResources)}`;
    await db`DELETE FROM identity.users WHERE id IN ${db(userIds)}`;
    await Promise.all([db.end(), app.end(), closeDb()]);
  }
});

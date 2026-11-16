import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { NoteOp, NotesScribeOutput, VoiceTurnEvent, VoiceTurnRequest } from "@learnspace/shared/notes";
import { type TutorModel, TutorModelError, type TutorModelRequest } from "../lib/ai/tutor-model";
import { AuthError } from "../lib/auth/errors";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);
const usage = { inputTokens: 2_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 0, fast: false };
const turn = (utterance: string | null, playing = false): VoiceTurnRequest => ({ utterance, positionMs: 70_000, playing, frame: null, watchedFromMs: null });
const op = (value: Partial<NoteOp> & Pick<NoteOp, "action" | "id">): NoteOp => ({ after: null, type: null, text: null, done: null, ...value });
const scribeOp = (value: NoteOp): NotesScribeOutput["ops"][number] => ({ ...value, cite: null });

/** Replies with the next scripted output, streamed a few characters at a time as the provider does. */
function scriptedModel(outputs: Array<NotesScribeOutput | string | (() => Promise<NotesScribeOutput>)>, calls: TutorModelRequest[]): TutorModel {
  return async (request, { signal, onText }) => {
    calls.push(request);
    const scripted = outputs.shift();
    const next = typeof scripted === "function" ? await scripted() : scripted;
    if (signal.aborted) throw new TutorModelError("cancelled");
    const text = typeof next === "string" ? next : JSON.stringify(next);
    for (let at = 7; at < text.length + 7; at += 7) onText?.(text.slice(0, at));
    return { text, refusal: null, usage, firstOutputMs: 50, latencyMs: 300 };
  };
}

/** Streams each reply in the given pieces, as the provider does. */
function streamingModel(replies: string[][], calls: TutorModelRequest[]): TutorModel {
  return async (request, { onText }) => {
    calls.push(request);
    let text = "";
    for (const piece of replies.shift() ?? []) { text += piece; onText?.(text); }
    return { text, refusal: null, usage: { ...usage, outputTokens: 20 }, firstOutputMs: 640, latencyMs: 900 };
  };
}

test("Luny answers out loud with her lesson commands taken out, each exchange is saved once, and the scribe never overwrites the learner", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required");
  const [{ closeDb }, { createEmailUser }, study, notes] = await Promise.all([
    import("@learnspace/db"),
    import("../lib/auth/repository"),
    import("../lib/study/service"),
    import("../lib/notes/service"),
  ]);
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const owner = await createEmailUser({ email: `notes-${randomUUID()}@example.test`, displayName: "Notes Owner", passwordHash: "test-hash" });
  const other = await createEmailUser({ email: `notes-other-${randomUUID()}@example.test`, displayName: "Notes Other", passwordHash: "test-hash" });
  const users = [owner.id, other.id];
  const videoId = randomUUID();
  const versionId = randomUUID();
  const youtubeId = `v${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const lines = ["Gradient descent moves downhill on the loss.", "A learning rate that is too large overshoots the minimum."];
  try {
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, visibility, status, quality_score, metadata)
      VALUES (${videoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'Gradient descent explained', 'public', 'ready', 0.9, '{}'::jsonb)`;
    await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${videoId}, ${youtubeId}, 300000)`;
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${videoId}, 1, ${"d".repeat(64)}, ${"d".repeat(64)}, ${`transcripts/${videoId}`}, 'application/json', 'learner-captions', '1', 'ready', now(), now())`;
    for (const [ordinal, content] of lines.entries()) {
      await migrator`
        INSERT INTO retrieval.resource_chunks (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, language, start_ms, end_ms)
        VALUES (${versionId}, ${ordinal}, 'transcript', ${content}, ${createHash("sha256").update(content).digest("hex")}, ${Math.ceil(content.length / 4)}, 'en', ${ordinal * 60_000}, ${ordinal * 60_000 + 59_000})`;
    }
    await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${videoId}`;
    const { sessionId } = await study.startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: `notes-${randomUUID()}` });

    assert.deepEqual(await notes.getNotes(owner.id, sessionId), { revision: 0, blocks: [], canUndo: false, guide: "pending" });
    await assert.rejects(notes.getNotes(other.id, sessionId), (error: unknown) => error instanceof AuthError && error.code === "STUDY_SESSION_NOT_FOUND");

    // A spoken turn streams Luny's words with her playback commands taken out, even one split across pieces.
    const talks: TutorModelRequest[] = [];
    const talker = streamingModel([["Partly. [", "[seek 1", ":10]]Why would", " a big step overshoot?"], ["[[listen]]"]], talks);
    const events: VoiceTurnEvent[] = [];
    const emit = (event: VoiceTurnEvent) => events.push(event);
    await notes.runVoiceTurn(owner.id, sessionId, turn("I think a big learning rate overshoots"), { signal: new AbortController().signal, emit, model: talker });
    assert.deepEqual(events.map((event) => event.type === "say" ? event.text : event.type === "control" ? event.control : event.type), ["Partly. ", "Why would", { seekMs: 70_000, playback: null }, " a big step overshoot?", "", "done"]);
    assert.equal(talks[0]?.schema, undefined, "Luny speaks plain text");
    assert.equal(talks[0]?.fast, true);
    assert.match(talks[0]?.instructions ?? "", /<lesson title="Gradient descent explained">/);
    assert.match(talks[0]?.instructions ?? "", /\[1:00\] A learning rate that is too large overshoots the minimum\./);
    assert.match(talks[0]?.user ?? "", /<notebook>\n\(empty\)/);
    assert.match(talks[0]?.user ?? "", /<learner>\n\(no mastery check taken in this session yet\)/);
    assert.match(talks[0]?.user ?? "", /\(At 1:10 in the video, paused\.\)\nLearner: I think a big learning rate overshoots$/);
    await assert.rejects(notes.runVoiceTurn(other.id, sessionId, turn("not my session"), { signal: new AbortController().signal, emit, model: talker }), (error: unknown) => error instanceof AuthError && error.code === "STUDY_SESSION_NOT_FOUND");

    // The lesson's own audio, heard by the microphone while it plays, never reaches Luny.
    events.length = 0;
    await notes.runVoiceTurn(owner.id, sessionId, turn("a learning rate that is too large overshoots the minimum", true), { signal: new AbortController().signal, emit, model: talker });
    assert.deepEqual(events, [{ type: "done" }]);
    assert.equal(talks.length, 1);

    const transcript = await migrator<{ speaker: string; text: string; position_ms: number }[]>`SELECT speaker, text, position_ms FROM study.session_transcript WHERE study_session_id = ${sessionId} ORDER BY seq`;
    assert.deepEqual(transcript.map((row) => [row.speaker, row.text, row.position_ms]), [["you", "I think a big learning rate overshoots", 70_000], ["luna", "Partly. Why would a big step overshoot?", 70_000]]);
    const [talk] = await migrator<{ count: number; tokens: number }[]>`SELECT count(*)::int AS count, coalesce(sum(output_tokens), 0)::int AS tokens FROM agent.model_invocations WHERE prompt_template_id = 'notes-talker' AND agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${owner.id})`;
    assert.deepEqual(talk, { count: 1, tokens: 20 });

    const calls: TutorModelRequest[] = [];
    const model = scriptedModel([
      { ops: [scribeOp(op({ action: "insert", id: "h1", type: "heading", text: "Learning rate" })), scribeOp(op({ action: "insert", id: "i1", type: "idea", text: "Big steps overshoot [1:00]" }))] },
      // The learner edits Luny's block while the scribe is still writing.
      async () => {
        const edited = await notes.editNotes(owner.id, sessionId, { ops: [op({ action: "update", id: "i1", text: "Big steps can overshoot the minimum" })] });
        assert.equal(edited.revision, 2);
        assert.equal(edited.canUndo, false, "undo never reverts the learner's own edits");
        return { ops: [scribeOp(op({ action: "update", id: "i1", type: "decision", text: "Luny's rewrite" })), scribeOp(op({ action: "insert", id: "q1", after: "h1", type: "question", text: "What about momentum?" }))] };
      },
      "{\"ops\": [",
    ], calls);

    // The scribe writes the conversation up as notes, reading the lesson, the notebook and what was said.
    // Each edit is shown as soon as it is written whole, before the pass is saved; the last waits for the end of the reply.
    const previews: { op: NoteOp; base: number }[] = [];
    const first = await notes.runScribe(owner.id, sessionId, { signal: new AbortController().signal, model, onOp: (previewed, base) => previews.push({ op: previewed, base }) });
    assert.deepEqual(previews, [{ op: op({ action: "insert", id: "h1", type: "heading", text: "Learning rate" }), base: 0 }]);
    assert.deepEqual(first.blocks.map((block) => [block.id, block.type, block.by, block.rev]), [["h1", "heading", "luna", 1], ["i1", "idea", "luna", 1]]);
    assert.equal(first.canUndo, true);
    assert.match(calls[0]?.user ?? "", /Learner: I think a big learning rate overshoots/);
    assert.match(calls[0]?.user ?? "", /Luny: Partly\. Why would a big step overshoot\?/);
    assert.match(calls[0]?.instructions ?? "", /\[1:00\] A learning rate that is too large/, "the lesson is in the cached prefix");
    assert.match(calls[0]?.user ?? "", /<notebook>\n\(empty\)/);
    assert.equal(calls[0]?.depth, "edit");

    // It cannot overwrite a block the learner changed while it was writing, but its other edits land.
    const second = await notes.runScribe(owner.id, sessionId, { signal: new AbortController().signal, model });
    assert.deepEqual(second.blocks.map((block) => [block.id, block.text]), [["h1", "Learning rate"], ["q1", "What about momentum?"], ["i1", "Big steps can overshoot the minimum"]]);
    assert.equal(second.revision, 3);

    // Turned on again, Luny opens with the notebook and what was said; choosing to listen saves nothing.
    events.length = 0;
    await notes.runVoiceTurn(owner.id, sessionId, turn(null), { signal: new AbortController().signal, emit, model: talker });
    assert.deepEqual(events, [{ type: "done" }]);
    assert.match(talks[1]?.user ?? "", /q1 \| question \| What about momentum\?/);
    assert.match(talks[1]?.user ?? "", /Learner: I think a big learning rate overshoots\nLuny: Partly\. Why would a big step overshoot\?/);
    assert.match(talks[1]?.developer ?? "", /picks up where you left off/);
    const [{ count: saved } = { count: 0 }] = await migrator<{ count: number }[]>`SELECT count(*)::int AS count FROM study.session_transcript WHERE study_session_id = ${sessionId}`;
    assert.equal(saved, 2);

    // When the learner pauses after watching a stretch, Luny may chime in, knowing what their mastery check showed; staying
    // quiet saves nothing.
    await migrator`
      INSERT INTO study.mastery_checks (user_id, study_session_id, resource_id, resource_version_id, questions, answers, status, score, written_at)
      VALUES (${owner.id}, ${sessionId}, ${videoId}, ${versionId}, ${migrator.json([{ id: "q0", concept: "Step size" }, { id: "q1", concept: "Gradient" }])}, ${migrator.json({ q0: { credit: 0 }, q1: { credit: 1 } })}, 'failed', 0.5, now())`;
    events.length = 0;
    await notes.runVoiceTurn(owner.id, sessionId, { ...turn(null), watchedFromMs: 10_000 }, { signal: new AbortController().signal, emit, model: talker });
    assert.deepEqual(events, [{ type: "done" }]);
    assert.match(talks[2]?.developer ?? "", /paused the video at 1:10, after watching from 0:10/);
    assert.match(talks[2]?.user ?? "", /<learner>\n- This video: failed its mastery check at 50%; missed Step size\.\n<\/learner>/);
    const [{ count: unchanged } = { count: 0 }] = await migrator<{ count: number }[]>`SELECT count(*)::int AS count FROM study.session_transcript WHERE study_session_id = ${sessionId}`;
    assert.equal(unchanged, 2);

    // Words Luny let go by as unfinished are answered once the learner goes quiet: she is told they are waiting for her.
    events.length = 0;
    await notes.runVoiceTurn(owner.id, sessionId, { ...turn(null), cue: "waiting" }, { signal: new AbortController().signal, emit, model: streamingModel([["Right, so the step is too big."]], talks) });
    assert.deepEqual(events, [{ type: "say", text: "Right, so the step is too big." }, { type: "say", text: "", final: true }, { type: "done" }]);
    assert.match(talks[3]?.developer ?? "", /they are waiting for you/);

    // A provider that stalls before saying anything is asked once more, so Luny answers instead of thinking forever.
    events.length = 0;
    let stalls = 0;
    const stalling: TutorModel = async (request, hooks) => {
      if (stalls++ === 0) return new Promise((_resolve, reject) => hooks.signal.addEventListener("abort", () => reject(new TutorModelError("cancelled"))));
      return streamingModel([["Good question."]], talks)(request, hooks);
    };
    await notes.runVoiceTurn(owner.id, sessionId, turn("Why does it overshoot?"), { signal: new AbortController().signal, emit, model: stalling, firstWordsMs: 50 });
    assert.equal(stalls, 2);
    assert.deepEqual(events, [{ type: "say", text: "Good question." }, { type: "say", text: "", final: true }, { type: "done" }]);

    // Undo restores the page from before the scribe's last edit, keeping the learner's.
    const undone = await notes.editNotes(owner.id, sessionId, { action: "undo" });
    assert.deepEqual(undone.blocks.map((block) => [block.id, block.text]), [["h1", "Learning rate"], ["i1", "Big steps can overshoot the minimum"]]);
    await assert.rejects(notes.editNotes(owner.id, sessionId, { action: "undo" }), (error: unknown) => error instanceof AuthError && error.code === "NOTES_UNDO_UNAVAILABLE");

    // Output that is not valid JSON changes nothing.
    const broken = await notes.runScribe(owner.id, sessionId, { signal: new AbortController().signal, model });
    assert.deepEqual(broken.blocks.map((block) => block.id), ["h1", "i1"]);

    const [runs] = await migrator<{ done: number; failed: number }[]>`SELECT count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM agent.agent_runs WHERE user_id = ${owner.id} AND purpose = 'voice_notes'`;
    assert.deepEqual(runs, { done: 7, failed: 1 });
    // A turn that didn't go ahead (the lesson's own audio, another learner's session) leaves no run behind.
    const [left] = await migrator<{ executing: number; others: number }[]>`SELECT count(*) FILTER (WHERE status = 'executing' AND user_id = ${owner.id})::int AS executing, count(*) FILTER (WHERE user_id = ${other.id})::int AS others FROM agent.agent_runs WHERE user_id IN (${owner.id}, ${other.id})`;
    assert.deepEqual(left, { executing: 0, others: 0 });

    // One answer at a time: a tutor answer still being written holds Luny back, but one that died with its server is
    // marked interrupted and does not.
    const [thread] = await migrator<{ id: string }[]>`INSERT INTO study.tutor_threads (user_id, study_session_id, resource_id, mode) VALUES (${owner.id}, ${sessionId}, ${videoId}, 'video_tutor') RETURNING id`;
    const [stale] = await migrator<{ id: string }[]>`INSERT INTO study.tutor_messages (thread_id, actor_type, status, created_at) VALUES (${thread?.id ?? ""}, 'assistant', 'pending', now() - interval '1 hour') RETURNING id`;
    events.length = 0;
    await notes.runVoiceTurn(owner.id, sessionId, turn("And with momentum?"), { signal: new AbortController().signal, emit, model: streamingModel([["It smooths the steps."]], talks) });
    assert.deepEqual(events.at(-1), { type: "done" });
    const [marked] = await migrator<{ status: string; failure: string | null }[]>`SELECT status, content->>'failure' AS failure FROM study.tutor_messages WHERE id = ${stale?.id ?? ""}`;
    assert.deepEqual(marked, { status: "failed", failure: "interrupted" });
    await migrator`INSERT INTO study.tutor_messages (thread_id, actor_type, status) VALUES (${thread?.id ?? ""}, 'assistant', 'pending')`;
    await assert.rejects(notes.runVoiceTurn(owner.id, sessionId, turn("Still there?"), { signal: new AbortController().signal, emit, model: talker }), (error: unknown) => error instanceof AuthError && error.code === "TUTOR_BUSY");
    await migrator`DELETE FROM study.tutor_messages WHERE thread_id = ${thread?.id ?? ""}`;
    await migrator`DELETE FROM study.tutor_threads WHERE id = ${thread?.id ?? ""}`;

    // The study guide: a failed try can be started again, and the guide lands above the notes already there.
    const guideCalls: TutorModelRequest[] = [];
    const failing: TutorModel = async () => { throw new TutorModelError("provider_timeout"); };
    const failed = await notes.startGuide(owner.id, sessionId, { model: failing });
    assert.equal(failed.notes.guide, "writing");
    await failed.write?.();
    assert.equal((await notes.getNotes(owner.id, sessionId)).guide, "failed");
    const guideModel = scriptedModel([JSON.stringify({ blocks: [
      { type: "heading", text: "Gradient descent [0:00]", cite: null },
      { type: "paragraph", text: "Each step moves against the gradient: $$\\theta \\leftarrow \\theta - \\eta \\nabla L$$", cite: null },
      { type: "eli5", text: "Walk downhill in the fog, one careful step at a time.", cite: null },
      { type: "step", text: "1. Compute the gradient.", cite: null },
      { type: "diagram", text: "not a diagram", cite: null },
      { type: "table", text: "| Rate | Effect |\n|---|---|\n| Small | Slow |\n| Large | Overshoots |", cite: null },
    ] })], guideCalls);
    const started = await notes.startGuide(owner.id, sessionId, { model: guideModel });
    assert.equal(started.notes.guide, "writing");
    assert.equal((await notes.startGuide(owner.id, sessionId, { model: guideModel })).write, null, "a guide being written is not started twice");
    await started.write?.();
    const guided = await notes.getNotes(owner.id, sessionId);
    assert.equal(guided.guide, "ready");
    assert.deepEqual(guided.blocks.map((block) => block.type), ["heading", "paragraph", "eli5", "step", "table", "heading", "idea"], "an invalid diagram is left out, and the learner's notes stay below");
    assert.match(guided.blocks[1]?.text ?? "", /\\theta \\leftarrow/);
    assert.equal(guided.blocks[3]?.text, "Compute the gradient.", "the page numbers steps itself");
    assert.equal(guided.canUndo, true);
    assert.equal(guideCalls[0]?.depth, "long");
    assert.match(guideCalls[0]?.user ?? "", /\[1:00\] A learning rate that is too large/);
    assert.match(guideCalls[0]?.user ?? "", /The video is 5:00 long\./);
    assert.equal((await notes.startGuide(owner.id, sessionId, { model: guideModel })).write, null, "a written guide is never written again");
  } finally {
    await migrator`DELETE FROM study.mastery_checks WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.video_notes WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.session_transcript WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM agent.agent_runs WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM activity.activity_events WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM study.study_sessions WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM discovery.user_concept_affinity WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id IN ${migrator(users)}`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${videoId}`;
    // The local worker may have embedded the chunks while the test ran.
    await migrator`DELETE FROM retrieval.chunk_embeddings WHERE chunk_id IN (SELECT id FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId})`;
    await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
    await migrator`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
    await migrator`DELETE FROM ops.transcript_requests WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${videoId}`;
    await migrator`DELETE FROM identity.users WHERE id IN ${migrator(users)}`;
    await migrator.end({ timeout: 5 });
    await closeDb();
  }
});

test("a long lecture's guide is written in parts over waves, and an earlier one-piece guide is continued, not rewritten", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required");
  const [{ closeDb }, { createEmailUser }, study, notes] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/study/service"), import("../lib/notes/service"),
  ]);
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const owner = await createEmailUser({ email: `notes-long-${randomUUID()}@example.test`, displayName: "Long Notes", passwordHash: "test-hash" });
  const videoId = randomUUID();
  const versionId = randomUUID();
  const youtubeId = `l${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const calls: TutorModelRequest[] = [];
  // Writes each part as a heading at the moment its stretch starts and one paragraph.
  const model: TutorModel = async (request) => {
    calls.push(request);
    const part = /part (\d+) of (\d+): the stretch from ([\d:]+)/.exec(request.user);
    const text = JSON.stringify({ blocks: [{ type: "heading", text: `Part ${part?.[1] ?? "1"} [${part?.[3] ?? "0:00"}]`, cite: null }, { type: "paragraph", text: `What part ${part?.[1] ?? "1"} teaches.`, cite: null }] });
    return { text, refusal: null, usage, firstOutputMs: 50, latencyMs: 300 };
  };
  try {
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, visibility, status, quality_score, metadata)
      VALUES (${videoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'A ten-hour course', 'public', 'ready', 0.9, '{}'::jsonb)`;
    await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${videoId}, ${youtubeId}, 36000000)`;
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${videoId}, 1, ${"e".repeat(64)}, ${"e".repeat(64)}, ${`transcripts/${videoId}`}, 'application/json', 'learner-captions', '1', 'ready', now(), now())`;
    // Ten hours, a minute per chunk, about a thousand characters a minute.
    const rows = Array.from({ length: 600 }, (_, minute) => {
      const content = `Minute ${minute} of the course. `.padEnd(1_000, "x");
      return { resource_version_id: versionId, ordinal: minute, chunk_type: "transcript", content, content_sha256: createHash("sha256").update(content).digest("hex"), token_count: 250, language: "en", start_ms: minute * 60_000, end_ms: minute * 60_000 + 59_000 };
    });
    await migrator`INSERT INTO retrieval.resource_chunks ${migrator(rows)}`;
    await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${videoId}`;
    const { sessionId } = await study.startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: `notes-long-${randomUUID()}` });

    // Seven parts: six in the first wave, then the page asks again and the last one is written.
    const first = await notes.startGuide(owner.id, sessionId, { model });
    await first.write?.();
    let page = await notes.getNotes(owner.id, sessionId);
    assert.equal(calls.length, 6);
    assert.equal(page.guide, "pending", "parts are left, so the page starts the next wave");
    assert.deepEqual(page.blocks.filter((block) => block.type === "heading").map((block) => block.text.split(" [")[0]), ["Part 1", "Part 2", "Part 3", "Part 4", "Part 5", "Part 6"]);
    const second = await notes.startGuide(owner.id, sessionId, { model });
    await second.write?.();
    page = await notes.getNotes(owner.id, sessionId);
    assert.equal(calls.length, 7, "only the missing part is written");
    assert.equal(page.guide, "ready");
    assert.deepEqual(page.blocks.filter((block) => block.type === "heading").map((block) => block.text.split(" [")[0]), ["Part 1", "Part 2", "Part 3", "Part 4", "Part 5", "Part 6", "Part 7"]);
    assert.match(calls.at(-1)!.user, /Minute 599 of the course/, "the last part reaches the end of the lecture");
    assert.equal((await notes.startGuide(owner.id, sessionId, { model })).write, null);

    // A page from before: a one-piece guide that read only the first two hours, then the learner's own note.
    const earlier = [
      { id: "aaaa1111", type: "heading", text: "The opening topics [0:00]", done: false, by: "luna", rev: 1 },
      { id: "aaaa2222", type: "paragraph", text: "What the first hours teach.", done: false, by: "luna", rev: 1 },
      { id: "mine0001", type: "bullet", text: "My own note", done: false, by: "you", rev: 2 },
    ];
    await migrator`UPDATE study.video_notes SET blocks = ${migrator.json(earlier)}, history = '[]'::jsonb, revision = 2, guide_status = 'ready' WHERE user_id = ${owner.id} AND resource_id = ${videoId}`;
    calls.length = 0;
    const upgrade = await notes.startGuide(owner.id, sessionId, { model });
    assert.equal(upgrade.notes.guide, "writing", "opening the lesson continues an earlier guide that stopped short");
    await upgrade.write?.();
    page = await notes.getNotes(owner.id, sessionId);
    assert.equal(page.guide, "ready");
    assert.equal(calls.length, 6, "parts 2 to 7, never the stretch the earlier guide covered");
    assert.ok(calls.every((call) => !/Minute 10 of the course/.test(call.user)), "nothing the earlier guide read is read again");
    assert.deepEqual(page.blocks.map((block) => block.text.split(" [")[0]).filter((text) => !text?.startsWith("What")), ["The opening topics", "Part 2", "Part 3", "Part 4", "Part 5", "Part 6", "Part 7", "My own note"], "the earlier guide stays first and the learner's note last");
    assert.equal(page.blocks.find((block) => block.text === "My own note")?.id, "mine0001", "the learner's blocks keep their ids");
    assert.equal((await notes.startGuide(owner.id, sessionId, { model })).write, null, "a continued guide is never continued again");
  } finally {
    await migrator`DELETE FROM study.video_notes WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM agent.agent_runs WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM activity.activity_events WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM study.study_sessions WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${owner.id}`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${videoId}`;
    await migrator`DELETE FROM retrieval.chunk_embeddings WHERE chunk_id IN (SELECT id FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId})`;
    await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
    await migrator`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
    await migrator`DELETE FROM ops.transcript_requests WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${videoId}`;
    await migrator`DELETE FROM identity.users WHERE id = ${owner.id}`;
    await migrator.end({ timeout: 5 });
    await closeDb();
  }
});

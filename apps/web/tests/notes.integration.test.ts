import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { NoteOp, NotesModelOutput, NotesStreamEvent } from "@learnspace/shared/notes";
import { type TutorModel, TutorModelError, type TutorModelRequest } from "../lib/ai/tutor-model";
import { AuthError } from "../lib/auth/errors";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);
const usage = { inputTokens: 2_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 0, fast: false };
const op = (value: Partial<NoteOp> & Pick<NoteOp, "action" | "id">): NoteOp => ({ after: null, type: null, text: null, done: null, ...value });

/** Replies with the next scripted output, streaming its JSON in small pieces the way the provider does. */
function scriptedModel(outputs: Array<NotesModelOutput | string | (() => Promise<NotesModelOutput>)>, calls: TutorModelRequest[]): TutorModel {
  return async (request, { signal, onText }) => {
    calls.push(request);
    const scripted = outputs.shift();
    const next = typeof scripted === "function" ? await scripted() : scripted;
    const text = typeof next === "string" ? next : JSON.stringify(next);
    for (let end = 8; end < text.length; end += 8) {
      if (signal.aborted) throw new TutorModelError("cancelled");
      onText?.(text.slice(0, end));
    }
    onText?.(text);
    return { text, refusal: null, usage, firstOutputMs: 50, latencyMs: 300 };
  };
}

test("Luna talks, keeps the notes and never overwrites the learner", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
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

    assert.deepEqual(await notes.getNotes(owner.id, sessionId), { revision: 0, blocks: [], turns: [], canUndo: false });
    await assert.rejects(notes.getNotes(other.id, sessionId), (error: unknown) => error instanceof AuthError && error.code === "STUDY_SESSION_NOT_FOUND");

    const calls: TutorModelRequest[] = [];
    const model = scriptedModel([
      { visual: { marks: [], clear: false, seekMs: null, playback: null }, opener: "Oh, nice.", say: "Why do you think big steps overshoot?", ops: [op({ action: "insert", id: "h1", type: "heading", text: "Learning rate" }), op({ action: "insert", id: "i1", type: "idea", text: "Big steps overshoot" })] },
      // The learner edits Luna's block while Luna is still answering.
      async () => {
        const edited = await notes.editNotes(owner.id, sessionId, { ops: [op({ action: "update", id: "i1", text: "Big steps can overshoot the minimum" })] });
        assert.equal(edited.revision, 2);
        assert.equal(edited.canUndo, false, "undo never reverts the learner's own edits");
        return { visual: { marks: [], clear: false, seekMs: null, playback: null }, opener: "", say: "", ops: [op({ action: "update", id: "i1", type: "decision", text: "Luna's rewrite" }), op({ action: "insert", id: "q1", after: "h1", type: "question", text: "What about momentum?" })] };
      },
      "{\"say\": \"oops\"",
      { visual: { marks: [], clear: false, seekMs: null, playback: null }, opener: "Hmm.", say: "This reply is cut off before it lands.", ops: [op({ action: "delete", id: "h1" })] },
    ], calls);

    // A turn streams its reply as it is written, then applies its edits.
    const events: NotesStreamEvent[] = [];
    await notes.runNotesTurn(owner.id, sessionId, { utterance: "I think a big learning rate overshoots", positionMs: 70_000, spatial: { pointer: { x: .2, y: .3 }, marks: [], selectedText: "learning rate", frame: "data:image/jpeg;base64,YWJj" } }, { signal: new AbortController().signal, emit: (event) => events.push(event), model });
    const says = events.filter((event) => event.type === "say");
    assert.ok(says.length > 1, "the reply streams in pieces");
    assert.equal(says.at(-1)?.type === "say" && says.at(-1)?.text, "Oh, nice. Why do you think big steps overshoot?");
    const done = events.at(-1);
    assert.ok(done?.type === "done");
    assert.deepEqual(done.notes.blocks.map((block) => [block.id, block.type, block.by, block.rev]), [["h1", "heading", "luna", 1], ["i1", "idea", "luna", 1]]);
    assert.equal(done.notes.canUndo, true);
    assert.match(calls[0]?.user ?? "", /overshoots the minimum/, "the transcript around the learner's place is in the prompt");
    assert.match(calls[0]?.user ?? "", /Gradient descent explained/);
    assert.match(calls[0]?.user ?? "", /learning rate/);
    assert.equal(calls[0]?.image, "data:image/jpeg;base64,YWJj");
    assert.ok(!(calls[0]?.user ?? "").includes("data:image"), "image bytes stay out of text prompts and saved conversation");
    assert.deepEqual(done.visual, { marks: [], clear: false, seekMs: null, playback: null });

    // Luna cannot overwrite a block the learner changed while she was answering, but her other edits land.
    events.length = 0;
    await notes.runNotesTurn(owner.id, sessionId, { utterance: "yeah and momentum", positionMs: null }, { signal: new AbortController().signal, emit: (event) => events.push(event), model });
    const second = events.at(-1);
    assert.ok(second?.type === "done");
    assert.deepEqual(second.notes.blocks.map((block) => [block.id, block.text]), [["h1", "Learning rate"], ["q1", "What about momentum?"], ["i1", "Big steps can overshoot the minimum"]]);
    assert.equal(second.notes.revision, 3);

    // Undo restores the page from before Luna's last edit, keeping the learner's.
    const undone = await notes.editNotes(owner.id, sessionId, { action: "undo" });
    assert.deepEqual(undone.blocks.map((block) => [block.id, block.text]), [["h1", "Learning rate"], ["i1", "Big steps can overshoot the minimum"]]);
    await assert.rejects(notes.editNotes(owner.id, sessionId, { action: "undo" }), (error: unknown) => error instanceof AuthError && error.code === "NOTES_UNDO_UNAVAILABLE");

    // Output that is not valid JSON changes nothing and says so.
    events.length = 0;
    await notes.runNotesTurn(owner.id, sessionId, { utterance: "hello?", positionMs: null }, { signal: new AbortController().signal, emit: (event) => events.push(event), model });
    assert.equal(events.at(-1)?.type, "error");

    // A turn the learner cuts off changes nothing and is not remembered.
    const controller = new AbortController();
    events.length = 0;
    await notes.runNotesTurn(owner.id, sessionId, { utterance: "wait, scrap the heading", positionMs: null }, { signal: controller.signal, emit: (event) => { events.push(event); if (event.type === "say") controller.abort(); }, model });
    assert.ok(!events.some((event) => event.type === "done" || event.type === "error"));
    const after = await notes.getNotes(owner.id, sessionId);
    assert.deepEqual(after.blocks.map((block) => block.id), ["h1", "i1"]);
    assert.deepEqual(after.turns.map((turn) => turn.you), ["I think a big learning rate overshoots", "yeah and momentum"]);

    const [runs] = await migrator<{ done: number; failed: number }[]>`SELECT count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM agent.agent_runs WHERE user_id = ${owner.id} AND purpose = 'voice_notes'`;
    assert.deepEqual(runs, { done: 2, failed: 2 });
  } finally {
    await migrator`DELETE FROM study.session_notes WHERE user_id IN ${migrator(users)}`;
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

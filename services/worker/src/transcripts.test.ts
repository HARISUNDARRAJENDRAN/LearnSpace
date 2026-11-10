import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { TranscriptSegment } from "@learnspace/shared/transcripts";
import { chunkTranscript, classifyPlayerResponse, firecrawlNext, parseFirecrawlTranscript, pickCaptionTrack, transcriptHash, transcriptUpkeep } from "./transcripts.js";

const track = (languageCode: string, kind?: string) => ({ baseUrl: `https://www.youtube.com/api/timedtext?v=abc&lang=${languageCode}&ip=0.0.0.0&expire=1900000000&fmt=srv3`, languageCode, ...(kind ? { kind } : {}) });
const player = (tracks: unknown[], status = "OK", reason?: string) => ({ playabilityStatus: { status, reason }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } });

test("caption tracks prefer uploaded English, then auto English, then anything", () => {
  assert.equal(pickCaptionTrack([track("de"), track("en", "asr"), track("en-GB")])?.languageCode, "en-GB");
  assert.equal(pickCaptionTrack([track("de"), track("en", "asr")])?.kind, "asr");
  assert.equal(pickCaptionTrack([track("de", "asr"), track("fr")])?.languageCode, "fr");
  assert.equal(pickCaptionTrack([{ languageCode: "en" }]), null);
});

test("player responses map to signed, unavailable, fallback or a signer pause", () => {
  const signed = classifyPlayerResponse(200, player([track("en")]));
  assert.equal(signed.kind, "signed");
  if (signed.kind === "signed") {
    assert.equal(new URL(signed.captionUrl).searchParams.get("fmt"), "json3");
    assert.equal(signed.expiresAt.getTime(), 1_900_000_000_000);
  }
  assert.deepEqual(classifyPlayerResponse(200, player([], "LOGIN_REQUIRED", "Sign in to confirm you’re not a bot")), { kind: "blocked", detail: "bot_check" });
  assert.equal(classifyPlayerResponse(429, null).kind, "blocked");
  assert.deepEqual(classifyPlayerResponse(200, player([])), { kind: "unavailable", detail: "no_captions" });
  assert.equal(classifyPlayerResponse(200, player([], "LOGIN_REQUIRED", "Sign in to confirm your age")).kind, "unavailable");
  assert.equal(classifyPlayerResponse(200, player([{ ...track("en"), baseUrl: `${track("en").baseUrl}&exp=xpe` }])).kind, "needs_fallback");
  assert.equal(classifyPlayerResponse(200, player([{ ...track("en"), baseUrl: "https://evil.example/api/timedtext?v=abc" }])).kind, "needs_fallback");
  assert.equal(classifyPlayerResponse(500, null).kind, "needs_fallback");
});

test("chunks hold about a minute of speech and keep their time range", () => {
  const segments: TranscriptSegment[] = Array.from({ length: 30 }, (_, index) => [index * 5_000, 5_000, `line ${index}`]);
  const chunks = chunkTranscript(segments);
  assert.equal(chunks.length, 3);
  assert.deepEqual([chunks[0]!.startMs, chunks[0]!.endMs], [0, 60_000]);
  assert.ok(chunks[0]!.content.startsWith("line 0 line 1"));
  assert.deepEqual(chunkTranscript([[0, 0, "untimed"]]), [{ content: "untimed", startMs: null, endMs: null }]);
});

test("Firecrawl transcripts parse with or without timestamps", () => {
  const timed = "# Title\n\n## Transcript\n\n[00:00] Hello there\n[01:05] Next part\n[1:00:02] Late\n\n## Comments\nignored";
  assert.deepEqual(parseFirecrawlTranscript(timed), [[0, 65_000, "Hello there"], [65_000, 3_537_000, "Next part"], [3_602_000, 0, "Late"]]);
  assert.deepEqual(parseFirecrawlTranscript("## Transcript\nplain words\nmore words"), [[0, 0, "plain words"], [0, 0, "more words"]]);
  assert.deepEqual(parseFirecrawlTranscript("# No transcript here"), []);
});

const databaseAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_WORKER_URL);

test("upkeep publishes a video's first learner download, and Firecrawl fills videos nobody delivered", { skip: databaseAvailable ? false : "DATABASE_MIGRATOR_URL and DATABASE_WORKER_URL are required" }, async () => {
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false });
  const worker = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false });
  const videos = { agreed: randomUUID(), lonely: randomUUID(), stale: randomUUID(), abandoned: randomUUID(), missing: randomUUID() };
  const users = [randomUUID(), randomUUID()];
  const segments: TranscriptSegment[] = [[0, 4_000, "If you want to learn"], [4_000, 5_000, "computer science"]];
  const realFetch = globalThis.fetch;
  const previousKey = process.env.FIRECRAWL_API_KEY;
  try {
    for (const userId of users) await migrator`INSERT INTO identity.users (id, email, email_verified, status, display_name) VALUES (${userId}, ${`${userId}@example.test`}, true, 'active', 'Transcript Test')`;
    for (const [name, id] of Object.entries(videos)) {
      await migrator`INSERT INTO catalog.resources (id, type, provider, external_id, title, visibility, status) VALUES (${id}, 'video', 'youtube', ${`yt-${id}`}, ${`Transcript ${name}`}, 'public', 'ready')`;
      await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id) VALUES (${id}, ${id.slice(0, 11)})`;
    }
    await migrator`INSERT INTO ops.transcript_requests (resource_id, youtube_id, status, caption_url, language, expires_at, attempts) VALUES (${videos.agreed}, ${videos.agreed.slice(0, 11)}, 'signed', 'https://www.youtube.com/api/timedtext?v=x', 'en', now() + interval '1 hour', 1), (${videos.lonely}, ${videos.lonely.slice(0, 11)}, 'signed', 'https://www.youtube.com/api/timedtext?v=y', 'en', now() + interval '1 hour', 1)`;
    await migrator`INSERT INTO ops.transcript_requests (resource_id, youtube_id, requested_at, updated_at) VALUES (${videos.stale}, ${videos.stale.slice(0, 11)}, now() - interval '3 minutes', now() - interval '3 minutes')`;
    // Signed, but the learner left before their browser downloaded anything.
    await migrator`INSERT INTO ops.transcript_requests (resource_id, youtube_id, status, caption_url, language, expires_at, attempts, updated_at) VALUES (${videos.abandoned}, ${videos.abandoned.slice(0, 11)}, 'signed', 'https://www.youtube.com/api/timedtext?v=z', 'en', now() + interval '1 hour', 1, now() - interval '3 minutes')`;
    // Signed, so it has captions, but Firecrawl's page has no transcript.
    await migrator`INSERT INTO ops.transcript_requests (resource_id, youtube_id, status, caption_url, language, expires_at, attempts, updated_at) VALUES (${videos.missing}, ${videos.missing.slice(0, 11)}, 'signed', 'https://www.youtube.com/api/timedtext?v=m', 'en', now() + interval '1 hour', 1, now() - interval '3 minutes')`;
    const hash = transcriptHash(segments);
    for (const userId of users) await migrator`INSERT INTO catalog.transcript_submissions (resource_id, user_id, language, content_sha256, segments) VALUES (${videos.agreed}, ${userId}, 'en', ${hash}, ${migrator.json(segments)})`;
    await migrator`INSERT INTO catalog.transcript_submissions (resource_id, user_id, language, content_sha256, segments) VALUES (${videos.lonely}, ${users[0]!}, 'en', ${hash}, ${migrator.json(segments)})`;

    const firecrawlCalls: string[] = [];
    globalThis.fetch = (async (_input: string, init: RequestInit) => {
      const { url } = JSON.parse(String(init.body)) as { url: string };
      firecrawlCalls.push(url);
      const markdown = url.endsWith(videos.missing.slice(0, 11)) ? "# A video page\nNo transcript panel" : "## Transcript\n[00:00] From Firecrawl\n[00:30] Second line";
      return new Response(JSON.stringify({ success: true, data: { markdown } }));
    }) as typeof fetch;
    process.env.FIRECRAWL_API_KEY = "test-key";
    const result = await transcriptUpkeep(worker);

    assert.equal(result.published, 2);
    assert.ok(result.firecrawl >= 2);
    assert.ok(firecrawlCalls.includes(`https://www.youtube.com/watch?v=${videos.stale.slice(0, 11)}`));
    assert.ok(firecrawlCalls.includes(`https://www.youtube.com/watch?v=${videos.abandoned.slice(0, 11)}`));
    // Each waiting video is claimed once, so the signer and housekeeping never pay for it twice.
    assert.equal(new Set(firecrawlCalls).size, firecrawlCalls.length);
    assert.equal(await firecrawlNext(worker, "test-key", "20 seconds"), null);
    const state = await migrator<{ id: string; status: string; version: string | null; chunks: number; submissions: number }[]>`
      SELECT r.id, q.status, r.current_version_id AS version,
        (SELECT count(*)::int FROM retrieval.resource_chunks c WHERE c.resource_version_id = r.current_version_id AND c.chunk_type = 'transcript') AS chunks,
        (SELECT count(*)::int FROM catalog.transcript_submissions s WHERE s.resource_id = r.id) AS submissions
      FROM catalog.resources r JOIN ops.transcript_requests q ON q.resource_id = r.id WHERE r.id = ANY(${Object.values(videos)}::uuid[])`;
    const byId = new Map(state.map((row) => [row.id, row]));
    // The first copy is shared; its row stays, emptied, as the record of who supplied it.
    assert.deepEqual([byId.get(videos.agreed)!.status, byId.get(videos.agreed)!.chunks, byId.get(videos.agreed)!.submissions], ["ready", 1, 1]);
    assert.deepEqual([byId.get(videos.lonely)!.status, byId.get(videos.lonely)!.chunks, byId.get(videos.lonely)!.submissions], ["ready", 1, 1]);
    const [kept] = await migrator<{ user_id: string; segments: unknown[] }[]>`SELECT user_id, segments FROM catalog.transcript_submissions WHERE resource_id = ${videos.agreed}`;
    assert.deepEqual(kept, { user_id: users[0]!, segments: [] });
    assert.equal(byId.get(videos.abandoned)!.status, "ready");
    // A miss leaves a captioned video open for a learner's download, and Firecrawl is not paid for it again.
    assert.equal(byId.get(videos.missing)!.status, "signed");
    assert.equal(firecrawlCalls.filter((url) => url.endsWith(videos.missing.slice(0, 11))).length, 1);
    assert.deepEqual([byId.get(videos.stale)!.status, byId.get(videos.stale)!.chunks], ["ready", 1]);
    const [chunk] = await migrator<{ start_ms: number; end_ms: number; content: string }[]>`SELECT start_ms, end_ms, content FROM retrieval.resource_chunks WHERE resource_version_id = ${byId.get(videos.stale)!.version}`;
    assert.deepEqual(chunk, { start_ms: 0, end_ms: 30_000, content: "From Firecrawl Second line" });
  } finally {
    globalThis.fetch = realFetch;
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = previousKey;
    const ids = Object.values(videos);
    await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id IN (SELECT id FROM catalog.resource_versions WHERE resource_id = ANY(${ids}::uuid[]))`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ANY(${ids}::uuid[])`;
    await migrator`DELETE FROM catalog.resource_versions WHERE resource_id = ANY(${ids}::uuid[])`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ANY(${ids}::uuid[])`;
    await migrator`DELETE FROM catalog.resources WHERE id = ANY(${ids}::uuid[])`;
    await migrator`DELETE FROM identity.users WHERE id = ANY(${users}::uuid[])`;
    await Promise.all([migrator.end(), worker.end()]);
  }
});

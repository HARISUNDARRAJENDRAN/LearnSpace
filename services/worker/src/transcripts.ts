import { createHash } from "node:crypto";
import type postgres from "postgres";
import { normalizeSegments, type TranscriptSegment } from "@learnspace/shared/transcripts";
import { TRANSCRIPT_EMBEDDING_PROFILE } from "@learnspace/shared/tutor";
import type { EmbeddingProvider } from "./embeddings.js";

type SqlClient = ReturnType<typeof postgres>;
type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

// The Android app's player answers without a proof-of-origin token; bump the version if YouTube starts refusing it.
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" };
const ANDROID_USER_AGENT = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
// Housekeeping's fallback for when the home signer is off; the signer itself hands videos to Firecrawl far sooner.
const FIRECRAWL_AFTER = "2 minutes";

export type SignOutcome =
  | { kind: "signed"; captionUrl: string; language: string; expiresAt: Date }
  | { kind: "unavailable" | "needs_fallback" | "blocked"; detail: string };

/** English first, uploaded captions before auto-generated ones; otherwise the first track YouTube lists. */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const usable = tracks.filter((track) => track.baseUrl && track.languageCode);
  const english = (track: CaptionTrack) => track.languageCode!.toLowerCase().startsWith("en");
  return usable.find((track) => english(track) && track.kind !== "asr") ?? usable.find(english) ?? usable.find((track) => track.kind !== "asr") ?? usable[0] ?? null;
}

/** Reads a player response into what the signer should record. Only a bot check or rate limit means "stop asking". */
export function classifyPlayerResponse(httpStatus: number, body: unknown): SignOutcome {
  if (httpStatus === 429 || httpStatus === 403) return { kind: "blocked", detail: `http_${httpStatus}` };
  if (httpStatus !== 200) return { kind: "needs_fallback", detail: `http_${httpStatus}` };
  const response = body as { playabilityStatus?: { status?: string; reason?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } } | null;
  const playability = response?.playabilityStatus;
  if (playability?.status === "LOGIN_REQUIRED" && /bot/i.test(playability.reason ?? "")) return { kind: "blocked", detail: "bot_check" };
  if (playability?.status !== "OK") return { kind: "unavailable", detail: (playability?.reason ?? playability?.status ?? "unplayable").slice(0, 200) };
  const track = pickCaptionTrack(response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
  if (!track) return { kind: "unavailable", detail: "no_captions" };
  const url = new URL(track.baseUrl!);
  // A proof-of-origin token would be needed to download this track, which a browser cannot mint for us.
  if (url.searchParams.get("exp") === "xpe") return { kind: "needs_fallback", detail: "po_token" };
  if (url.origin !== "https://www.youtube.com" || url.pathname !== "/api/timedtext") return { kind: "needs_fallback", detail: "unexpected_caption_url" };
  url.searchParams.set("fmt", "json3");
  const expire = Number(url.searchParams.get("expire"));
  const expiresAt = Number.isFinite(expire) && expire > 0 ? new Date(expire * 1000) : new Date(Date.now() + 3_600_000);
  return { kind: "signed", captionUrl: url.toString(), language: track.languageCode!, expiresAt };
}

/** One anonymous player request: no cookies or account, so only the calling IP is ever at stake. */
export async function signCaptions(youtubeId: string): Promise<SignOutcome> {
  try {
    const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ANDROID_USER_AGENT },
      body: JSON.stringify({ context: { client: ANDROID_CLIENT }, videoId: youtubeId, contentCheckOk: true, racyCheckOk: true }),
      signal: AbortSignal.timeout(15_000),
    });
    return classifyPlayerResponse(response.status, response.ok ? await response.json() : null);
  } catch (error) {
    return { kind: "needs_fallback", detail: error instanceof Error ? error.message.slice(0, 200) : "request failed" };
  }
}

export function transcriptHash(segments: TranscriptSegment[]): string {
  return createHash("sha256").update(JSON.stringify(segments)).digest("hex");
}

export type TranscriptChunk = { content: string; startMs: number | null; endMs: number | null };

/** About a minute of speech per chunk, so a question at any moment of the video maps to one or two chunks. */
export function chunkTranscript(segments: TranscriptSegment[]): TranscriptChunk[] {
  const timed = segments.some(([startMs, durationMs]) => startMs > 0 || durationMs > 0);
  const chunks: TranscriptChunk[] = [];
  let lines: string[] = [];
  let first: TranscriptSegment | null = null;
  let endMs = 0;
  const flush = () => {
    if (first) chunks.push({ content: lines.join(" "), startMs: timed ? first[0] : null, endMs: timed ? Math.max(endMs, first[0]) : null });
    lines = [];
    first = null;
  };
  for (const segment of segments) {
    first ??= segment;
    lines.push(segment[2]);
    endMs = Math.max(endMs, segment[0] + segment[1]);
    const length = lines.reduce((total, line) => total + line.length + 1, 0);
    if ((timed && endMs - first[0] >= 60_000) || length >= 1_500) flush();
  }
  flush();
  return chunks;
}

const timestamp = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\.\d+)?[\])]?\s*[-–:]?\s*(.+)$/;
const toMs = (clock: string) => clock.split(":").reduce((total, part) => total * 60 + Number(part), 0) * 1000;

/** Firecrawl returns the transcript as a "## Transcript" markdown section, with or without timestamps per line. */
export function parseFirecrawlTranscript(markdown: string): TranscriptSegment[] {
  const section = markdown.split(/^##\s+Transcript\s*$/m)[1]?.split(/^##\s/m)[0] ?? "";
  const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  const stamped = lines.map((line) => timestamp.exec(line));
  if (lines.length && stamped.every(Boolean)) {
    return normalizeSegments(stamped.map((match, index) => {
      const startMs = toMs(match![1]!);
      const next = stamped[index + 1];
      return [startMs, next ? Math.max(0, toMs(next[1]!) - startMs) : 0, match![2]!] as TranscriptSegment;
    }));
  }
  return normalizeSegments(lines.map((line) => [0, 0, line] as TranscriptSegment));
}

async function firecrawlTranscript(youtubeId: string, apiKey: string): Promise<TranscriptSegment[] | null> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    // A cached render (Firecrawl keeps pages for two days by default) can lack the transcript panel; fresh ones have it.
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${youtubeId}`, formats: ["markdown"], location: { languages: ["en"] }, maxAge: 0 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Firecrawl HTTP ${response.status}`);
  const body = await response.json() as { success?: boolean; data?: { markdown?: string } };
  const segments = parseFirecrawlTranscript(body.data?.markdown ?? "");
  return segments.length ? segments : null;
}

/**
 * Stores a transcript as the video's current version with timed chunks, and closes its request. A learner's published
 * download keeps its row, emptied, as the record of who supplied it; other downloads are dropped.
 */
export async function publishTranscript(sql: SqlClient, resourceId: string, language: string, segments: TranscriptSegment[], source: string, submittedBy: string | null = null): Promise<string> {
  const hash = transcriptHash(segments);
  return sql.begin(async (tx) => {
    // The signer and worker housekeeping both publish; one video's versions are written one at a time.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${resourceId}))`;
    const [existing] = await tx<{ id: string }[]>`SELECT id FROM catalog.resource_versions WHERE resource_id = ${resourceId} AND source_sha256 = ${hash}`;
    let versionId = existing?.id;
    if (!versionId) {
      const [{ next } = { next: 1 }] = await tx<{ next: number }[]>`SELECT coalesce(max(version_no), 0)::int + 1 AS next FROM catalog.resource_versions WHERE resource_id = ${resourceId}`;
      // The transcript lives in its chunks; there is no separate raw file, so the key only names the source.
      const [version] = await tx<{ id: string }[]>`
        INSERT INTO catalog.resource_versions (resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, byte_size, parser_name, parser_version, processing_status, fetched_at, ready_at)
        VALUES (${resourceId}, ${next}, ${hash}, ${hash}, ${`transcripts/${resourceId}/${hash}`}, 'application/json', ${JSON.stringify(segments).length}, ${source}, '1', 'ready', now(), now())
        RETURNING id`;
      versionId = version!.id;
      const rows = chunkTranscript(segments).map((chunk, ordinal) => ({
        resource_version_id: versionId!, ordinal, chunk_type: "transcript", content: chunk.content,
        content_sha256: createHash("sha256").update(chunk.content).digest("hex"), token_count: Math.max(1, Math.ceil(chunk.content.length / 4)),
        language, start_ms: chunk.startMs, end_ms: chunk.endMs,
      }));
      for (let index = 0; index < rows.length; index += 500) await tx`INSERT INTO retrieval.resource_chunks ${tx(rows.slice(index, index + 500))}`;
    }
    await tx`UPDATE catalog.resources SET current_version_id = ${versionId}, updated_at = now() WHERE id = ${resourceId}`;
    await tx`UPDATE ops.transcript_requests SET status = 'ready', caption_url = NULL, detail = ${source}, updated_at = now() WHERE resource_id = ${resourceId}`;
    await tx`DELETE FROM catalog.transcript_submissions WHERE resource_id = ${resourceId} AND user_id IS DISTINCT FROM ${submittedBy}`;
    if (submittedBy) await tx`UPDATE catalog.transcript_submissions SET segments = '[]'::jsonb WHERE resource_id = ${resourceId} AND user_id = ${submittedBy}`;
    return versionId;
  });
}

/** Embeds current transcript chunks that have no embedding yet, so the tutor can retrieve by meaning as well as by words. */
export async function embedTranscriptChunks(sql: SqlClient, provider: EmbeddingProvider | null, limit = 300, versionIds: string[] | null = null): Promise<number> {
  if (!provider) return 0;
  const rows = await sql<{ id: string; content: string }[]>`
    SELECT c.id, c.content FROM retrieval.resource_chunks c
    JOIN catalog.resources r ON r.current_version_id = c.resource_version_id
    WHERE c.chunk_type = 'transcript' ${versionIds ? sql`AND c.resource_version_id = ANY(${versionIds}::uuid[])` : sql``}
      AND NOT EXISTS (SELECT 1 FROM retrieval.chunk_embeddings e WHERE e.chunk_id = c.id AND e.embedding_profile_id = ${TRANSCRIPT_EMBEDDING_PROFILE})
    ORDER BY c.resource_version_id, c.ordinal LIMIT ${limit}`;
  let embedded = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const vectors = await provider.embedDocuments(batch.map((row) => row.content));
    const values = batch.map((row, position) => ({ chunk_id: row.id, embedding_profile_id: TRANSCRIPT_EMBEDDING_PROFILE, embedding: JSON.stringify(vectors[position]) }));
    await sql`INSERT INTO retrieval.chunk_embeddings ${sql(values)} ON CONFLICT DO NOTHING`;
    embedded += batch.length;
  }
  return embedded;
}

/**
 * Publishes the first learner download of each video still waiting for one. The download came from a URL the signer
 * handed out and passed the app's checks; its row records who sent it, so a bad copy can be traced and removed.
 */
export async function publishSubmissions(sql: SqlClient): Promise<string[]> {
  const pending = await sql<{ resource_id: string; user_id: string; language: string; segments: TranscriptSegment[] }[]>`
    SELECT DISTINCT ON (s.resource_id) s.resource_id, s.user_id, s.language, s.segments
    FROM catalog.transcript_submissions s JOIN ops.transcript_requests q ON q.resource_id = s.resource_id
    WHERE q.status = 'signed' ORDER BY s.resource_id, s.created_at LIMIT 10`;
  const versions: string[] = [];
  for (const row of pending) versions.push(await publishTranscript(sql, row.resource_id, row.language, row.segments, "learner-captions", row.user_id));
  return versions;
}

/**
 * Claims the oldest video nobody delivered and fills it from Firecrawl, which fetches from its own servers, not ours.
 * Waiting means the signer could not sign it, or no learner's copy arrived `after` it was signed or queued. The claim
 * keeps the signer and housekeeping from paying for one video twice; null when nothing is waiting.
 */
export async function firecrawlNext(sql: SqlClient, apiKey: string, after: string): Promise<{ youtubeId: string; found: boolean; versionId: string | null } | null> {
  const [row] = await sql<{ resource_id: string; youtube_id: string }[]>`
    UPDATE ops.transcript_requests SET detail = 'firecrawl', updated_at = now()
    WHERE resource_id = (
      SELECT resource_id FROM ops.transcript_requests
      WHERE detail IS DISTINCT FROM 'firecrawl_no_transcript' AND (
        (status = 'queued' AND attempts > 0 AND detail IS DISTINCT FROM 'firecrawl')
        OR (status IN ('queued', 'signed') AND updated_at < now() - ${after}::interval))
      ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING resource_id, youtube_id`;
  if (!row) return null;
  const segments = await firecrawlTranscript(row.youtube_id, apiKey);
  if (!segments) {
    // A signed video has captions, so a learner's download can still deliver it; Firecrawl is not asked again either way.
    await sql`UPDATE ops.transcript_requests SET status = CASE WHEN status = 'signed' THEN 'signed' ELSE 'failed' END, detail = 'firecrawl_no_transcript', updated_at = now() WHERE resource_id = ${row.resource_id} AND status <> 'ready'`;
    return { youtubeId: row.youtube_id, found: false, versionId: null };
  }
  // A learner's download may have landed meanwhile; it has exact timestamps, so it stays.
  const [open] = await sql`SELECT 1 FROM ops.transcript_requests WHERE resource_id = ${row.resource_id} AND status <> 'ready'`;
  const versionId = open ? await publishTranscript(sql, row.resource_id, "en", segments, "firecrawl") : null;
  return { youtubeId: row.youtube_id, found: true, versionId };
}

/** Housekeeping: publish learners' downloads the signer has not, fall back to Firecrawl for videos nobody delivered, then embed. */
export async function transcriptUpkeep(sql: SqlClient, provider: EmbeddingProvider | null = null): Promise<{ published: number; firecrawl: number; failed: number; embedded: number }> {
  const result = { published: 0, firecrawl: 0, failed: 0, embedded: 0 };
  result.published = (await publishSubmissions(sql)).length;
  // Tutor answers cached for a transcript that has since been replaced can never be served again.
  await sql`DELETE FROM retrieval.answer_cache a USING catalog.resource_versions v JOIN catalog.resources r ON r.id = v.resource_id
    WHERE a.resource_version_id = v.id AND r.current_version_id IS DISTINCT FROM v.id`;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  // A few per run: credits are scarce.
  for (let index = 0; apiKey && index < 3; index += 1) {
    let rescued: Awaited<ReturnType<typeof firecrawlNext>>;
    try {
      rescued = await firecrawlNext(sql, apiKey, FIRECRAWL_AFTER);
    } catch (error) {
      // Out of credits or Firecrawl down: the claim lapses and a later run tries again.
      console.warn(JSON.stringify({ metric: "transcript_firecrawl_failure", error: error instanceof Error ? error.message : "firecrawl failed" }));
      break;
    }
    if (!rescued) break;
    if (rescued.found) result.firecrawl += 1; else result.failed += 1;
  }
  result.embedded = await embedTranscriptChunks(sql, provider).catch((error) => {
    console.warn(JSON.stringify({ metric: "transcript_embedding_failure", error: error instanceof Error ? error.message : "embedding failed" }));
    return 0;
  });
  return result;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { parseChannelItem, parseIsoDuration, parseVideoItem, refreshYoutubeMetrics, youtubeGate } from "./youtube-metrics.js";

test("ISO 8601 durations parse to milliseconds", () => {
  assert.equal(parseIsoDuration("PT1H2M3S"), 3_723_000);
  assert.equal(parseIsoDuration("PT45S"), 45_000);
  assert.equal(parseIsoDuration("P1DT2H"), 93_600_000);
  assert.equal(parseIsoDuration("PT0S"), 0);
  assert.equal(parseIsoDuration("P0D"), 0);
  for (const invalid of ["", "P", "PT", "1H", "PT1X", null, 60]) assert.equal(parseIsoDuration(invalid), null);
});

const playable = { durationMs: 600_000, embeddable: true, liveBroadcastContent: "none", privacyStatus: "public", ageRestricted: false };

test("gates reject videos that cannot be watched in the app", () => {
  assert.equal(youtubeGate(playable, 60_000), null);
  assert.equal(youtubeGate({ ...playable, privacyStatus: "unlisted" }, 60_000), null);
  assert.equal(youtubeGate({ ...playable, durationMs: null }, 60_000), null);
  assert.equal(youtubeGate({ ...playable, durationMs: 60_000 }, 60_000), "short");
  assert.equal(youtubeGate({ ...playable, durationMs: 0, liveBroadcastContent: "upcoming" }, 60_000), "live");
  assert.equal(youtubeGate({ ...playable, embeddable: false }, 60_000), "not_embeddable");
  assert.equal(youtubeGate({ ...playable, ageRestricted: true }, 60_000), "age_restricted");
  assert.equal(youtubeGate({ ...playable, privacyStatus: "private" }, 60_000), "unavailable");
  assert.equal(youtubeGate({ ...playable, privacyStatus: null }, 60_000), "unavailable");
});

test("video items keep hidden counts null and mark failed uploads unavailable", () => {
  const video = parseVideoItem({
    id: "abcdefghijk",
    snippet: { publishedAt: "2026-01-01T00:00:00Z", channelId: "UC1", channelTitle: "Teacher", liveBroadcastContent: "none" },
    contentDetails: { duration: "PT12M", caption: "true", contentRating: { ytRating: "ytAgeRestricted" } },
    statistics: { viewCount: "1200", commentCount: "4" },
    status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true },
  })!;
  assert.equal(video.durationMs, 720_000);
  assert.equal(video.viewCount, 1200);
  assert.equal(video.likeCount, null);
  assert.equal(video.ageRestricted, true);
  assert.equal(parseVideoItem({ id: "abcdefghijk", status: { privacyStatus: "public", uploadStatus: "rejected" } })!.privacyStatus, "unavailable");
  assert.equal(parseVideoItem({ snippet: {} }), null);
});

test("channel items hide subscriber counts when YouTube hides them", () => {
  assert.deepEqual(parseChannelItem({ id: "UC1", statistics: { viewCount: "10", subscriberCount: "100", hiddenSubscriberCount: true, videoCount: "2" } }),
    { channelId: "UC1", subscriberCount: null, viewCount: 10, videoCount: 2 });
});

const databaseAvailable = Boolean(process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_WORKER_URL);

test("refresh enriches, gates and rescores videos within the daily quota cap", { skip: databaseAvailable ? false : "DATABASE_MIGRATOR_URL and DATABASE_WORKER_URL are required" }, async () => {
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false });
  const worker = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false });
  const ids = { good: randomUUID(), short: randomUUID(), gone: randomUUID() };
  const youtubeIds = { good: randomUUID().slice(0, 11), short: randomUUID().slice(0, 11), gone: randomUUID().slice(0, 11) };
  const channelId = `UC${randomUUID()}`;
  const requests: URL[] = [];
  const realFetch = globalThis.fetch;
  const previous = { key: process.env.YOUTUBE_API_KEY, cap: process.env.YOUTUBE_DAILY_QUOTA_CAP };
  const usage = async () => Number((await migrator<{ units: string }[]>`SELECT units FROM ops.api_usage_daily WHERE provider = 'youtube' AND usage_date = (now() AT TIME ZONE 'America/Los_Angeles')::date`)[0]?.units ?? 0);
  const before = await usage();
  globalThis.fetch = (async (input: URL) => {
    requests.push(input);
    const items = input.pathname.endsWith("/videos")
      ? [
          { id: youtubeIds.good, snippet: { publishedAt: "2026-06-01T00:00:00Z", channelId, channelTitle: "Teacher", description: "A full lesson on gradient descent.", tags: ["machine learning", 3], liveBroadcastContent: "none" }, contentDetails: { duration: "PT20M", caption: "true" }, statistics: { viewCount: "50000", likeCount: "2500", commentCount: "100" }, status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true } },
          { id: youtubeIds.short, snippet: { publishedAt: "2026-06-01T00:00:00Z", channelId, liveBroadcastContent: "none" }, contentDetails: { duration: "PT45S" }, statistics: { viewCount: "900" }, status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true } },
        ]
      : [{ id: channelId, statistics: { viewCount: "1000000", subscriberCount: "20000", videoCount: "100" } }];
    return new Response(JSON.stringify({ items }));
  }) as typeof fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  try {
    for (const name of ["good", "short", "gone"] as const) {
      await migrator`INSERT INTO catalog.resources (id, type, provider, external_id, title, visibility, status) VALUES (${ids[name]}, 'video', 'youtube', ${youtubeIds[name]}, ${`Metrics ${name}`}, 'public', 'ready')`;
      await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id) VALUES (${ids[name]}, ${youtubeIds[name]})`;
    }
    const result = await refreshYoutubeMetrics(worker, Object.values(ids));
    assert.deepEqual({ ...result, error: result.error }, { videos: 3, channels: 1, gated: 2, quotaUnits: 2, quotaCapped: false, error: null });
    assert.equal(requests[0]!.searchParams.get("id")!.split(",").length, 3);
    assert.ok(requests[0]!.searchParams.get("fields"));
    assert.equal(await usage(), before + 2);
    const rows = await migrator<{ id: string; status: string; gate: string | null; quality_score: number; duration_ms: number | null; latest_like_count: string | null; description: string | null; tags: string[] | null }[]>`
      SELECT r.id, r.status, r.metadata->>'youtubeGate' AS gate, r.quality_score, vd.duration_ms, vd.latest_like_count, r.description, r.metadata->'youtubeTags' AS tags
      FROM catalog.resources r JOIN catalog.video_details vd ON vd.resource_id = r.id WHERE r.id = ANY(${Object.values(ids)}::uuid[])`;
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.deepEqual([byId.get(ids.good)!.status, byId.get(ids.good)!.gate, byId.get(ids.good)!.duration_ms], ["ready", null, 1_200_000]);
    assert.deepEqual([byId.get(ids.good)!.description, byId.get(ids.good)!.tags], ["A full lesson on gradient descent.", ["machine learning"]]);
    assert.deepEqual([byId.get(ids.short)!.description, byId.get(ids.short)!.tags], [null, null]);
    assert.deepEqual([byId.get(ids.short)!.status, byId.get(ids.short)!.gate, byId.get(ids.short)!.latest_like_count], ["archived", "short", null]);
    assert.deepEqual([byId.get(ids.gone)!.status, byId.get(ids.gone)!.gate], ["archived", "unavailable"]);
    assert.notEqual(byId.get(ids.good)!.quality_score, byId.get(ids.short)!.quality_score);

    // Fresh metrics are skipped; stale ones stop at the cap without failing.
    assert.equal((await refreshYoutubeMetrics(worker, Object.values(ids))).quotaUnits, 0);
    await migrator`UPDATE catalog.video_details SET metrics_captured_at = NULL WHERE resource_id = ${ids.good}`;
    process.env.YOUTUBE_DAILY_QUOTA_CAP = "1";
    const capped = await refreshYoutubeMetrics(worker, [ids.good]);
    assert.deepEqual([capped.quotaCapped, capped.quotaUnits, capped.videos], [true, 0, 0]);
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of [["YOUTUBE_API_KEY", previous.key], ["YOUTUBE_DAILY_QUOTA_CAP", previous.cap]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ANY(${Object.values(ids)}::uuid[])`;
    await migrator`DELETE FROM catalog.resources WHERE id = ANY(${Object.values(ids)}::uuid[])`;
    await migrator`DELETE FROM catalog.youtube_channels WHERE channel_id = ${channelId}`;
    await migrator`UPDATE ops.api_usage_daily SET units = ${before} WHERE provider = 'youtube' AND usage_date = (now() AT TIME ZONE 'America/Los_Angeles')::date`;
    await Promise.all([migrator.end(), worker.end()]);
  }
});

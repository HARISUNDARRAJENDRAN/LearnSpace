import assert from "node:assert/strict";
import test from "node:test";
import { gatherVideos, isoDurationMs, pickVideos, provisionalPicks, searchPhrasings } from "../lib/source-discovery/video-agent";

const id = (name: string) => name.padEnd(11, "x").slice(0, 11);
/** Named 11-character video ids, so a test reads `v.shared` rather than an index into a list. */
function ids<const T extends string>(...names: T[]): Record<T, string> {
  return Object.fromEntries(names.map((name) => [name, id(name)])) as Record<T, string>;
}

type Calls = { exa: string[]; youtubeSearch: number; youtubeVideos: string[][]; openai: unknown[] };

/** Stands in for Exa, the YouTube Data API and OpenAI, recording what each was asked. */
function providers(options: { exa?: Record<string, string[]> | "fail"; youtubeSearch?: string[]; details?: Record<string, { duration: string; views?: number; likes?: number; embeddable?: boolean; title?: string; live?: string }>; picks?: Array<{ id: string; why: string }> }) {
  const calls: Calls = { exa: [], youtubeSearch: 0, youtubeVideos: [], openai: [] };
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.exa.ai") {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      calls.exa.push(query);
      if (options.exa === "fail") return new Response("{}", { status: 500 });
      const ids = options.exa?.[query] ?? options.exa?.["*"] ?? [];
      return Response.json({ results: ids.map((video) => ({ url: `https://www.youtube.com/watch?v=${video}`, title: `${video} - YouTube`, author: "Exa Channel" })) });
    }
    if (url.pathname.endsWith("/youtube/v3/search")) {
      calls.youtubeSearch += 1;
      return Response.json({ items: (options.youtubeSearch ?? []).map((video) => ({ id: { videoId: video }, snippet: { title: `Search ${video}`, channelTitle: "YT Channel" } })) });
    }
    if (url.pathname.endsWith("/youtube/v3/videos")) {
      const ids = url.searchParams.get("id")?.split(",") ?? [];
      calls.youtubeVideos.push(ids);
      return Response.json({ items: ids.flatMap((video) => {
        const detail = options.details?.[video];
        return detail ? [{ id: video, snippet: { title: detail.title ?? `Title ${video}`, channelTitle: `Channel ${video}`, description: "A lesson.", publishedAt: "2024-01-01T00:00:00Z", liveBroadcastContent: detail.live ?? "none" }, contentDetails: { duration: detail.duration }, statistics: { viewCount: String(detail.views ?? 1000), likeCount: String(detail.likes ?? 50) }, status: { embeddable: detail.embeddable ?? true, privacyStatus: "public" } }] : [];
      }) });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      calls.openai.push(body);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ picks: (options.picks ?? []).map((pick) => ({ ...pick, level: "beginner", format: "course" })) }) } }] });
    }
    throw new Error(`unexpected fetch ${url.hostname}${url.pathname}`);
  }) as typeof fetch;
  return { calls, fake };
}

test("searches are spread over phrasings without repeating what the query already says", () => {
  assert.deepEqual(searchPhrasings("rust for beginners", "beginner_friendly"), ["rust for beginners", "rust for beginners full course", "rust for beginners introduction explained simply"]);
  assert.deepEqual(searchPhrasings("fourier transform", "in_depth"), ["fourier transform", "fourier transform in-depth lecture", "fourier transform advanced deep dive explained"]);
  assert.equal(isoDurationMs("PT1H2M3S"), 3_723_000);
  assert.equal(isoDurationMs("P1DT1M"), 86_460_000);
  assert.equal(isoDurationMs("nonsense"), null);
});

test("gathering merges every lane, ranks agreement first and drops videos the app can't use", async () => {
  const v = ids("shared", "exaonly", "ytonly", "short", "blocked", "live", "gone", "tagged");
  const { calls, fake } = providers({
    exa: { "*": [v.exaonly, v.shared, v.short, v.gone, v.tagged] },
    youtubeSearch: [v.shared, v.ytonly, v.blocked, v.live],
    details: {
      [v.shared]: { duration: "PT40M", views: 2_000_000 },
      [v.exaonly]: { duration: "PT12M", views: 3_000 },
      [v.ytonly]: { duration: "PT1H", views: 50_000 },
      [v.short]: { duration: "PT59S" },
      [v.blocked]: { duration: "PT20M", embeddable: false },
      [v.live]: { duration: "PT0S", live: "live" },
      [v.tagged]: { duration: "PT10M", title: "Quick tip #shorts" },
    },
  });
  const spent: number[] = [];
  const result = await gatherVideos("graph theory", "best_match", { exaApiKey: "exa", youtubeApiKey: "yt", reserveYoutubeQuota: async (units) => { spent.push(units); return true; }, fetch: fake });
  assert.equal(calls.exa.length, 3);
  assert.equal(calls.youtubeSearch, 1);
  // One videos.list call checks every distinct hit; search costs 100 units, the check 1.
  assert.equal(calls.youtubeVideos.length, 1);
  assert.deepEqual(spent, [100, 1]);
  assert.deepEqual(result.videos.map((video) => video.youtubeId), [v.shared, v.exaonly, v.ytonly]);
  assert.equal(result.videos[0]?.lanes.length, 4);
  assert.equal(result.videos[0]?.durationMs, 40 * 60_000);
  assert.deepEqual(result.failures, []);
  // The first answer's reasons come from the video's own details.
  assert.match(provisionalPicks(result.videos)[0]?.why ?? "", /2M views · Top result across searches/);
});

test("with the YouTube quota spent the agent still answers from Exa alone, and a total outage is reported", async () => {
  const v = ids("first", "second");
  const { calls, fake } = providers({ exa: { "*": [v.first, v.second] } });
  const result = await gatherVideos("graph theory", "practical", { exaApiKey: "exa", youtubeApiKey: "yt", reserveYoutubeQuota: async () => false, fetch: fake });
  assert.equal(calls.youtubeSearch, 0);
  assert.equal(calls.youtubeVideos.length, 0);
  assert.deepEqual(result.videos.map((video) => video.youtubeId), [v.first, v.second]);
  // Unchecked, a video keeps Exa's title without YouTube's page suffix.
  assert.equal(result.videos[0]?.title, v.first);

  const outage = providers({ exa: "fail" });
  const failed = await gatherVideos("graph theory", "best_match", { exaApiKey: "exa", youtubeApiKey: null, reserveYoutubeQuota: async () => true, fetch: outage.fake });
  assert.equal(failed.videos.length, 0);
  assert.equal(failed.failures.length, 3);
});

test("the model's pick keeps its order and reasons, ignores ids it wasn't shown, and its prompt is valid JSON", async () => {
  const v = ids("one", "two", "three", "four");
  const all = [v.one, v.two, v.three, v.four];
  const { fake } = providers({ exa: { "*": all }, details: Object.fromEntries(all.map((video, index) => [video, { duration: "PT30M", views: 1000 * (index + 1), ...(index === 0 ? { title: `Rust 🦀${"x".repeat(400)}` } : {}) }])) });
  const pool = (await gatherVideos("rust", "best_match", { exaApiKey: "exa", youtubeApiKey: "yt", reserveYoutubeQuota: async () => true, fetch: fake })).videos;
  // The description cut can land inside an emoji; the request must still be well-formed.
  const head = pool[0];
  assert.ok(head);
  pool[0] = { ...head, description: `${"a".repeat(279)}🦀 more` };
  const previous = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  const model = providers({ picks: [{ id: v.three, why: "Builds a CLI step by step" }, { id: id("invented"), why: "Not in the list" }, { id: v.one, why: "Complete course" }, { id: v.two, why: "Clear explainer" }] });
  globalThis.fetch = model.fake;
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.OPENAI_BASE_URL = "https://openai.test/v1";
  try {
    const picks = await pickVideos("rust", "best_match", pool);
    assert.deepEqual(picks?.map((video) => video.youtubeId), [v.three, v.one, v.two]);
    assert.equal(picks?.[0]?.why, "Builds a CLI step by step");
    assert.equal(picks?.[0]?.format, "course");
    const user = (model.calls.openai[0] as { messages: Array<{ content: string }> }).messages[1]?.content ?? "";
    assert.ok(user.isWellFormed());

    // A model that keeps almost nothing is overruled by the statistical order.
    const sparse = providers({ picks: [{ id: v.one, why: "Only one" }] });
    globalThis.fetch = sparse.fake;
    assert.equal(await pickVideos("rust", "best_match", pool), null);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
    if (previous.base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previous.base;
  }
});

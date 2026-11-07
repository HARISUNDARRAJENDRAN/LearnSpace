import assert from "node:assert/strict";
import test from "node:test";
import { canonicalArxivUrl, discoverCandidates, instantDiscovery, parseArxivFeed, youtubeIdFromUrl } from "./exa-discovery.js";

type Call = { url: string; body: Record<string, unknown> | null };

/** A fake fetch that records Exa requests and answers each with the next queued response. */
function fakeFetch(responses: (Record<string, unknown>[] | number)[], arxivFeed = "<feed></feed>") {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://export.arxiv.org/")) {
      calls.push({ url, body: null });
      return new Response(arxivFeed);
    }
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift() ?? [];
    return typeof next === "number" ? new Response("{}", { status: next }) : new Response(JSON.stringify({ results: next }));
  }) as typeof fetch;
  return { calls, options: { exaApiKey: "test-key", fetch: fetcher } };
}

const video = (id: string, title = `Lesson ${id}`) => ({ url: `https://www.youtube.com/watch?v=${id}`, title, author: "Teacher", publishedDate: "2026-09-01T00:00:00.000Z", highlights: ["A clear walkthrough."] });

test("YouTube links resolve to an id only from YouTube hosts", () => {
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  for (const url of [
    "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:443/watch?v=dQw4w9WgXcQ",
    "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
  ]) assert.equal(youtubeIdFromUrl(url), null, url);
});

test("arXiv document links normalize to one version-independent abstract URL", () => {
  for (const path of ["abs/1706.03762", "abs/1706.03762v5", "pdf/1706.03762v5.pdf", "pdf/1706.03762", "html/1706.03762v5"]) {
    assert.equal(canonicalArxivUrl(`https://arxiv.org/${path}`), "https://arxiv.org/abs/1706.03762", path);
  }
  for (const url of [
    "https://arxiv.org.evil.example/pdf/1706.03762",
    "http://arxiv.org/pdf/1706.03762",
    "https://arxiv.org:443/pdf/1706.03762",
    "https://user@arxiv.org/pdf/1706.03762",
    "https://arxiv.org/pdf/not-a-paper",
    "https://arxiv.org/pdf/1706.03762?redirect=evil",
    "https://arxiv.org/other/1706.03762",
    "https://arxiv.org:invalid/pdf/1706.03762",
    "https://arxiv.org/pdf/1706.03762#other",
  ]) assert.equal(canonicalArxivUrl(url), null, url);
});

test("a video lane makes one neural search with the lane's wording and keeps only YouTube videos", async () => {
  const { calls, options } = fakeFetch([[video("aaaaaaaaaaa"), video("aaaaaaaaaaa"), { url: "https://example.com/watch?v=bbbbbbbbbbb", title: "Elsewhere" }, video("ccccccccccc", "x")]]);
  const batch = await discoverCandidates({ concept_ids: ["c1"], concept_names: ["Linear algebra"], source_kind: "video", ranking_intent: "practical", trace_id: "t" }, options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body!.query, "hands-on project tutorial videos building with Linear algebra");
  assert.equal(calls[0]!.body!.type, "neural");
  assert.equal(calls[0]!.body!.startPublishedDate, undefined);
  assert.deepEqual(batch.youtube.map((candidate) => candidate.youtube_id), ["aaaaaaaaaaa"]);
  assert.deepEqual(batch.youtube[0]!.matched_concept_ids, ["c1"]);
  assert.deepEqual([batch.provider_calls, batch.arxiv.length, batch.skipped], [1, 0, ["paper"]]);
});

test("the recent lane limits videos to 90 days and also searches current and foundational papers", async () => {
  const paper = (id: string, title: string, publishedDate: string) => ({ url: `https://arxiv.org/pdf/${id}v2`, title, publishedDate, highlights: ["This seminal work introduced the idea."] });
  const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const { calls, options } = fakeFetch([
    [video("aaaaaaaaaaa")],
    [paper("2601.00001", "A new result", recent), paper("2601.00002", "A new result", recent), paper("2601.00003", "Another one", recent)],
    [paper("1706.03762", "Attention Is All You Need", old), paper("2601.00004", "Seminal recent", recent), paper("2601.00005", "Seminal two", recent)],
  ]);
  const batch = await discoverCandidates({ concept_ids: ["c1"], concept_names: ["Transformers"], ranking_intent: "recent", window_days: 30 }, options);
  const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
  assert.ok(Math.abs(Date.parse(String(calls[0]!.body!.startPublishedDate)) - ninetyDaysAgo) < 60_000);
  assert.equal(calls[1]!.body!.query, "recent current research paper Transformers");
  assert.match(String(calls[2]!.body!.query), /^seminal foundational .* Transformers$/);
  assert.equal(calls.length, 3, "three or more Exa papers per search need no arXiv fallback");
  assert.deepEqual(batch.arxiv.map((candidate) => [candidate.arxiv_id, candidate.paper_class]), [
    ["2601.00001", "current"], ["2601.00002", "current"], ["2601.00003", "current"], ["2601.00004", "foundational"], ["2601.00005", "foundational"],
  ]);
  assert.equal(batch.arxiv[0]!.canonical_url, "https://arxiv.org/abs/2601.00001");
});

test("a retryable Exa failure is retried once and a hard failure is reported without stopping the job", async () => {
  const retried = fakeFetch([503, [video("aaaaaaaaaaa")]]);
  const ok = await discoverCandidates({ concept_ids: ["c1"], concept_names: ["Topic"], source_kind: "video" }, retried.options);
  assert.deepEqual([ok.youtube.length, ok.failures, ok.provider_calls], [1, [], 2]);

  const failing = fakeFetch([401, [], []]);
  const failed = await discoverCandidates({ concept_ids: ["c1"], concept_names: ["Topic"], ranking_intent: "recent" }, failing.options);
  assert.deepEqual(failed.failures, ["youtube:c1:ExaHTTP401"]);
  assert.equal(failing.calls.filter((call) => call.url === "https://api.exa.ai/search").length, 3, "paper searches still run");
});

test("sparse paper results fall back to the arXiv API once per refresh", async () => {
  const feed = `<feed><entry><id>http://arxiv.org/abs/2601.01234v1</id><title>A  study &amp; result</title><summary>Recent findings.</summary>
    <published>${new Date().toISOString()}</published><author><name>Ada Lovelace</name></author><category term="cs.LG"/></entry></feed>`;
  const { calls, options } = fakeFetch([[], [], []], feed);
  const batch = await discoverCandidates({ concept_ids: ["c1"], concept_names: ["Topic"], ranking_intent: "recent" }, options);
  assert.equal(calls.filter((call) => call.url.startsWith("https://export.arxiv.org/")).length, 1);
  assert.deepEqual(batch.arxiv.map((paper) => [paper.arxiv_id, paper.title, paper.authors, paper.categories]), [["2601.01234", "A study & result", ["Ada Lovelace"], ["cs.LG"]]]);
  assert.equal(batch.fallback_calls, 1);
});

test("the arXiv feed parser ignores entries without an id or title", () => {
  assert.deepEqual(parseArxivFeed("<feed><entry><title>No id</title></entry></feed>"), []);
});

test("a query-only refresh searches the query and attributes no concept", async () => {
  const { calls, options } = fakeFetch([[video("aaaaaaaaaaa")]]);
  const batch = await discoverCandidates({ query_text: "  variational autoencoders ", source_kind: "video" }, options);
  assert.equal(calls[0]!.body!.query, "educational videos on variational autoencoders");
  assert.deepEqual(batch.youtube[0]!.matched_concept_ids, []);
  await assert.rejects(discoverCandidates({ source_kind: "video" }, options), /requires a canonical concept or query text/);
});

test("instant search uses the exact query in Exa's instant mode with up to thirty results", async () => {
  const { calls, options } = fakeFetch([[{ ...video("dQw4w9WgXcQ"), url: "https://youtu.be/dQw4w9WgXcQ" }]]);
  const batch = await instantDiscovery({ query_text: "rust ownership", source_kind: "video", ranking_intent: "beginner_friendly", limit: 30 }, options);
  assert.deepEqual([calls[0]!.body!.type, calls[0]!.body!.numResults, calls[0]!.body!.includeDomains], ["instant", 30, ["youtube.com", "youtu.be"]]);
  assert.equal(calls[0]!.body!.query, "beginner introductory fundamental full course videos on rust ownership");
  assert.equal(batch.youtube[0]!.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("instant foundational paper search needs foundational evidence and reports provider failures", async () => {
  const { options } = fakeFetch([[
    { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", highlights: ["The seminal transformer paper."] },
    { url: "https://arxiv.org/abs/2601.00009", title: "An incremental tweak", highlights: ["Small gains."] },
  ], 500]);
  const papers = await instantDiscovery({ query_text: "attention", source_kind: "paper", ranking_intent: "foundational" }, options);
  assert.deepEqual(papers.arxiv.map((paper) => [paper.arxiv_id, paper.paper_class]), [["1706.03762", "foundational"]]);
  const failed = await instantDiscovery({ query_text: "attention", source_kind: "paper" }, options);
  assert.deepEqual([failed.arxiv, failed.failures], [[], ["instant:ExaHTTP500"]]);
});

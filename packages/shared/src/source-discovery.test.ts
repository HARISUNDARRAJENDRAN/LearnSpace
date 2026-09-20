import assert from "node:assert/strict";
import test from "node:test";
import { SOURCE_DISCOVERY_MAX_RESULTS, arxivIdFromUrl, classifySourceUrl, doiFromUrl, sourceDiscoveryInstantBatchSchema, sourceDiscoverySearchRequestSchema, sourceDiscoverySearchResponseSchema, youtubeIdFromUrl } from "./index.js";

test("classifies supported source URLs without accepting unsafe variants", () => {
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeIdFromUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeIdFromUrl("https://evil.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(arxivIdFromUrl("https://arxiv.org/abs/1706.03762v7"), "1706.03762");
  assert.equal(arxivIdFromUrl("https://export.arxiv.org/pdf/1706.03762.pdf"), "1706.03762");
  assert.equal(arxivIdFromUrl("https://arxiv.org/abs/hep-th/9901001"), "hep-th/9901001");
  assert.equal(doiFromUrl("https://doi.org/10.48550/arXiv.1706.03762"), "10.48550/arxiv.1706.03762");
  assert.deepEqual(classifySourceUrl("https://youtu.be/dQw4w9WgXcQ"), {
    provider: "youtube",
    mode: "learn",
    id: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
});

test("source contracts require a mode, non-empty query, and correlation id", () => {
  const parsed = sourceDiscoverySearchRequestSchema.parse({ mode: "research", query: "  diffusion   distillation ", correlationId: "00000000-0000-4000-8000-000000000001" });
  assert.equal(parsed.query, "diffusion   distillation");
  assert.equal(parsed.rankingIntent, "best_match");
  assert.throws(() => sourceDiscoverySearchRequestSchema.parse({ mode: "learn", query: " ", correlationId: "00000000-0000-4000-8000-000000000001" }));
  assert.throws(() => sourceDiscoverySearchRequestSchema.parse({ mode: "learn", query: "papers", rankingIntent: "recent", correlationId: "00000000-0000-4000-8000-000000000001" }));
  assert.throws(() => sourceDiscoverySearchRequestSchema.parse({ mode: "research", query: "papers", rankingIntent: "practical", correlationId: "00000000-0000-4000-8000-000000000001" }));
});

test("source contracts carry a bounded batch of thirty candidates", () => {
  const youtube = Array.from({ length: SOURCE_DISCOVERY_MAX_RESULTS }, (_, index) => {
    const youtubeId = `A${index.toString(36).padStart(10, "0")}`;
    return {
      youtube_id: youtubeId,
      canonical_url: `https://www.youtube.com/watch?v=${youtubeId}`,
      title: `Python lesson ${index + 1}`,
      confidence: 0.9,
    };
  });
  const batch = sourceDiscoveryInstantBatchSchema.parse({ trace_id: "batch-test", youtube, arxiv: [] });
  assert.equal(batch.youtube.length, SOURCE_DISCOVERY_MAX_RESULTS);

  const candidates = youtube.map((candidate, index) => ({
    type: "video" as const,
    provider: "youtube" as const,
    externalId: candidate.youtube_id,
    title: candidate.title,
    description: null,
    canonicalUrl: candidate.canonical_url,
    thumbnailUrl: null,
    author: null,
    durationMs: null,
    publishedAt: null,
    reason: "Strong topic match",
    reasonCodes: ["query_phrase_match"],
    score: 0.9 - index / 100,
    candidateRank: index + 1,
    finalRank: index + 1,
    sourceOrigin: "external_refresh" as const,
    queryRelevance: 0.9,
  }));
  const response = sourceDiscoverySearchResponseSchema.parse({
    status: "completed",
    runId: "00000000-0000-4000-8000-000000000001",
    mode: "learn",
    query: "python for beginners",
    candidates,
  });
  assert.equal(response.candidates.length, SOURCE_DISCOVERY_MAX_RESULTS);
  assert.throws(() => sourceDiscoverySearchResponseSchema.parse({ ...response, candidates: [...candidates, candidates[0]] }));
});

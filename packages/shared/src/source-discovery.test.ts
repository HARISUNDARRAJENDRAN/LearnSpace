import assert from "node:assert/strict";
import test from "node:test";
import { arxivIdFromUrl, classifySourceUrl, doiFromUrl, sourceDiscoverySearchRequestSchema, youtubeIdFromUrl } from "./index.js";

test("classifies supported source URLs without accepting unsafe variants", () => {
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeIdFromUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeIdFromUrl("https://evil.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(arxivIdFromUrl("https://arxiv.org/abs/1706.03762v7"), "1706.03762v7");
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
});

import assert from "node:assert/strict";
import test from "node:test";
import { scoreResearchAffinity } from "../lib/research/affinity";
import { arxivPdfUrl, trustedPdfUrl } from "../lib/research/pdf-source";

test("only https arXiv PDFs are fetched on a learner's behalf", () => {
  assert.equal(trustedPdfUrl("https://arxiv.org/pdf/1706.03762")?.hostname, "arxiv.org");
  assert.equal(trustedPdfUrl("https://export.arxiv.org/pdf/1706.03762v7")?.hostname, "export.arxiv.org");
  for (const unsafe of ["http://arxiv.org/pdf/1706.03762", "https://evil.example/pdf", "https://arxiv.org.evil.example/pdf/1", "https://user:pw@arxiv.org/pdf/1", "https://arxiv.org:8443/pdf/1", "file:///etc/passwd", "https://169.254.169.254/latest", "not a url"]) {
    assert.equal(trustedPdfUrl(unsafe), null, unsafe);
  }
});

test("arXiv ids map to their PDF and anything else is refused", () => {
  assert.equal(arxivPdfUrl("1706.03762"), "https://arxiv.org/pdf/1706.03762");
  assert.equal(arxivPdfUrl("2106.09685v2"), "https://arxiv.org/pdf/2106.09685v2");
  assert.equal(arxivPdfUrl("hep-th/9901001"), "https://arxiv.org/pdf/hep-th/9901001");
  assert.equal(arxivPdfUrl("../../etc/passwd"), null);
  assert.equal(arxivPdfUrl("1706.03762?x=1"), null);
});

test("author affinity favours repeated, recent engagement over a single impression", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const oneOpen = scoreResearchAffinity([{ kind: "opened", occurredAt: days(1) }], now);
  const savedAndRead = scoreResearchAffinity([{ kind: "saved", occurredAt: days(2) }, { kind: "reading", occurredAt: days(1) }], now);
  const staleSave = scoreResearchAffinity([{ kind: "saved", occurredAt: days(180) }], now);
  assert.ok(oneOpen < 8, "a single open never makes an implicit favourite");
  assert.ok(savedAndRead >= 8, "saving and reading does");
  assert.ok(staleSave < scoreResearchAffinity([{ kind: "saved", occurredAt: days(1) }], now), "older signals decay");
});

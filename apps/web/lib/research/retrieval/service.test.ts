import assert from "node:assert/strict";
import test from "node:test";
import { retrieveResearchPapers, understandResearchQuery } from "./service.js";

test("query planning detects scholarly intent and normalizes arXiv identifiers", () => {
  assert.equal(understandResearchQuery('Find "Attention Is All You Need"').intent, "exact_title");
  assert.equal(understandResearchQuery("10.48550/arXiv.1706.03762").arxivId, "1706.03762");
  assert.equal(understandResearchQuery("Papers by Ashish Vaswani on attention").author, "Ashish Vaswani");
  assert.equal(understandResearchQuery("What should I read before understanding FlashAttention?").intent, "prerequisite");
  assert.equal(understandResearchQuery("Find the original Transformer paper").intent, "foundational");
  assert.equal(understandResearchQuery("Recent papers on lightweight multimodal agents").intent, "recent");
});

test("retrieval calls Exa only and keeps Exa order while removing duplicate identifiers and titles", async () => {
  const requests: string[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    requests.push(String(input));
    assert.equal(String(input), "https://api.exa.ai/search");
    const request = JSON.parse(String(init?.body)) as { query: string };
    assert.equal(request.query, "Attention Is All You Need");
    return Response.json({ results: [
      { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", text: "Transformer paper.", publishedDate: "2017-06-12", authors: ["Ashish Vaswani"] },
      { url: "https://arxiv.org/abs/1706.03762v5", title: "Duplicate revision", publishedDate: "2017-06-12" },
      { url: "https://arxiv.org/abs/1901.00001", title: "ATTENTION is all you need!" },
      { url: "https://arxiv.org/abs/2006.04768", title: "Linformer: Self-Attention with Linear Complexity" },
      { url: "https://doi.org/10.5555/paper", title: "Not an arXiv candidate" },
    ] });
  }) as typeof fetch;

  const result = await retrieveResearchPapers("Attention Is All You Need", { exaApiKey: "test", fetch: fetcher });

  assert.equal(requests.length, 1);
  assert.deepEqual(result.papers.map(({ arxivId }) => arxivId), ["1706.03762", "2006.04768"]);
  assert.deepEqual(result.papers[0]?.authors, [{ name: "Ashish Vaswani" }]);
  assert.equal(result.papers[0]?.canonicalUrl, "https://arxiv.org/abs/1706.03762");
  assert.equal(result.sourceCalls, 1);
  assert.deepEqual(result.partialFailures, []);
});

test("identifier queries search with the normalized ID and pin the exact Exa result", async () => {
  let exaQuery = "";
  const fetcher = (async (_input: string | URL, init?: RequestInit) => {
    exaQuery = (JSON.parse(String(init?.body)) as { query: string }).query;
    return Response.json({ results: [
      { url: "https://arxiv.org/abs/2006.04768", title: "Linformer: Self-Attention with Linear Complexity" },
      { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need" },
    ] });
  }) as typeof fetch;

  const result = await retrieveResearchPapers("https://arxiv.org/pdf/1706.03762v5.pdf", { exaApiKey: "test", fetch: fetcher });

  assert.equal(exaQuery, "1706.03762");
  assert.deepEqual(result.papers.map(({ arxivId }) => arxivId), ["1706.03762", "2006.04768"]);
});

test("author and prerequisite intent shape Exa searches without another retrieval provider", async () => {
  const requests: Record<string, string> = {};
  const fetcher = (async (_input: string | URL, init?: RequestInit) => {
    requests[Object.keys(requests).length] = (JSON.parse(String(init?.body)) as { query: string }).query;
    return Response.json({ results: [] });
  }) as typeof fetch;

  await retrieveResearchPapers("Papers by Ashish Vaswani on attention", { exaApiKey: "test", fetch: fetcher });
  await retrieveResearchPapers("What should I read before understanding FlashAttention?", { exaApiKey: "test", fetch: fetcher });

  assert.match(requests["0"]!, /research papers by Ashish Vaswani on attention/i);
  assert.match(requests["1"]!, /foundational research papers needed to understand FlashAttention/i);
});

test("descriptive foundational topics use Exa best-match instead of its narrow seminal-only filter", async () => {
  const fetcher = (async () => Response.json({ results: [
    { url: "https://arxiv.org/abs/1409.3215", title: "Sequence to Sequence Learning with Neural Networks" },
  ] })) as typeof fetch;

  const result = await retrieveResearchPapers("Foundational sequence-to-sequence learning with neural networks", { exaApiKey: "test", fetch: fetcher });

  assert.equal(result.intent, "foundational");
  assert.equal(result.papers[0]?.arxivId, "1409.3215");
});

test("a missing Exa key avoids network access and reports one useful failure", async () => {
  let requests = 0;
  const result = await retrieveResearchPapers("transformer attention", { fetch: (async () => { requests += 1; return Response.json({ results: [] }); }) as typeof fetch, exaApiKey: "" });

  assert.equal(requests, 0);
  assert.deepEqual(result.partialFailures, ["exa: EXA_API_KEY is not configured"]);
  assert.equal(result.sourceCalls, 0);
});

test("an Exa error is surfaced without retrying a second provider", async () => {
  let requests = 0;
  const result = await retrieveResearchPapers("transformer attention", {
    exaApiKey: "test",
    fetch: (async () => { requests += 1; return new Response("busy", { status: 429 }); }) as typeof fetch,
  });

  assert.equal(requests, 1);
  assert.equal(result.papers.length, 0);
  assert.equal(result.partialFailures.length, 1);
  assert.match(result.partialFailures[0]!, /^exa:.*429/);
});

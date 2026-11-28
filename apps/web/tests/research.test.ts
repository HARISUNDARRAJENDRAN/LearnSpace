import assert from "node:assert/strict";
import test from "node:test";
import { scoreResearchAffinity } from "../lib/research/affinity";
import { arxivPdfUrl, trustedPdfUrl } from "../lib/research/pdf-source";
import { cleanLatexText, cleanPaperText } from "../lib/research/text";
import { clearPaperMetadataCache, resolveArxivMetadata, resolveDoiMetadata } from "../lib/source-discovery/paper-resolver";

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

test("cleanLatexText strips raw LaTeX formatting and escapes leaked in paper abstracts", () => {
  assert.equal(
    cleanLatexText("We show \\textit{uniform} speedups of 1{,}010 MIPS and 7.52\\% vs. 7.43\\% ($\\alpha \\leq 0.05$)."),
    "We show uniform speedups of 1,010 MIPS and 7.52% vs. 7.43% (α ≤ 0.05).",
  );
  assert.equal(
    cleanLatexText("Using ``Schr\\\"{o}dinger'' \\textbf{neural} nets in Fig.~1 with \\frac{1}{2} error."),
    'Using "Schrödinger" neural nets in Fig. 1 with 1/2 error.',
  );
  assert.equal(cleanLatexText("Costs range from $100 to $200 per run."), "Costs range from $100 to $200 per run.");
  assert.equal(cleanPaperText("   "), null);
});

test("resolveArxivMetadata falls back across arxiv.org/abs, OpenAlex, and Semantic Scholar and caches hits", async () => {
  clearPaperMetadataCache();
  const seenUrls: string[] = [];
  const absFallbackFetch = (async (input) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.startsWith("https://export.arxiv.org/api/query")) {
      return new Response("Rate limited", { status: 429 });
    }
    if (url.startsWith("https://arxiv.org/abs/1902.00183")) {
      return new Response(
        `<html><head>
          <meta name="citation_title" content="Learning Action Representations for \\textit{RL}" />
          <meta name="citation_author" content="Yash Chandak" />
          <meta name="citation_date" content="2019/02/01" />
        </head><body><blockquote class="abstract"><span class="descriptor">Abstract:</span>Improves 7.52\\% over baselines.</blockquote></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  const fromAbs = await resolveArxivMetadata("1902.00183", { fetch: absFallbackFetch, arxivMinIntervalMs: 0 });
  assert.equal(fromAbs.title, "Learning Action Representations for RL");
  assert.equal(fromAbs.abstract, "Improves 7.52% over baselines.");
  assert.deepEqual(fromAbs.authors, ["Yash Chandak"]);
  assert.equal(fromAbs.year, 2019);
  assert.equal(seenUrls.length, 2);

  // Second resolution is served directly from cache without touching providers.
  const fromCache = await resolveArxivMetadata("1902.00183", { fetch: absFallbackFetch, arxivMinIntervalMs: 0 });
  assert.equal(fromCache.title, fromAbs.title);
  assert.equal(seenUrls.length, 2);

  // When both arXiv endpoints fail, OpenAlex resolves via inverted abstract index.
  clearPaperMetadataCache();
  const openAlexFetch = (async (input) => {
    const url = String(input);
    if (url.includes("arxiv.org")) return new Response("Unavailable", { status: 503 });
    if (url.startsWith("https://api.openalex.org/works/")) {
      return Response.json({
        title: "OpenAI Five",
        publication_year: 2019,
        authorships: [{ author: { display_name: "Christopher Berner" } }],
        abstract_inverted_index: { Large: [0], scale: [1], RL: [2] },
      });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  const fromOpenAlex = await resolveArxivMetadata("1912.06680", { fetch: openAlexFetch, arxivMinIntervalMs: 0, skipCache: true });
  assert.equal(fromOpenAlex.title, "OpenAI Five");
  assert.equal(fromOpenAlex.abstract, "Large scale RL");
  assert.deepEqual(fromOpenAlex.authors, ["Christopher Berner"]);
  assert.equal(fromOpenAlex.year, 2019);

  // When arXiv and OpenAlex fail, Semantic Scholar resolves cleanly.
  const s2Fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.semanticscholar.org/")) {
      return Response.json({ title: "PSRO", abstract: "Game-theoretic RL.", year: 2017, venue: "NeurIPS", authors: [{ name: "Marc Lanctot" }] });
    }
    return new Response("Unavailable", { status: 503 });
  }) as typeof fetch;

  const fromS2 = await resolveArxivMetadata("1711.00832", { fetch: s2Fetch, arxivMinIntervalMs: 0, skipCache: true });
  assert.equal(fromS2.title, "PSRO");
  assert.equal(fromS2.venue, "NeurIPS");
  assert.deepEqual(fromS2.authors, ["Marc Lanctot"]);
});

test("resolveDoiMetadata routes DataCite arXiv DOIs through arXiv resolution and falls back to OpenAlex", async () => {
  clearPaperMetadataCache();
  const dataCiteArxivFetch = (async (input) => {
    const url = String(input);
    if (url.startsWith("https://export.arxiv.org/api/query?id_list=1902.00183")) {
      return new Response("<feed><entry><title>Action Reps</title><summary>Summary.</summary><published>2019-02-01T00:00:00Z</published><author><name>Y. Chandak</name></author></entry></feed>", { status: 200 });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  const arxivDoi = await resolveDoiMetadata("10.48550/arXiv.1902.00183", { fetch: dataCiteArxivFetch, arxivMinIntervalMs: 0, skipCache: true });
  assert.equal(arxivDoi.title, "Action Reps");

  const openAlexDoiFetch = (async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.crossref.org/works/")) return new Response("Not found", { status: 404 });
    if (url.startsWith("https://api.openalex.org/works/https://doi.org/10.1613%2Fjair.1.14174")) {
      return Response.json({
        title: "A Survey of Zero-Shot Generalisation",
        publication_year: 2023,
        authorships: [{ author: { display_name: "Robert Kirk" } }],
        primary_location: { source: { display_name: "JAIR" } },
      });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  const jair = await resolveDoiMetadata("10.1613/jair.1.14174", { fetch: openAlexDoiFetch, skipCache: true, firecrawlApiKey: null });
  assert.equal(jair.title, "A Survey of Zero-Shot Generalisation");
  assert.equal(jair.venue, "JAIR");

  // Firecrawl rescues metadata resolution when arXiv and OpenAlex are unavailable.
  const firecrawlFetch = (async (input) => {
    const url = String(input);
    if (url === "https://api.firecrawl.dev/v2/scrape") {
      return Response.json({
        success: true,
        data: {
          metadata: {
            title: "[1902.00183] Learning Action Representations for RL",
            citation_author: ["Yash Chandak"],
            citation_date: "2019/02/01",
          },
          markdown: "# Learning Action Representations for RL\n\n## Abstract\n\nStructured action spaces improve generalization across unseen actions in RL.",
        },
      });
    }
    return new Response("Rate limited", { status: 429 });
  }) as typeof fetch;

  const viaFirecrawl = await resolveArxivMetadata("1902.00183", {
    fetch: firecrawlFetch,
    arxivMinIntervalMs: 0,
    skipCache: true,
    firecrawlApiKey: "fc-test-key",
  });
  assert.equal(viaFirecrawl.title, "Learning Action Representations for RL");
  assert.equal(viaFirecrawl.pdfUrl, "https://arxiv.org/pdf/1902.00183");
  assert.match(viaFirecrawl.abstract ?? "", /Structured action spaces/);

  // Scholarly OA PDF hosts (like JAIR and Nature) are trusted while arbitrary hosts remain blocked.
  assert.equal(trustedPdfUrl("https://jair.org/index.php/jair/article/download/14174/26890")?.hostname, "jair.org");
  assert.equal(trustedPdfUrl("https://www.nature.com/articles/s41586-019-1724-z.pdf")?.hostname, "www.nature.com");
  assert.equal(trustedPdfUrl("https://example.org/paper.pdf"), null);
});

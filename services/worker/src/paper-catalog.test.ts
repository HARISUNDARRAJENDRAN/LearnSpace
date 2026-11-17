import assert from "node:assert/strict";
import test from "node:test";
import type postgres from "postgres";
import { cleanPaperAbstract, cleanPaperTitle, fetchCatalogPapers, upsertCatalogPaper, type CatalogPaper } from "./paper-catalog.js";

type MemoryAuthor = { id: string; name: string; normalizedName: string; orcid: string | null; semanticScholarId: string | null; metadata: Record<string, string> };

function inMemoryCatalog(): { tx: postgres.TransactionSql; authors: MemoryAuthor[]; edges: Array<{ paperId: string; authorId: string; ordinal: number }> } {
  const authors: MemoryAuthor[] = [];
  const edges: Array<{ paperId: string; authorId: string; ordinal: number }> = [];
  let nextId = 0;
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join(" ");
    if (statement.includes("SELECT id::text AS id FROM catalog.authors")) {
      const [orcid, , semanticScholarId, , openAlexId, , name] = values;
      const match = authors.find((author) => (orcid && author.orcid === orcid)
        || (semanticScholarId && author.semanticScholarId === semanticScholarId)
        || (openAlexId && author.metadata.openalexId === openAlexId)
        || (name && author.normalizedName === name && (!author.orcid || !orcid)));
      return match ? [{ id: match.id }] : [];
    }
    if (statement.includes("UPDATE catalog.authors SET")) {
      const row = authors.find((author) => author.id === values[5]);
      if (row) row.orcid ??= values[2] as string | null;
    }
    if (statement.includes("INSERT INTO catalog.authors")) {
      const [normalizedName, name, orcid, semanticScholarId, metadata] = values;
      const row = { id: `author-${++nextId}`, name: String(name), normalizedName: String(normalizedName), orcid: orcid as string | null, semanticScholarId: semanticScholarId as string | null, metadata: metadata as Record<string, string> };
      authors.push(row);
      return [{ id: row.id }];
    }
    if (statement.includes("SELECT author_id::text AS author_id, ordinal FROM catalog.paper_authors")) {
      return edges.filter((edge) => edge.paperId === values[0]).sort((a, b) => a.ordinal - b.ordinal).map(({ authorId, ordinal }) => ({ author_id: authorId, ordinal }));
    }
    if (statement.includes("DELETE FROM catalog.paper_authors")) {
      for (let index = edges.length - 1; index >= 0; index -= 1) if (edges[index]?.paperId === values[0]) edges.splice(index, 1);
    }
    if (statement.includes("INSERT INTO catalog.paper_authors")) edges.push({ paperId: String(values[0]), authorId: String(values[1]), ordinal: Number(values[2]) });
    return [];
  };
  const tx = Object.assign(query, { json: (value: unknown) => value }) as unknown as postgres.TransactionSql;
  return { tx, authors, edges };
}

function paper(arxivId: string, names: string[]): CatalogPaper {
  return {
    arxivId, title: "A paper", abstract: "An abstract.", publishedAt: "2024-01-01T00:00:00.000Z", primaryCategory: null,
    doi: null, venue: null, citationCount: null, openAlexWorkId: null,
    authors: names.map((name) => ({ name, openAlexId: null, semanticScholarId: null, orcid: null })),
  };
}

test("paper titles and abstracts lose scraped wrappers while keeping real text", () => {
  assert.equal(cleanPaperTitle(" [2611.00001v2] : Clean title "), "Clean title");
  assert.equal(cleanPaperAbstract("# Abstract\nA real &amp; useful abstract.\nComments: obsolete scrape\nSubmitted on 1 Jan"), "A real & useful abstract.");
});

test("catalog metadata comes from arXiv and OpenAlex, preserving arXiv author order and identifiers", async () => {
  const requests: string[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url.origin + url.pathname);
    assert.equal(new Headers(init?.headers).get("user-agent"), "LearnSpace/1.0");
    if (url.hostname === "export.arxiv.org") return new Response(`
      <feed xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
        <id>https://arxiv.org/abs/1706.03762v5</id><title>[1706.03762] Attention Is All You Need</title>
        <summary># Abstract\nWe introduce a model &amp; evaluate it.</summary><published>2017-06-12T17:57:34Z</published>
        <arxiv:primary_category term="cs.CL"/><author><name>Ada Lovelace</name></author><author><name>Grace Hopper</name></author><author><name>Ada Lovelace</name></author><author><name>Alex Smith</name></author>
      </entry></feed>`);
    return Response.json({ results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.5555/example", ids: {}, cited_by_count: 17, primary_location: { landing_page_url: "https://arxiv.org/abs/1706.03762", source: { display_name: "Proceedings of Test" } }, authorships: [
      { author: { display_name: "Grace Hopper", id: "https://openalex.org/A2", orcid: null } },
      { author: { display_name: "Ada Lovelace", id: "https://openalex.org/A1", orcid: "https://orcid.org/0000-0002-1825-0097" } },
      { author: { display_name: "Ada Lovelace", id: "https://openalex.org/A3", orcid: null } },
    ] }] });
  }) as typeof fetch;
  const result = await fetchCatalogPapers(["1706.03762v2"], fetcher);
  const paper = result.get("1706.03762");
  assert.ok(paper);
  assert.equal(paper.title, "Attention Is All You Need");
  assert.equal(paper.abstract, "We introduce a model & evaluate it.");
  assert.equal(paper.primaryCategory, "cs.CL");
  assert.equal(paper.doi, "10.5555/example");
  assert.equal(paper.venue, "Proceedings of Test");
  assert.equal(paper.citationCount, 17);
  assert.deepEqual(paper.authors.map((author) => author.name), ["Ada Lovelace", "Grace Hopper", "Ada Lovelace", "Alex Smith"]);
  assert.equal(paper.authors[0]?.openAlexId, "https://openalex.org/A1");
  assert.equal(paper.authors[0]?.orcid, "0000-0002-1825-0097");
  assert.equal(paper.authors[1]?.openAlexId, "https://openalex.org/A2");
  assert.equal(paper.authors[2]?.openAlexId, "https://openalex.org/A3", "duplicate names keep distinct source identifiers");
  assert.equal(paper.authors[3]?.openAlexId, null, "unmatched names do not inherit an identifier by name similarity");
  assert.equal(requests.length, 2);
});

test("catalog upsert gives one author per name across papers, keeps ORCID namesakes apart and reconciles edges idempotently", async () => {
  const catalog = inMemoryCatalog();
  const edgesOf = (paperId: string) => catalog.edges.filter((edge) => edge.paperId === paperId).map((edge) => edge.authorId);
  // A name listed twice is one author, and a name with no letters is not an author.
  const first = paper("2301.00001", ["Same Name", "Same Name", ":", "张伟"]);
  await upsertCatalogPaper(catalog.tx, "resource-one", first);
  const firstAuthorIds = edgesOf("resource-one");
  assert.equal(firstAuthorIds.length, 2);
  assert.deepEqual(catalog.authors.map((author) => author.normalizedName), ["samename", "张伟"]);

  await upsertCatalogPaper(catalog.tx, "resource-one", first);
  assert.deepEqual(edgesOf("resource-one"), firstAuthorIds);

  // The same person on another paper is the same author, in any script.
  await upsertCatalogPaper(catalog.tx, "resource-two", paper("2301.00002", ["Same  name", "张伟"]));
  assert.deepEqual(edgesOf("resource-two"), firstAuthorIds);

  // An ORCID attaches to the unidentified author; a different ORCID under the same name is someone else.
  const withOrcid = (orcid: string) => ({ ...paper("2301.00003", []), authors: [{ name: "Same Name", openAlexId: null, semanticScholarId: null, orcid }] });
  await upsertCatalogPaper(catalog.tx, "resource-three", withOrcid("0000-0001"));
  assert.deepEqual(edgesOf("resource-three"), [firstAuthorIds[0]]);
  await upsertCatalogPaper(catalog.tx, "resource-four", withOrcid("0000-0002"));
  assert.notEqual(edgesOf("resource-four")[0], firstAuthorIds[0]);
});

import postgres from "postgres";

export type CatalogPaperAuthor = { name: string; openAlexId: string | null; semanticScholarId: string | null; orcid: string | null };
export type CatalogPaper = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: CatalogPaperAuthor[];
  publishedAt: string;
  primaryCategory: string | null;
  doi: string | null;
  venue: string | null;
  citationCount: number | null;
  openAlexWorkId: string | null;
};

type AtomPaper = Omit<CatalogPaper, "doi" | "venue" | "citationCount" | "openAlexWorkId" | "authors"> & { authors: Array<{ name: string }> };
type OpenAlexWork = Record<string, unknown>;
type TransactionSql = postgres.TransactionSql;

const arxivIdPattern = /^(?:[A-Za-z][A-Za-z0-9.-]{1,31}\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/;
// shortcut: this limiter is per process; use a shared limiter if worker replicas exceed arXiv's quota.
let nextArxivRequestAt = 0;
let nextOpenAlexRequestAt = 0;

export function normalizeArxivId(value: string): string | null {
  const id = value.trim().replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  return arxivIdPattern.test(id) ? id : null;
}

export function cleanPaperTitle(value: string): string {
  return value.replace(/^\s*\[?(?:arxiv\s*:?\s*)?\d{4}\.\d{4,5}(?:v\d+)?\]?\s*[:\-–—]?\s*/i, "").replace(/\s+/g, " ").trim();
}

export function cleanPaperAbstract(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#+\s*/, "").trim())
    .filter((line) => line && !/^(?:abstract|arxiv(?:\s+preprint)?|comments?:|journal reference:|subjects?:|report number:|submitted on\b)/i.test(line))
    .join(" ").replace(/\s+/g, " ").trim();
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLowerCase()] ?? entity;
  });
}

function tagValue(xml: string, tag: string): string | null {
  const raw = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1];
  return raw ? decodeXml(raw.replace(/<[^>]*>/g, " ")).trim() || null : null;
}

function parseArxivFeed(xml: string): AtomPaper[] {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].flatMap(([, entry = ""]) => {
    const arxivId = normalizeArxivId(tagValue(entry, "id") ?? "");
    const title = cleanPaperTitle(tagValue(entry, "title") ?? "");
    const abstract = cleanPaperAbstract(tagValue(entry, "summary") ?? "");
    const publishedAt = tagValue(entry, "published");
    if (!arxivId || !title || !abstract || !publishedAt || Number.isNaN(Date.parse(publishedAt))) return [];
    const primaryCategory = entry.match(/<arxiv:primary_category\b[^>]*\bterm="([^"]+)"/i)?.[1] ?? null;
    const authors = [...entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)].flatMap(([, author = ""]) => {
      const name = tagValue(author, "name");
      return name ? [{ name: name.replace(/\s+/g, " ").trim() }] : [];
    });
    return [{ arxivId, title, abstract, authors, publishedAt: new Date(publishedAt).toISOString(), primaryCategory }];
  });
}

async function fetchArxivBatch(ids: string[], fetcher: typeof fetch): Promise<AtomPaper[]> {
  const requestAt = Math.max(Date.now(), nextArxivRequestAt);
  nextArxivRequestAt = requestAt + 3_000;
  const waitMs = requestAt - Date.now();
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("id_list", ids.join(","));
  url.searchParams.set("max_results", String(ids.length));
  const response = await fetcher(url, { headers: { Accept: "application/atom+xml", "User-Agent": "LearnSpace/1.0" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`arXiv API returned HTTP ${response.status}`);
  return parseArxivFeed(await response.text());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanOrcid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.replace(/^https?:\/\/orcid\.org\//i, "").trim();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(id) ? id : null;
}

function cleanDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const doi = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().replace(/[),.;]+$/, "");
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : null;
}

function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function mapOpenAlexAuthors(atomAuthors: AtomPaper["authors"], work: OpenAlexWork | undefined): CatalogPaperAuthor[] {
  const authorships = Array.isArray(work?.authorships) ? work.authorships.map(asRecord) : [];
  const byName = new Map<string, Record<string, unknown>[]>();
  for (const entry of authorships) {
    const author = asRecord(entry.author);
    const name = typeof author.display_name === "string" ? author.display_name : "";
    if (name) byName.set(normalizedName(name), [...(byName.get(normalizedName(name)) ?? []), author]);
  }
  return atomAuthors.map(({ name }) => {
    const matches = byName.get(normalizedName(name));
    const author = matches?.shift();
    return {
      name,
      openAlexId: typeof author?.id === "string" ? author.id : null,
      semanticScholarId: null,
      orcid: cleanOrcid(author?.orcid),
    };
  });
}

function workArxivId(work: OpenAlexWork): string | null {
  const ids = asRecord(work.ids);
  const locations = [work.primary_location, ...(Array.isArray(work.locations) ? work.locations : [])].map(asRecord);
  const landingPage = locations.map((location) => location.landing_page_url).find((value) => typeof value === "string" && normalizeArxivId(value));
  return (typeof ids.arxiv === "string" ? normalizeArxivId(ids.arxiv) : null)
    ?? (typeof landingPage === "string" ? normalizeArxivId(landingPage) : null);
}

function workVenue(work: OpenAlexWork): string | null {
  const primaryLocation = asRecord(work.primary_location);
  const source = asRecord(primaryLocation.source);
  return typeof source.display_name === "string" && source.display_name !== "arXiv (Cornell University)" ? source.display_name : null;
}

export async function fetchCatalogPapers(ids: string[], fetcher: typeof fetch = fetch): Promise<Map<string, CatalogPaper>> {
  const uniqueIds = [...new Set(ids.map(normalizeArxivId).filter((id): id is string => id !== null))];
  const arxiv = new Map<string, AtomPaper>();
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const batch = await fetchArxivBatch(uniqueIds.slice(offset, offset + 100), fetcher);
    for (const paper of batch) arxiv.set(paper.arxivId, paper);
  }
  const openAlex = new Map<string, OpenAlexWork>();
  try {
    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
      const batchIds = uniqueIds.slice(offset, offset + 100);
      const url = new URL("https://api.openalex.org/works");
      url.searchParams.set("filter", `ids.arxiv:${batchIds.join("|")}`);
      url.searchParams.set("per-page", String(batchIds.length));
      url.searchParams.set("select", "id,doi,ids,authorships,primary_location,locations,cited_by_count");
      const requestAt = Math.max(Date.now(), nextOpenAlexRequestAt);
      nextOpenAlexRequestAt = requestAt + 1_000;
      if (requestAt > Date.now()) await new Promise((resolve) => setTimeout(resolve, requestAt - Date.now()));
      let response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "LearnSpace/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(10_000, retryAfter * 1_000) : 1_000));
        response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "LearnSpace/1.0" }, signal: AbortSignal.timeout(20_000) });
      }
      if (!response.ok) throw new Error(`OpenAlex returned HTTP ${response.status}`);
      const body = asRecord(await response.json());
      for (const result of Array.isArray(body.results) ? body.results : []) {
        const work = asRecord(result);
        const id = workArxivId(work);
        if (id) openAlex.set(id, work);
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ metric: "paper_catalog_openalex_unavailable", error: error instanceof Error ? error.message : "OpenAlex unavailable" }));
  }
  return new Map([...arxiv].map(([arxivId, paper]) => {
    const work = openAlex.get(arxivId);
    const ids = asRecord(work?.ids);
    const citedByCount = work?.cited_by_count;
    return [arxivId, {
      ...paper,
      authors: mapOpenAlexAuthors(paper.authors, work),
      doi: cleanDoi(work?.doi ?? ids.doi),
      venue: work ? workVenue(work) : null,
      citationCount: typeof citedByCount === "number" && Number.isInteger(citedByCount) && citedByCount >= 0 ? citedByCount : null,
      openAlexWorkId: typeof work?.id === "string" ? work.id : null,
    }];
  }));
}

/**
 * One person is one author: a strong identifier (ORCID, Semantic Scholar, OpenAlex) matches first, then the same name,
 * unless both carry different ORCIDs.
 */
async function authorId(tx: TransactionSql, author: CatalogPaperAuthor): Promise<string> {
  const name = normalizedName(author.name);
  // Writers resolving the same name take turns, so concurrent ingestion cannot create one person twice.
  if (name) await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog.author:${name}`}, 0))`;
  const [existing] = await tx<{ id: string }[]>`
    SELECT id::text AS id FROM catalog.authors
    WHERE (${author.orcid}::text IS NOT NULL AND orcid = ${author.orcid})
       OR (${author.semanticScholarId}::text IS NOT NULL AND semantic_scholar_id = ${author.semanticScholarId})
       OR (${author.openAlexId}::text IS NOT NULL AND metadata->>'openalexId' = ${author.openAlexId})
       OR (${name} <> '' AND normalized_name = ${name} AND (orcid IS NULL OR ${author.orcid}::text IS NULL))
    ORDER BY CASE WHEN orcid = ${author.orcid} THEN 0 WHEN semantic_scholar_id = ${author.semanticScholarId} THEN 1 WHEN metadata->>'openalexId' = ${author.openAlexId} THEN 2 ELSE 3 END, created_at
    LIMIT 1
  `;
  const metadata = author.openAlexId ? { openalexId: author.openAlexId } : {};
  if (existing) {
    await tx`
      UPDATE catalog.authors SET
        preferred_name = ${author.name}, normalized_name = ${name},
        orcid = COALESCE(orcid, ${author.orcid}), semantic_scholar_id = COALESCE(semantic_scholar_id, ${author.semanticScholarId}),
        metadata = (metadata - 'catalogIdentity') || ${tx.json(metadata)}, updated_at = now()
      WHERE id = ${existing.id} AND (preferred_name IS DISTINCT FROM ${author.name} OR normalized_name IS DISTINCT FROM ${name}
        OR (orcid IS NULL AND ${author.orcid}::text IS NOT NULL) OR (semantic_scholar_id IS NULL AND ${author.semanticScholarId}::text IS NOT NULL)
        OR metadata ? 'catalogIdentity' OR (${author.openAlexId}::text IS NOT NULL AND metadata->>'openalexId' IS DISTINCT FROM ${author.openAlexId}))
    `;
    return existing.id;
  }
  const [inserted] = await tx<{ id: string }[]>`
    INSERT INTO catalog.authors (normalized_name, preferred_name, orcid, semantic_scholar_id, metadata)
    VALUES (${name}, ${author.name}, ${author.orcid}, ${author.semanticScholarId}, ${tx.json(metadata)})
    ON CONFLICT DO NOTHING RETURNING id::text AS id
  `;
  if (inserted) return inserted.id;
  return authorId(tx, { ...author, orcid: null, semanticScholarId: null, openAlexId: null });
}

/** The worker and backfill both use this one verified arXiv/OpenAlex write path. */
export async function upsertCatalogPaper(tx: TransactionSql, resourceId: string, paper: CatalogPaper): Promise<void> {
  // In order and one at a time: a name listed twice resolves to one author, and a name with no letters is not an author.
  const authorIds: string[] = [];
  for (const author of paper.authors.filter(({ name }) => /\p{L}/u.test(name))) {
    const id = await authorId(tx, author);
    if (!authorIds.includes(id)) authorIds.push(id);
  }
  await tx`
    UPDATE catalog.resources SET
      title = ${paper.title}, description = ${paper.abstract}, canonical_url = ${`https://arxiv.org/abs/${paper.arxivId}`},
      metadata = (metadata - 'authors') || ${tx.json({ catalogMetadataVerified: true })},
      updated_at = CASE WHEN title IS DISTINCT FROM ${paper.title} OR description IS DISTINCT FROM ${paper.abstract} OR canonical_url IS DISTINCT FROM ${`https://arxiv.org/abs/${paper.arxivId}`} THEN now() ELSE updated_at END
    WHERE id = ${resourceId} AND (title IS DISTINCT FROM ${paper.title} OR description IS DISTINCT FROM ${paper.abstract}
      OR canonical_url IS DISTINCT FROM ${`https://arxiv.org/abs/${paper.arxivId}`} OR metadata->>'catalogMetadataVerified' IS DISTINCT FROM 'true' OR metadata ? 'authors')
  `;
  await tx`
    INSERT INTO catalog.paper_details (resource_id, arxiv_id, doi, abstract, venue, publication_date, submitted_at, primary_category, pdf_source_url, citation_count, metadata)
    VALUES (${resourceId}, ${paper.arxivId}, ${paper.doi}, ${paper.abstract}, ${paper.venue}, ${paper.publishedAt.slice(0, 10)}, ${paper.publishedAt}, ${paper.primaryCategory}, ${`https://arxiv.org/pdf/${paper.arxivId}`}, ${paper.citationCount}, ${tx.json(paper.openAlexWorkId ? { openAlexWorkId: paper.openAlexWorkId } : {})})
    ON CONFLICT (resource_id) DO UPDATE SET
      arxiv_id = EXCLUDED.arxiv_id, doi = COALESCE(EXCLUDED.doi, catalog.paper_details.doi), abstract = EXCLUDED.abstract,
      venue = COALESCE(EXCLUDED.venue, catalog.paper_details.venue), publication_date = EXCLUDED.publication_date,
      submitted_at = EXCLUDED.submitted_at, primary_category = EXCLUDED.primary_category, pdf_source_url = EXCLUDED.pdf_source_url,
      citation_count = COALESCE(EXCLUDED.citation_count, catalog.paper_details.citation_count),
      metadata = (catalog.paper_details.metadata - 'authors') || EXCLUDED.metadata
    WHERE catalog.paper_details.arxiv_id IS DISTINCT FROM EXCLUDED.arxiv_id OR catalog.paper_details.doi IS DISTINCT FROM COALESCE(EXCLUDED.doi, catalog.paper_details.doi)
      OR catalog.paper_details.abstract IS DISTINCT FROM EXCLUDED.abstract OR catalog.paper_details.venue IS DISTINCT FROM COALESCE(EXCLUDED.venue, catalog.paper_details.venue)
      OR catalog.paper_details.publication_date IS DISTINCT FROM EXCLUDED.publication_date OR catalog.paper_details.submitted_at IS DISTINCT FROM EXCLUDED.submitted_at
      OR catalog.paper_details.primary_category IS DISTINCT FROM EXCLUDED.primary_category OR catalog.paper_details.pdf_source_url IS DISTINCT FROM EXCLUDED.pdf_source_url
      OR catalog.paper_details.citation_count IS DISTINCT FROM COALESCE(EXCLUDED.citation_count, catalog.paper_details.citation_count)
      OR catalog.paper_details.metadata IS DISTINCT FROM ((catalog.paper_details.metadata - 'authors') || EXCLUDED.metadata)
  `;
  const current = await tx<{ author_id: string; ordinal: number }[]>`
    SELECT author_id::text AS author_id, ordinal FROM catalog.paper_authors WHERE paper_resource_id = ${resourceId} ORDER BY ordinal
  `;
  if (current.length === authorIds.length && current.every((row, index) => row.author_id === authorIds[index] && row.ordinal === index)) return;
  await tx`DELETE FROM catalog.paper_authors WHERE paper_resource_id = ${resourceId}`;
  for (const [ordinal, id] of authorIds.entries()) {
    await tx`INSERT INTO catalog.paper_authors (paper_resource_id, author_id, ordinal) VALUES (${resourceId}, ${id}, ${ordinal})`;
  }
}

export async function upsertCatalogPapers(tx: TransactionSql, resourceByArxivId: Map<string, string>, papers: Map<string, CatalogPaper>): Promise<number> {
  let upserted = 0;
  for (const [arxivId, resourceId] of resourceByArxivId) {
    const paper = papers.get(arxivId);
    if (!paper) continue;
    await upsertCatalogPaper(tx, resourceId, paper);
    upserted += 1;
  }
  return upserted;
}

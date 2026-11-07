/**
 * Finds learning videos and papers through Exa (with an arXiv API fallback for sparse paper results).
 * Returns the snake_case candidate batch the worker's parseBatch and the web's instant schema validate;
 * everything Exa returns is untrusted and is filtered to canonical YouTube and arXiv identities here.
 */

export type ResourceKind = "video" | "paper";

export type DiscoveryRequest = {
  concept_ids?: string[];
  concept_names?: string[];
  query_text?: string | null;
  source_kind?: ResourceKind | null;
  window_days?: number;
  ranking_intent?: string | null;
  trace_id?: string | null;
};

export type InstantDiscoveryRequest = {
  query_text: string;
  source_kind: ResourceKind;
  ranking_intent?: string;
  limit?: number;
  trace_id?: string | null;
};

export type YoutubeCandidate = {
  youtube_id: string;
  canonical_url: string;
  title: string;
  channel: string | null;
  published_at: string | null;
  duration_ms: null;
  language: string | null;
  matched_concept_ids: string[];
  learning_format: null;
  estimated_level: null;
  has_implementation: null;
  evidence: string[];
  source: "exa";
  confidence: number;
  discovered_at: string;
};

export type ArxivCandidate = {
  arxiv_id: string;
  canonical_url: string;
  title: string;
  authors: string[];
  abstract: string | null;
  published_at: string | null;
  categories: string[];
  matched_concept_ids: string[];
  estimated_level: null;
  paper_class: "current" | "foundational";
  evidence: string[];
  source: "exa";
  confidence: number;
  discovered_at: string;
};

export type DiscoveryBatch = {
  trace_id: string;
  skipped: ResourceKind[];
  youtube: YoutubeCandidate[];
  arxiv: ArxivCandidate[];
  cache_hit: false;
  failures: string[];
  provider_calls: number;
  fallback_calls: number;
  generated_at: string;
};

export type DiscoveryOptions = { exaApiKey: string; timeoutMs?: number; fetch?: typeof fetch };

type RawResult = Record<string, unknown>;

// Each background lane asks Exa for a handful of results; the lanes and scheduled refreshes add up the pool.
const BACKGROUND_RESULTS = 4;
const RECENT_VIDEO_DAYS = 90;
const FOUNDATIONAL_TERMS = ["foundational", "seminal", "landmark", "original work", "canonical paper", "influential work", "first work", "early defining", "pioneering", "introduced"];

const interactiveVideoPrefixes: Record<string, string> = {
  beginner_friendly: "beginner introductory fundamental full course videos on",
  practical: "hands-on practical implementation project videos on",
  in_depth: "advanced detailed deep dive lecture videos on",
  best_match: "videos on",
};
// Background refreshes search one shared lane per concept (worker discovery-lanes.ts).
const backgroundVideoPrefixes: Record<string, string> = {
  beginner_friendly: "beginner friendly introduction and full course videos teaching",
  practical: "hands-on project tutorial videos building with",
  in_depth: "in-depth lecture and deep dive videos on",
  recent: "newly released educational videos explaining",
  best_match: "educational videos on",
};

/** Parses an https URL with no credentials and no explicit port (URL hides a default :443, so check the raw text). */
function strictHttpsUrl(value: string): URL | null {
  if (!/^https:\/\/[^/?#@:]+(?:[/?#]|$)/i.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function youtubeIdFromUrl(value: string): string | null {
  const url = strictHttpsUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  let candidate = "";
  if (host === "youtu.be") candidate = url.pathname.replace(/^\/+|\/+$/g, "");
  else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    candidate = url.searchParams.get("v") ?? "";
    if (!candidate) {
      const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
      candidate = parts.length > 1 && ["shorts", "embed", "live"].includes(parts[0]!) ? parts[1]! : "";
    }
  } else return null;
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

const arxivIdPattern = /^(?:[A-Za-z][A-Za-z0-9.-]{1,31}\/\d{7}|\d{4}\.\d{4,5}(?:v\d+)?)$/;

/** Normalizes arXiv abs, pdf and html links to a version-independent https://arxiv.org/abs/<id>. */
export function canonicalArxivUrl(value: string): string | null {
  const url = strictHttpsUrl(value);
  if (!url || url.hostname !== "arxiv.org" || url.search || url.hash || /[?#]/.test(value)) return null;
  const match = /^\/(?:abs|pdf|html)\/(.+)$/.exec(url.pathname);
  if (!match) return null;
  const identifier = match[1]!.replace(/\.pdf$/, "").replace(/v\d+$/i, "");
  return arxivIdPattern.test(identifier) ? `https://arxiv.org/abs/${identifier}` : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 50) : [];
}

function evidenceText(item: RawResult): string {
  const parts = ["text", "abstract", "summary", "highlight"].map((key) => text(item[key])).filter((value): value is string => value !== null);
  parts.push(...strings(item.highlights));
  return parts.join(" ").slice(0, 1600);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

type Search = { query: string; kind: ResourceKind; numResults: number; interactive: boolean; startPublishedDate?: string };

async function exaSearch(options: DiscoveryOptions, search: Search): Promise<RawResult[]> {
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": options.exaApiKey, "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      body: JSON.stringify({
        query: search.query,
        type: search.interactive ? "instant" : "neural",
        numResults: search.numResults,
        includeDomains: search.kind === "paper" ? ["arxiv.org"] : search.interactive ? ["youtube.com", "youtu.be"] : ["youtube.com"],
        contents: { highlights: { maxCharacters: 800 } },
        ...(search.startPublishedDate ? { startPublishedDate: search.startPublishedDate } : {}),
      }),
    });
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.name : "NetworkError", true);
  }
  if (!response.ok) throw new ProviderError(`ExaHTTP${response.status}`, response.status === 429 || response.status >= 500);
  const body = await response.json() as { results?: unknown };
  return Array.isArray(body.results) ? body.results.filter((item): item is RawResult => typeof item === "object" && item !== null) : [];
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ProviderError) || !error.retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return operation();
  }
}

function videoCandidates(results: RawResult[], conceptIds: string[]): YoutubeCandidate[] {
  const seen = new Set<string>();
  const now = new Date().toISOString();
  return results.flatMap((item) => {
    const youtubeId = typeof item.url === "string" ? youtubeIdFromUrl(item.url) : null;
    const title = text(item.title);
    if (!youtubeId || !title || title.length < 3 || title.length > 500 || seen.has(youtubeId)) return [];
    seen.add(youtubeId);
    const evidence = text(item.text) ?? strings(item.highlights).join(" ");
    return [{
      youtube_id: youtubeId,
      canonical_url: `https://www.youtube.com/watch?v=${youtubeId}`,
      title,
      channel: text(item.author),
      published_at: isoDate(item.publishedDate),
      duration_ms: null,
      language: text(item.language),
      matched_concept_ids: conceptIds,
      learning_format: null,
      estimated_level: null,
      has_implementation: null,
      evidence: evidence ? [evidence.slice(0, 800)] : [],
      source: "exa",
      confidence: 0.6,
      discovered_at: now,
    }];
  });
}

function paperCandidates(results: RawResult[], conceptIds: string[], paperClass: "current" | "foundational", maxAgeDays: number | null): ArxivCandidate[] {
  const seen = new Set<string>();
  const now = new Date().toISOString();
  return results.flatMap((item) => {
    const url = typeof item.url === "string" ? canonicalArxivUrl(item.url) : null;
    const title = text(item.title);
    if (!url || !title || title.length < 3 || title.length > 500) return [];
    const arxivId = url.slice("https://arxiv.org/abs/".length);
    const evidence = evidenceText(item);
    if (paperClass === "foundational" && !FOUNDATIONAL_TERMS.some((term) => `${title} ${evidence}`.toLowerCase().includes(term))) return [];
    const publishedAt = isoDate(item.publishedDate);
    if (maxAgeDays !== null && publishedAt && Date.now() - Date.parse(publishedAt) > maxAgeDays * 86_400_000) return [];
    if (seen.has(arxivId)) return [];
    seen.add(arxivId);
    const category = text(item.category);
    return [{
      arxiv_id: arxivId,
      canonical_url: url,
      title,
      authors: strings(item.authors),
      abstract: text(item.abstract) ?? (evidence || null),
      published_at: publishedAt,
      categories: strings(item.categories).length ? strings(item.categories).slice(0, 20) : category ? [category] : [],
      matched_concept_ids: conceptIds,
      estimated_level: null,
      paper_class: paperClass,
      evidence: evidence ? [evidence.slice(0, 800)] : paperClass === "foundational" ? [title.slice(0, 800)] : [],
      source: "exa",
      confidence: 0.65,
      discovered_at: now,
    }];
  });
}

/** arXiv's own API, used only when Exa returns fewer than three papers for a background refresh. */
export async function arxivApiSearch(query: string, limit: number, fetcher: typeof fetch = fetch): Promise<RawResult[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("max_results", String(Math.min(10, Math.max(1, limit))));
  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return [];
  return parseArxivFeed(await response.text());
}

export function parseArxivFeed(xml: string): RawResult[] {
  const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const tag = (entry: string, name: string) => {
    const value = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry)?.[1];
    return value ? decode(value.replace(/\s+/g, " ").trim()) : null;
  };
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
    const id = tag(entry!, "id");
    const title = tag(entry!, "title");
    if (!id || !title) return [];
    return [{
      url: id.replace(/^http:/, "https:"),
      title,
      text: tag(entry!, "summary") || null,
      publishedDate: tag(entry!, "published") || null,
      authors: [...entry!.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((match) => decode(match[1]!.trim())),
      categories: [...entry!.matchAll(/<category[^>]*term="([^"]+)"/g)].map((match) => match[1]!),
    }];
  });
}

function batch(traceId: string, youtube: YoutubeCandidate[], arxiv: ArxivCandidate[], failures: string[], providerCalls: number, fallbackCalls: number, skipped: ResourceKind[] = []): DiscoveryBatch {
  const unique = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()].slice(0, 50);
  return {
    trace_id: traceId,
    skipped,
    youtube: unique(youtube, (candidate) => candidate.youtube_id),
    arxiv: unique(arxiv, (candidate) => candidate.arxiv_id),
    cache_hit: false,
    failures: failures.slice(0, 10),
    provider_calls: providerCalls,
    fallback_calls: fallbackCalls,
    generated_at: new Date().toISOString(),
  };
}

/**
 * One background refresh: a video search for the lane, and for mixed requests a current and a
 * foundational paper search. A failed search is reported in `failures` and the rest still run.
 */
export async function discoverCandidates(request: DiscoveryRequest, options: DiscoveryOptions): Promise<DiscoveryBatch> {
  const traceId = request.trace_id || crypto.randomUUID();
  const conceptIds = request.concept_ids ?? [];
  const conceptNames = request.concept_names ?? [];
  const queryText = text(request.query_text);
  if (!conceptIds.length && !queryText) throw new Error("discovery refresh requires a canonical concept or query text");
  const pools = conceptIds.length ? conceptIds.map((id, index) => ({ id, name: conceptNames[index] ?? "" })) : [{ id: null, name: queryText! }];
  const windowDays = request.window_days ?? 30;
  const lane = request.ranking_intent || "best_match";
  const youtube: YoutubeCandidate[] = [];
  const arxiv: ArxivCandidate[] = [];
  const failures: string[] = [];
  let providerCalls = 0;
  let fallbackCalls = 0;
  const exa = (search: Search) => withRetry(() => { providerCalls += 1; return exaSearch(options, search); });
  for (const pool of pools) {
    const terms = queryText ?? pool.name;
    const matched = pool.id ? [pool.id] : [];
    const key = pool.id ?? "query";
    if (request.source_kind !== "paper") {
      try {
        youtube.push(...videoCandidates(await exa({
          query: `${backgroundVideoPrefixes[lane] ?? backgroundVideoPrefixes.best_match} ${terms}`,
          kind: "video",
          numResults: BACKGROUND_RESULTS,
          interactive: false,
          ...(lane === "recent" ? { startPublishedDate: daysAgo(RECENT_VIDEO_DAYS) } : {}),
        }), matched));
      } catch (error) {
        failures.push(`youtube:${key}:${error instanceof Error ? error.message : "Error"}`);
      }
    }
    if (request.source_kind === "video") continue;
    for (const paperClass of ["current", "foundational"] as const) {
      const days = paperClass === "current" ? windowDays : 365;
      let results: RawResult[] = [];
      try {
        results = await exa({
          query: paperClass === "foundational"
            ? `seminal foundational landmark canonical original influential early defining research paper ${terms}`
            : `recent current research paper ${terms}`,
          kind: "paper",
          numResults: BACKGROUND_RESULTS,
          interactive: false,
          // The recent lane keeps even foundational papers within the last year.
          ...(paperClass === "current" || lane === "recent" ? { startPublishedDate: daysAgo(days) } : {}),
        });
      } catch (error) {
        failures.push(`arxiv:${key}:${paperClass}:${error instanceof Error ? error.message : "Error"}`);
      }
      // At most one free arXiv fallback per refresh keeps the job's provider calls bounded.
      if (results.length < 3 && fallbackCalls === 0) {
        fallbackCalls += 1;
        const prefix = paperClass === "foundational" ? "seminal foundational landmark canonical original work" : "recent current research";
        results.push(...await arxivApiSearch(`${prefix} ${terms}`, BACKGROUND_RESULTS - results.length, options.fetch).catch(() => []));
      }
      arxiv.push(...paperCandidates(results, matched, paperClass, paperClass === "current" || lane === "recent" ? days : null));
    }
  }
  const skipped: ResourceKind[] = request.source_kind === "paper" ? ["video"] : request.source_kind === "video" ? ["paper"] : [];
  return batch(traceId, youtube, arxiv, failures, providerCalls, fallbackCalls, skipped);
}

/** The source picker's synchronous search: one fast Exa call, shaped by the learner's ranking intent. */
export async function instantDiscovery(request: InstantDiscoveryRequest, options: DiscoveryOptions): Promise<DiscoveryBatch> {
  const traceId = request.trace_id || "instant-discovery";
  const intent = request.ranking_intent ?? "best_match";
  const limit = Math.min(30, Math.max(1, request.limit ?? 30));
  const query = request.query_text.trim();
  try {
    if (request.source_kind === "video") {
      const results = await exaSearch(options, { query: `${interactiveVideoPrefixes[intent] ?? interactiveVideoPrefixes.best_match} ${query}`, kind: "video", numResults: limit, interactive: true });
      return batch(traceId, videoCandidates(results, []).slice(0, limit), [], [], 1, 0);
    }
    const results = await exaSearch(options, {
      query: intent === "foundational" ? `seminal foundational canonical original research papers on ${query}` : intent === "recent" ? `recent latest research papers on ${query}` : query,
      kind: "paper",
      numResults: limit,
      interactive: true,
      ...(intent === "recent" ? { startPublishedDate: daysAgo(365) } : {}),
    });
    const papers = paperCandidates(results, [], intent === "foundational" ? "foundational" : "current", intent === "recent" ? 365 : null);
    return batch(traceId, [], papers.slice(0, limit), [], 1, 0);
  } catch (error) {
    return batch(traceId, [], [], [`instant:${error instanceof Error ? error.message : "Error"}`], 1, 0);
  }
}

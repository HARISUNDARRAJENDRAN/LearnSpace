import { AuthError } from "../auth/errors";
import { getRedisValue, setRedisValue } from "../discovery/cache";
import { cleanLatexText, cleanPaperText } from "../research/text";

export type ResolvedPaperMetadata = {
  title: string;
  abstract: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
};

export type PaperResolverOptions = {
  fetch?: typeof fetch;
  /** Minimum delay between consecutive calls to export.arxiv.org in the same process. */
  arxivMinIntervalMs?: number;
  /** Per-provider request timeout in milliseconds. */
  timeoutMs?: number;
  /** Bypass in-memory and Redis metadata caches (primarily for tests). */
  skipCache?: boolean;
};

const USER_AGENT = "LearnSpace/1.0 (+https://learn-space.app)";
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MEMORY_CACHE_TTL_MS = CACHE_TTL_SECONDS * 1_000;
const MEMORY_CACHE_MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_ARXIV_MIN_INTERVAL_MS = 3_000;

const memoryCache = new Map<string, { value: ResolvedPaperMetadata; expiresAt: number }>();
let nextArxivApiRequestAt = 0;

export function clearPaperMetadataCache(): void {
  memoryCache.clear();
  nextArxivApiRequestAt = 0;
}

function sourceUnavailable(): AuthError {
  return new AuthError("SOURCE_UNAVAILABLE", "The source provider could not be reached.", 502);
}

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const parsed = Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    });
}

function finalizeMetadata(metadata: ResolvedPaperMetadata): ResolvedPaperMetadata {
  const title = cleanLatexText(metadata.title);
  return {
    title: title || metadata.title.trim(),
    abstract: cleanPaperText(metadata.abstract),
    authors: metadata.authors.map((author) => decodeHtmlEntities(author).replace(/\s+/g, " ").trim()).filter(Boolean),
    year: typeof metadata.year === "number" && Number.isFinite(metadata.year) ? metadata.year : null,
    venue: metadata.venue ? decodeHtmlEntities(metadata.venue).replace(/\s+/g, " ").trim() : null,
  };
}

function cacheKey(provider: "arxiv" | "doi", id: string): string {
  return `ls:v1:source-resolve:${provider}:${id.toLowerCase()}`;
}

async function readCachedMetadata(key: string): Promise<ResolvedPaperMetadata | null> {
  const inMemory = memoryCache.get(key);
  if (inMemory) {
    if (inMemory.expiresAt > Date.now()) return inMemory.value;
    memoryCache.delete(key);
  }
  try {
    const raw = await getRedisValue(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResolvedPaperMetadata>;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    const value: ResolvedPaperMetadata = {
      title: parsed.title,
      abstract: typeof parsed.abstract === "string" ? parsed.abstract : null,
      authors: Array.isArray(parsed.authors) ? parsed.authors.filter((item): item is string => typeof item === "string") : [],
      year: typeof parsed.year === "number" ? parsed.year : null,
      venue: typeof parsed.venue === "string" ? parsed.venue : null,
    };
    writeMemoryCache(key, value);
    return value;
  } catch {
    return null;
  }
}

function writeMemoryCache(key: string, value: ResolvedPaperMetadata): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS });
}

async function writeCachedMetadata(key: string, value: ResolvedPaperMetadata): Promise<void> {
  writeMemoryCache(key, value);
  try {
    await setRedisValue(key, JSON.stringify(value), CACHE_TTL_SECONDS);
  } catch {
    // Cache writes are best-effort.
  }
}

async function fetchProviderText(fetcher: typeof fetch, url: string, accept: string, timeoutMs: number): Promise<string> {
  const response = await fetcher(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: accept, "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw sourceUnavailable();
  const text = await response.text();
  if (text.length > 1_500_000) throw sourceUnavailable();
  return text;
}

async function fetchProviderJson(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw sourceUnavailable();
  const body: unknown = await response.json();
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function xmlText(entry: string, tag: string): string | null {
  const value = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim();
  if (!value) return null;
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ""));
}

export function parseArxivAtomXml(xml: string, arxivId: string): ResolvedPaperMetadata | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
  if (!entry) return null;
  const rawTitle = xmlText(entry, "title");
  if (!rawTitle || /^error$/i.test(rawTitle.trim())) return null;
  const published = xmlText(entry, "published");
  const parsedYear = published ? new Date(published).getUTCFullYear() : Number.NaN;
  const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return finalizeMetadata({
    title: rawTitle || `arXiv paper ${arxivId}`,
    abstract: xmlText(entry, "summary"),
    authors,
    year: Number.isFinite(parsedYear) ? parsedYear : null,
    venue: "arXiv",
  });
}

function metaContents(html: string, name: string): string[] {
  const results: string[] = [];
  const metaRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(metaRe) ?? []) {
    const tagName = tag.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const matchedName = (tagName?.[1] ?? tagName?.[2] ?? "").toLowerCase();
    if (matchedName !== name.toLowerCase()) continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const content = contentMatch?.[1] ?? contentMatch?.[2];
    if (content?.trim()) results.push(decodeHtmlEntities(content.trim()));
  }
  return results;
}

export function parseArxivAbsHtml(html: string): ResolvedPaperMetadata | null {
  const title = metaContents(html, "citation_title")[0];
  if (!title) return null;
  const authors = metaContents(html, "citation_author");
  const dateRaw = metaContents(html, "citation_date")[0] ?? metaContents(html, "citation_online_date")[0];
  const yearMatch = dateRaw?.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch?.[1] ? Number.parseInt(yearMatch[1], 10) : null;
  let abstract = metaContents(html, "citation_abstract")[0] ?? null;
  if (!abstract) {
    const blockMatch = html.match(/<blockquote\b[^>]*class="[^"]*\babstract\b[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
    if (blockMatch?.[1]) {
      abstract = decodeHtmlEntities(
        blockMatch[1]
          .replace(/<span\b[^>]*class="[^"]*descriptor[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
          .replace(/<[^>]+>/g, " "),
      ).replace(/^Abstract:\s*/i, "");
    }
  }
  return finalizeMetadata({ title, abstract, authors, year, venue: "arXiv" });
}

function reconstructAbstractFromInvertedIndex(index: unknown): string | null {
  if (!index || typeof index !== "object" || Array.isArray(index)) return null;
  const positioned: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number" && Number.isInteger(pos) && pos >= 0) {
        positioned.push([pos, word]);
      }
    }
  }
  if (positioned.length === 0) return null;
  positioned.sort((left, right) => left[0] - right[0]);
  return positioned.map(([, word]) => word).join(" ");
}

export function parseOpenAlexWork(body: Record<string, unknown>, defaultVenue: string | null = null): ResolvedPaperMetadata | null {
  const title = asString(body.title) ?? asString(body.display_name);
  if (!title) return null;
  const authors = arrayValue(body.authorships)
    .map((entry) => asString(recordValue(recordValue(entry, "author"), "display_name")))
    .filter((value): value is string => Boolean(value));
  const year = typeof body.publication_year === "number" ? body.publication_year : null;
  const venue = asString(recordValue(recordValue(body.primary_location, "source"), "display_name")) ?? defaultVenue;
  const abstract = reconstructAbstractFromInvertedIndex(body.abstract_inverted_index);
  return finalizeMetadata({ title, abstract, authors, year, venue });
}

export function parseSemanticScholarPaper(body: Record<string, unknown>): ResolvedPaperMetadata | null {
  const title = asString(body.title);
  if (!title) return null;
  const authors = arrayValue(body.authors)
    .map((author) => asString(recordValue(author, "name")))
    .filter((value): value is string => Boolean(value));
  const year = typeof body.year === "number" ? body.year : null;
  const venue = asString(body.venue) ?? "arXiv";
  const abstract = asString(body.abstract);
  return finalizeMetadata({ title, abstract, authors, year, venue });
}

export function parseCrossrefWork(body: Record<string, unknown>, doi: string): ResolvedPaperMetadata | null {
  const message = recordValue(body, "message");
  if (!message) return null;
  const title = asString(arrayValue(recordValue(message, "title"))[0]);
  if (!title) return null;
  const authors = arrayValue(recordValue(message, "author")).flatMap((author) => {
    const given = asString(recordValue(author, "given"));
    const family = asString(recordValue(author, "family"));
    return given || family ? [[given, family].filter(Boolean).join(" ")] : [];
  });
  const published = recordValue(message, "published-print") ?? recordValue(message, "published-online");
  const firstPart = arrayValue(arrayValue(recordValue(published, "date-parts"))[0]);
  const rawAbstract = asString(recordValue(message, "abstract"))?.replace(/<[^>]+>/g, " ") ?? null;
  return finalizeMetadata({
    title: title || doi,
    abstract: rawAbstract,
    authors,
    year: typeof firstPart[0] === "number" ? firstPart[0] : null,
    venue: asString(arrayValue(recordValue(message, "container-title"))[0]),
  });
}

async function respectArxivSpacing(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const waitMs = nextArxivApiRequestAt - Date.now();
  nextArxivApiRequestAt = Math.max(Date.now(), nextArxivApiRequestAt) + minIntervalMs;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, minIntervalMs)));
  }
}

export async function resolveArxivMetadata(arxivId: string, options: PaperResolverOptions = {}): Promise<ResolvedPaperMetadata> {
  const key = cacheKey("arxiv", arxivId);
  if (!options.skipCache) {
    const cached = await readCachedMetadata(key);
    if (cached) return cached;
  }

  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = options.arxivMinIntervalMs ?? (process.env.NODE_ENV === "test" ? 0 : DEFAULT_ARXIV_MIN_INTERVAL_MS);

  const encodedId = encodeURIComponent(arxivId);
  const attempts: Array<() => Promise<ResolvedPaperMetadata | null>> = [
    async () => {
      await respectArxivSpacing(minIntervalMs);
      const xml = await fetchProviderText(fetcher, `https://export.arxiv.org/api/query?id_list=${encodedId}`, "application/atom+xml,text/xml,application/xml", timeoutMs);
      return parseArxivAtomXml(xml, arxivId);
    },
    async () => {
      const html = await fetchProviderText(fetcher, `https://arxiv.org/abs/${encodedId}`, "text/html,application/xhtml+xml", timeoutMs);
      return parseArxivAbsHtml(html);
    },
    async () => {
      const json = await fetchProviderJson(
        fetcher,
        `https://api.openalex.org/works/https://doi.org/10.48550/arXiv.${encodedId}?select=title,authorships,publication_year,abstract_inverted_index,primary_location`,
        timeoutMs,
      );
      return parseOpenAlexWork(json, "arXiv");
    },
    async () => {
      const json = await fetchProviderJson(
        fetcher,
        `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodedId}?fields=title,abstract,authors,year,venue`,
        timeoutMs,
      );
      return parseSemanticScholarPaper(json);
    },
  ];

  for (const attempt of attempts) {
    try {
      const resolved = await attempt();
      if (resolved) {
        if (!options.skipCache) await writeCachedMetadata(key, resolved);
        return resolved;
      }
    } catch {
      // Advance to the next metadata provider.
    }
  }

  throw sourceUnavailable();
}

export async function resolveDoiMetadata(doi: string, options: PaperResolverOptions = {}): Promise<ResolvedPaperMetadata> {
  const arxivFromDoi = doi.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  if (arxivFromDoi) {
    return resolveArxivMetadata(arxivFromDoi.toLowerCase().replace(/v\d+$/i, ""), options);
  }

  const key = cacheKey("doi", doi);
  if (!options.skipCache) {
    const cached = await readCachedMetadata(key);
    if (cached) return cached;
  }

  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const encodedDoi = encodeURIComponent(doi);

  const attempts: Array<() => Promise<ResolvedPaperMetadata | null>> = [
    async () => {
      const json = await fetchProviderJson(fetcher, `https://api.crossref.org/works/${encodedDoi}`, timeoutMs);
      return parseCrossrefWork(json, doi);
    },
    async () => {
      const json = await fetchProviderJson(
        fetcher,
        `https://api.openalex.org/works/https://doi.org/${encodedDoi}?select=title,authorships,publication_year,abstract_inverted_index,primary_location`,
        timeoutMs,
      );
      return parseOpenAlexWork(json);
    },
  ];

  for (const attempt of attempts) {
    try {
      const resolved = await attempt();
      if (resolved) {
        if (!options.skipCache) await writeCachedMetadata(key, resolved);
        return resolved;
      }
    } catch {
      // Advance to the next metadata provider.
    }
  }

  throw sourceUnavailable();
}

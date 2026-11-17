import { instantDiscovery } from "@learnspace/shared/exa-discovery";

export type PaperAuthor = { name: string };
export type ResearchPaper = {
  arxivId: string;
  title: string;
  abstract: string | null;
  authors: PaperAuthor[];
  publishedAt: string | null;
  canonicalUrl: string;
  score: number;
};

export type ResearchRetrieval = {
  papers: ResearchPaper[];
  partialFailures: string[];
  intent: "exact_title" | "identifier" | "author" | "topic" | "foundational" | "recent" | "comparative" | "prerequisite";
  durationMs: number;
  sourceCalls: number;
};

export type QueryPlan = { intent: ResearchRetrieval["intent"]; doi?: string; arxivId?: string; author?: string; search: string };
export type RetrievalOptions = {
  fetch?: typeof fetch;
  exaApiKey?: string;
  timeoutMs?: number;
  rankingIntent?: "best_match" | "foundational" | "recent";
};

function normalizeDoi(value: string): string | null {
  const doi = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().replace(/[),.;]+$/, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : null;
}

function normalizeArxiv(value: string): string | null {
  const id = value.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  return /^(?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})$/i.test(id) ? id.toLowerCase() : null;
}

export function understandResearchQuery(input: string): QueryPlan {
  const query = input.trim().replace(/\s+/g, " ").slice(0, 240);
  const doi = query.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s?#]+)/i)?.[1]?.replace(/[),.;]+$/, "").toLowerCase();
  const doiArxivId = doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  const arxivId = normalizeArxiv(doiArxivId ?? query.match(/(?:arxiv(?:\.org\/(?:abs|pdf)\/)?\s*[:/]?\s*)?((?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)/i)?.[1] ?? "");
  const foundational = /\b(original|foundational|seminal|first introduced|landmark)\b/i.test(query);
  const recent = /\b(recent|latest|new developments|newest|current)\b/i.test(query);
  const comparative = /\b(improve(?:s|d)? on|compared with|comparison|versus|vs\.|better than)\b/i.test(query);
  const prerequisite = /\b(read before|prerequisite|before understanding|what should i read before)\b/i.test(query);
  const authorMatch = query.match(/\b(?:papers? (?:by|from)|work by|author)\s+(.+?)(?:\s+(?:on|about|for)\s+.+)?$/i);
  const authorTopic = query.match(/\b(?:by|from)\s+.+?\s+(?:on|about|for)\s+(.+)$/i)?.[1];
  const quoted = query.match(/["“](.+?)["”]/)?.[1];
  const titleLike = query.split(/\s+/).length >= 4 && !/[?]$/.test(query) && !/\b(?:find|show|search|papers?|research|recent|latest|what|how|compare|improve|before|author)\b/i.test(query);
  const search = (quoted ?? authorTopic ?? authorMatch?.[1]?.trim() ?? query.replace(/^(?:find|show me|search for|papers? on|research papers? on|what papers? (?:introduced|explain|cover)|what should i read before|what papers? should i read before|find work that improves on|find papers? that improve on|research that improved|compare methods that make|what improves the)\s+/i, "").replace(/\b(?:papers? explaining|papers? that improve on|recent papers? on)\b/gi, "").replace(/\b(?:understanding|learning)\b/gi, "").replace(/\b(?:the|original|foundational|seminal|first|paper|work|algorithm|methods?|that)\b/gi, "").replace(/\s+/g, " ").trim()) || query;
  const intent: QueryPlan["intent"] = doi || arxivId ? "identifier" : prerequisite ? "prerequisite" : comparative ? "comparative" : foundational ? "foundational" : recent ? "recent" : authorMatch ? "author" : quoted || titleLike ? "exact_title" : "topic";
  return { intent, ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}), ...(authorMatch ? { author: authorMatch[1]!.trim() } : {}), search };
}

function titleKey(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function exaQuery(query: string, plan: QueryPlan): string {
  if (plan.arxivId) return plan.arxivId;
  if (plan.doi) return plan.doi;
  if (plan.intent === "author") return `research papers by ${plan.author} on ${plan.search}`;
  if (plan.intent === "prerequisite") return `foundational research papers needed to understand ${plan.search}`;
  return query.trim();
}

export async function retrieveResearchPapers(query: string, options: RetrievalOptions = {}): Promise<ResearchRetrieval> {
  const started = performance.now();
  const understood = understandResearchQuery(query);
  const plan = options.rankingIntent && options.rankingIntent !== "best_match" && !understood.doi && !understood.arxivId
    ? { ...understood, intent: options.rankingIntent }
    : understood;
  const exaApiKey = options.exaApiKey ?? process.env.EXA_API_KEY?.trim();
  if (!exaApiKey) return { papers: [], partialFailures: ["exa: EXA_API_KEY is not configured"], intent: plan.intent, durationMs: Math.round(performance.now() - started), sourceCalls: 0 };

  const explicitRankingIntent = options.rankingIntent === "foundational" || options.rankingIntent === "recent" ? options.rankingIntent : null;
  const explicitFoundationalSearch = /\b(original|seminal|landmark|first introduced)\b/i.test(query) || /\bfoundational\s+(?:paper|work)\b/i.test(query);
  const rankingIntent = explicitRankingIntent ?? (plan.intent === "foundational" && explicitFoundationalSearch ? "foundational" : plan.intent === "recent" ? "recent" : "best_match");
  const batch = await instantDiscovery({
    query_text: exaQuery(query, plan),
    source_kind: "paper",
    ranking_intent: rankingIntent,
    limit: 30,
  }, { exaApiKey, timeoutMs: options.timeoutMs ?? 4_000, ...(options.fetch ? { fetch: options.fetch } : {}) });

  const papers: ResearchPaper[] = [];
  const seenIds = new Set<string>();
  const seenDois = new Set<string>();
  const seenTitles = new Set<string>();
  for (const [rank, candidate] of batch.arxiv.entries()) {
    const arxivId = normalizeArxiv(candidate.arxiv_id);
    const title = candidate.title.trim();
    const titleIdentity = titleKey(title);
    const doi = normalizeDoi(`10.48550/arxiv.${arxivId ?? ""}`);
    if (!arxivId || title.length < 3 || !titleIdentity || seenIds.has(arxivId) || seenDois.has(doi ?? "") || seenTitles.has(titleIdentity)) continue;
    seenIds.add(arxivId);
    seenDois.add(doi ?? "");
    seenTitles.add(titleIdentity);
    papers.push({
      arxivId,
      title,
      abstract: candidate.abstract,
      authors: candidate.authors.map((name) => ({ name })),
      publishedAt: candidate.published_at,
      canonicalUrl: `https://arxiv.org/abs/${arxivId}`,
      score: 30 - rank,
    });
  }
  if (plan.arxivId) papers.sort((left, right) => Number(right.arxivId === plan.arxivId) - Number(left.arxivId === plan.arxivId));

  return {
    papers,
    partialFailures: batch.failures.map((failure) => failure.replace(/^instant:/, "exa:")),
    intent: plan.intent,
    durationMs: Math.round(performance.now() - started),
    sourceCalls: batch.provider_calls,
  };
}

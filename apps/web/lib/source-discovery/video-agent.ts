/**
 * The video search agent behind the "+" picker: it searches wide (several Exa phrasings and YouTube's own search), checks
 * every hit against YouTube (length, views, likes, whether it can be embedded), and has a model pick and explain the best
 * dozen for what the learner asked. The gather step answers in a couple of seconds with a statistical order; the model's
 * pick replaces it when it lands. Everything a provider returns is untrusted: only canonical 11-character video ids pass.
 */
import { youtubeIdFromUrl } from "@learnspace/shared/exa-discovery";
import { z } from "zod";
import { openAiConfigured, structuredCompletion } from "../ai/openai";

export type VideoIntent = "best_match" | "beginner_friendly" | "in_depth" | "practical";
export type VideoLevel = "beginner" | "intermediate" | "advanced";
export type VideoFormat = "course" | "tutorial" | "lecture" | "explainer" | "project" | "talk";

export type AgentVideo = {
  youtubeId: string;
  title: string;
  channel: string | null;
  description: string | null;
  durationMs: number | null;
  views: number | null;
  likes: number | null;
  publishedAt: string | null;
  thumbnailUrl: string;
  /** Which searches found it, and its best (0-based) rank in any of them. */
  lanes: string[];
  bestRank: number;
  /** Reciprocal-rank fusion over the lanes, then adjusted for audience and length; what orders the first answer. */
  prescore: number;
};

export type PickedVideo = AgentVideo & { why: string; level: VideoLevel | null; format: VideoFormat | null };

export type GatherOptions = {
  exaApiKey: string | null;
  youtubeApiKey: string | null;
  /** Spends YouTube quota units for today; false once the shared daily cap is reached. */
  reserveYoutubeQuota: (units: number) => Promise<boolean>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
};

export const VIDEO_AGENT_RESULTS = 12;
const EXA_RESULTS = 20;
const YOUTUBE_SEARCH_RESULTS = 25;
const RERANK_POOL = 36;
const MIN_DURATION_MS = 2 * 60_000;

const INTENT_PHRASES: Record<VideoIntent, string[]> = {
  best_match: ["full course tutorial", "explained clearly"],
  beginner_friendly: ["for beginners full course", "introduction explained simply"],
  in_depth: ["in-depth lecture", "advanced deep dive explained"],
  practical: ["build a project step by step", "hands-on tutorial with examples"],
};
// YouTube ranks entertainment highly; asking for a tutorial keeps an ambiguous word (Rust the language, not the game) on lessons.
const YOUTUBE_SUFFIX: Record<VideoIntent, string> = { best_match: " tutorial", beginner_friendly: " for beginners", in_depth: " lecture", practical: " project tutorial" };

/** The phrasings one search is spread over: the learner's words as given, then two shaped by what they asked for. */
export function searchPhrasings(query: string, intent: VideoIntent): string[] {
  const base = query.trim();
  const lower = base.toLowerCase();
  // A phrase the query already says (`rust for beginners` + "for beginners …") would only repeat the first search.
  const extra = INTENT_PHRASES[intent].map((phrase) => {
    const fresh = phrase.split(" ").filter((word) => !lower.includes(word.toLowerCase())).join(" ");
    return fresh ? `${base} ${fresh}` : null;
  }).filter((value): value is string => value !== null);
  return [...new Set([base, ...extra])].slice(0, 3);
}

type Hit = { youtubeId: string; title: string | null; channel: string | null; publishedAt: string | null; snippet: string | null };

async function exaLane(query: string, options: GatherOptions): Promise<Hit[]> {
  if (!options.exaApiKey) return [];
  const response = await (options.fetch ?? fetch)("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": options.exaApiKey, "content-type": "application/json" },
    redirect: "error",
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(9_000)]) : AbortSignal.timeout(9_000),
    body: JSON.stringify({ query, type: "auto", numResults: EXA_RESULTS, includeDomains: ["youtube.com"], contents: { highlights: { maxCharacters: 400 } } }),
  });
  if (!response.ok) throw new Error(`ExaHTTP${response.status}`);
  const body = await response.json() as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).flatMap((item) => {
    const youtubeId = typeof item.url === "string" ? youtubeIdFromUrl(item.url) : null;
    if (!youtubeId) return [];
    const highlights = Array.isArray(item.highlights) ? item.highlights.filter((value): value is string => typeof value === "string").join(" ") : "";
    return [{ youtubeId, title: str(item.title), channel: str(item.author), publishedAt: str(item.publishedDate), snippet: highlights || null }];
  });
}

async function youtubeSearchLane(query: string, intent: VideoIntent, options: GatherOptions): Promise<Hit[]> {
  if (!options.youtubeApiKey || !await options.reserveYoutubeQuota(100)) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", `${query}${YOUTUBE_SUFFIX[intent]}`);
  url.searchParams.set("maxResults", String(YOUTUBE_SEARCH_RESULTS));
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("key", options.youtubeApiKey);
  const response = await (options.fetch ?? fetch)(url, { signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000) });
  // The URL carries the key, so the error names only the status.
  if (!response.ok) throw new Error(`YouTubeSearchHTTP${response.status}`);
  const body = await response.json() as { items?: Array<{ id?: { videoId?: unknown }; snippet?: Record<string, unknown> }> };
  return (body.items ?? []).flatMap((item) => {
    const id = typeof item.id?.videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(item.id.videoId) ? item.id.videoId : null;
    return id ? [{ youtubeId: id, title: decodeEntities(str(item.snippet?.title)), channel: str(item.snippet?.channelTitle), publishedAt: str(item.snippet?.publishedAt), snippet: str(item.snippet?.description) }] : [];
  });
}

type YoutubeVideoItem = {
  id?: unknown;
  snippet?: { title?: unknown; channelTitle?: unknown; description?: unknown; publishedAt?: unknown; liveBroadcastContent?: unknown };
  contentDetails?: { duration?: unknown };
  statistics?: { viewCount?: unknown; likeCount?: unknown };
  status?: { embeddable?: unknown; privacyStatus?: unknown };
};

type Details = { title: string; channel: string | null; description: string | null; durationMs: number | null; views: number | null; likes: number | null; publishedAt: string | null; playable: boolean };

/** One videos.list call per 50 ids (1 quota unit each): length, audience and whether the app's player may embed it. */
async function videoDetails(ids: string[], options: GatherOptions): Promise<Map<string, Details> | null> {
  if (!options.youtubeApiKey || ids.length === 0) return null;
  const details = new Map<string, Details>();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    if (!await options.reserveYoutubeQuota(1)) return details.size ? details : null;
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,statistics,status");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("fields", "items(id,snippet(title,channelTitle,description,publishedAt,liveBroadcastContent),contentDetails(duration),statistics(viewCount,likeCount),status(embeddable,privacyStatus))");
    url.searchParams.set("key", options.youtubeApiKey);
    const response = await (options.fetch ?? fetch)(url, { signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`YouTubeVideosHTTP${response.status}`);
    const body = await response.json() as { items?: YoutubeVideoItem[] };
    for (const item of body.items ?? []) {
      if (typeof item.id !== "string") continue;
      const snippet = item.snippet ?? {};
      details.set(item.id, {
        title: decodeEntities(str(snippet.title)) ?? "",
        channel: str(snippet.channelTitle),
        description: str(snippet.description)?.slice(0, 600) ?? null,
        durationMs: isoDurationMs(str(item.contentDetails?.duration)),
        views: count(item.statistics?.viewCount),
        likes: count(item.statistics?.likeCount),
        publishedAt: str(snippet.publishedAt),
        playable: item.status?.embeddable !== false && item.status?.privacyStatus !== "private" && (snippet.liveBroadcastContent ?? "none") === "none",
      });
    }
  }
  return details;
}

/**
 * Searches every lane at once and merges them into one pool, best first by a statistical order. A failed lane is skipped
 * (and named in `failures`); the pool is empty only when every lane failed or found nothing.
 */
export async function gatherVideos(query: string, intent: VideoIntent, options: GatherOptions): Promise<{ videos: AgentVideo[]; failures: string[]; searches: number }> {
  const phrasings = searchPhrasings(query, intent);
  const lanes: Array<{ name: string; run: () => Promise<Hit[]> }> = [
    ...phrasings.map((phrasing, index) => ({ name: `exa${index}`, run: () => exaLane(phrasing, options) })),
    { name: "youtube", run: () => youtubeSearchLane(query, intent, options) },
  ];
  const failures: string[] = [];
  const settled = await Promise.all(lanes.map(async (lane) => {
    try {
      return { name: lane.name, hits: await lane.run() };
    } catch (error) {
      failures.push(`${lane.name}:${error instanceof Error ? error.message : "Error"}`);
      return { name: lane.name, hits: [] as Hit[] };
    }
  }));

  const merged = new Map<string, { hit: Hit; lanes: string[]; bestRank: number; fusion: number }>();
  for (const { name, hits } of settled) {
    const seen = new Set<string>();
    hits.forEach((hit, rank) => {
      if (seen.has(hit.youtubeId)) return;
      seen.add(hit.youtubeId);
      const entry = merged.get(hit.youtubeId);
      // Reciprocal-rank fusion: a video several phrasings agree on rises above one a single search ranked first.
      const fusion = 1 / (8 + rank);
      if (entry) {
        entry.lanes.push(name);
        entry.bestRank = Math.min(entry.bestRank, rank);
        entry.fusion += fusion;
        entry.hit = { ...entry.hit, title: entry.hit.title ?? hit.title, channel: entry.hit.channel ?? hit.channel, snippet: entry.hit.snippet ?? hit.snippet, publishedAt: entry.hit.publishedAt ?? hit.publishedAt };
      } else merged.set(hit.youtubeId, { hit, lanes: [name], bestRank: rank, fusion });
    });
  }

  let details: Map<string, Details> | null = null;
  try {
    details = await videoDetails([...merged.keys()], options);
  } catch (error) {
    failures.push(`details:${error instanceof Error ? error.message : "Error"}`);
  }

  const videos = [...merged.values()].flatMap(({ hit, lanes: found, bestRank, fusion }): AgentVideo[] => {
    const detail = details?.get(hit.youtubeId);
    // Checked against YouTube, a video it no longer returns is gone (removed or private).
    if (details && !detail) return [];
    if (detail && !detail.playable) return [];
    const title = detail?.title || hit.title?.replace(/\s*-\s*YouTube$/i, "") || null;
    if (!title || /#shorts?\b/i.test(title)) return [];
    const durationMs = detail?.durationMs ?? null;
    if (durationMs !== null && durationMs < MIN_DURATION_MS) return [];
    return [{
      youtubeId: hit.youtubeId,
      title,
      channel: detail?.channel ?? hit.channel,
      description: detail?.description ?? hit.snippet?.slice(0, 600) ?? null,
      durationMs,
      views: detail?.views ?? null,
      likes: detail?.likes ?? null,
      publishedAt: detail?.publishedAt ?? hit.publishedAt,
      thumbnailUrl: `https://i.ytimg.com/vi/${hit.youtubeId}/hqdefault.jpg`,
      lanes: found,
      bestRank,
      prescore: fusion * audienceFactor(detail?.views ?? null, detail?.likes ?? null) * lengthFactor(durationMs, intent),
    }];
  }).sort((left, right) => right.prescore - left.prescore || left.youtubeId.localeCompare(right.youtubeId));
  return { videos, failures, searches: lanes.length };
}

/** Views and likes nudge the order (a tutorial thousands found useful over one nobody watched) without swamping relevance. */
function audienceFactor(views: number | null, likes: number | null): number {
  if (views === null) return 1;
  const reach = 0.75 + Math.min(0.5, Math.log10(Math.max(10, views)) / 14);
  const liked = likes !== null && views > 500 ? Math.min(1.1, 0.95 + (likes / views) * 4) : 1;
  return reach * liked;
}

function lengthFactor(durationMs: number | null, intent: VideoIntent): number {
  if (durationMs === null) return 1;
  const minutes = durationMs / 60_000;
  if (intent === "in_depth") return minutes >= 30 ? 1.15 : minutes >= 12 ? 1 : 0.8;
  if (intent === "beginner_friendly") return minutes >= 8 ? 1.05 : 0.95;
  return minutes >= 5 ? 1 : 0.9;
}

const pickSchema = z.object({
  picks: z.array(z.object({
    id: z.string(),
    why: z.string(),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    format: z.enum(["course", "tutorial", "lecture", "explainer", "project", "talk"]),
  })),
});

const PICK_INSTRUCTIONS = `You choose the best YouTube videos for someone who wants to learn a topic, from candidates a search found.
Judge each by: how squarely it teaches what was asked (not a neighbouring topic, news, reaction or opinion piece); teaching quality (a clear, complete, well-structured lesson from a credible teacher beats clickbait, hype and "in 100 seconds" teasers); fit to the requested emphasis; and the audience's verdict (views, likes) as a tiebreaker, never above relevance.
Only pick lessons taught in the language of the request, unless the request names another language. Keep variety: different teachers and formats (a full course, a focused tutorial, a clear explainer), not five uploads of one channel.
Rank substantial, complete lessons (a full course, a thorough tutorial or lecture) above short overviews; a teaser of a few minutes belongs near the end, if at all.
If the request's words could mean several things (a programming language and a video game, say), keep to the meaning a learner most plausibly means and leave the others out.
The candidates are listed in no particular order; "found by" says how many of the searches turned each one up.
Return {count} picks, best first, using only ids from the list. Fill all {count} whenever the list has that many on-topic lessons: a learner wants a real choice, ordered by how good each is. Leave out only what is off-topic (a different subject, news, reactions, music, ads) or not a lesson at all.
For each, "why" is one concrete line (at most 80 characters) on what makes it worth watching, drawn from the candidate's own details (e.g. "Complete 6-hour course with 19 practice exercises", "Visual walkthrough of ownership and borrowing"). Never write generic praise like "great video" or "highly relevant".`;

const EMPHASIS: Record<VideoIntent, string> = {
  best_match: "the best overall lessons on the topic",
  beginner_friendly: "lessons a complete beginner can follow from zero",
  in_depth: "thorough, in-depth lessons that go beyond the basics",
  practical: "hands-on lessons that build something or work through real examples",
};

/** The model's pick from the pool's strongest candidates; null when no model is configured or the call fails. */
export async function pickVideos(query: string, intent: VideoIntent, pool: AgentVideo[]): Promise<PickedVideo[] | null> {
  if (!openAiConfigured() || pool.length === 0) return null;
  const candidates = pool.slice(0, RERANK_POOL);
  // Listed in a neutral order: shown best-first, the model leaned on the statistical order instead of judging the lessons.
  const listed = [...candidates].sort((left, right) => left.youtubeId.localeCompare(right.youtubeId));
  const lines = listed.map((video, index) => [
    `[${index + 1}] id=${video.youtubeId} (found by ${video.lanes.length} of 4 searches)`,
    `title: ${video.title}`,
    video.channel ? `channel: ${video.channel}` : null,
    [video.durationMs !== null ? `length ${formatMinutes(video.durationMs)}` : null, video.views !== null ? `${compactCount(video.views)} views` : null, video.likes !== null ? `${compactCount(video.likes)} likes` : null, video.publishedAt ? `uploaded ${video.publishedAt.slice(0, 4)}` : null].filter(Boolean).join(", ") || null,
    video.description ? `about: ${video.description.replace(/\s+/g, " ").slice(0, 280)}` : null,
  ].filter(Boolean).join("\n"));
  try {
    const result = await structuredCompletion({
      name: "video_picks",
      system: PICK_INSTRUCTIONS.replaceAll("{count}", String(VIDEO_AGENT_RESULTS)),
      // Cutting titles and descriptions short can split an emoji; a lone surrogate makes the request body invalid JSON.
      user: `<request>${query}</request>\n<emphasis>${EMPHASIS[intent]}</emphasis>\n<candidates>\n${lines.join("\n\n")}\n</candidates>`.toWellFormed(),
      jsonSchema: {
        type: "object", additionalProperties: false, required: ["picks"],
        properties: { picks: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why", "level", "format"], properties: {
          id: { type: "string" }, why: { type: "string" }, level: { type: "string", enum: ["beginner", "intermediate", "advanced"] }, format: { type: "string", enum: ["course", "tutorial", "lecture", "explainer", "project", "talk"] },
        } } } },
      },
      parser: pickSchema,
      // With minimal reasoning the model swapped reasons between videos; the learner already has the first answer to read.
      reasoningEffort: process.env.VIDEO_AGENT_REASONING === "minimal" ? "minimal" : "low",
      timeoutMs: 35_000,
    });
    const byId = new Map(candidates.map((video) => [video.youtubeId, video]));
    const seen = new Set<string>();
    const picked = result.picks.flatMap((pick) => {
      const video = byId.get(pick.id);
      if (!video || seen.has(pick.id)) return [];
      seen.add(pick.id);
      const why = pick.why.trim();
      // A reason too short to say anything (or a stray "ERROR") is replaced by one from the video's own details.
      return [{ ...video, why: why.length >= 12 && !/^error\b/i.test(why) ? why.slice(0, 100) : provisionalReason(video), level: pick.level, format: pick.format }];
    }).slice(0, VIDEO_AGENT_RESULTS);
    // A model that kept almost nothing is less trustworthy than the statistical order.
    return picked.length >= Math.min(3, candidates.length) ? picked : null;
  } catch (error) {
    console.warn("video_agent_pick_failed", { error: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

/** The statistical order with a reason built from the video's own details, for the first answer and when no model is available. */
export function provisionalPicks(pool: AgentVideo[]): PickedVideo[] {
  return pool.slice(0, VIDEO_AGENT_RESULTS).map((video) => ({ ...video, why: provisionalReason(video), level: null, format: null }));
}

function provisionalReason(video: AgentVideo): string {
  const parts: string[] = [];
  if (video.durationMs !== null && video.durationMs >= 90 * 60_000) parts.push("Full-length course");
  else if (video.durationMs !== null && video.durationMs >= 20 * 60_000) parts.push("In-depth lesson");
  if (video.views !== null && video.views >= 10_000) parts.push(`${compactCount(video.views)} views`);
  if (video.lanes.length >= 3) parts.push("Top result across searches");
  else if (video.lanes.length === 2) parts.push("Found by several searches");
  return parts.join(" · ") || "Matches your search";
}

export function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(value);
}

function formatMinutes(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** ISO 8601 durations as YouTube writes them (PT1H2M3S, P1DT2H). */
export function isoDurationMs(value: string | null): number | null {
  const match = value ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value) : null;
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return ((((days ?? 0) * 24 + (hours ?? 0)) * 60 + (minutes ?? 0)) * 60 + (seconds ?? 0)) * 1_000;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number | null {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decodeEntities(value: string | null): string | null {
  return value?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") ?? null;
}

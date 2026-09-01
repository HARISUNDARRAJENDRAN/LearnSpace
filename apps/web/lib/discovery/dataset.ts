import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { extname } from "node:path";
import { youtubeIdFromUrl } from "@learnspace/shared";

export type DatasetRow = Record<string, string>;

export type NormalizedYoutubeRow = {
  youtubeId: string;
  canonicalUrl: string;
  title: string;
  description: string | null;
  channelTitle: string | null;
  channelId: string | null;
  durationMs: number | null;
  language: string | null;
  categoryLabels: string[];
  publishedAt: Date | null;
  metricsCapturedAt: Date | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  sourceRecordHash: string;
  sourceRecord: DatasetRow;
};

export type DatasetProfile = {
  dataset: string;
  licence: string | null;
  rowCount: number;
  uniqueYoutubeIds: number;
  duplicateYoutubeIds: number;
  invalidUrls: number;
  nullRates: Record<string, number>;
  missingFields: Record<string, number>;
  categoryDistribution: Record<string, number>;
  languageDistribution: Record<string, number>;
  publishDateRange: { min: string | null; max: string | null };
  metricCaptureDates: string[];
};

const fieldAliases = {
  id: ["youtube_id", "youtubeid", "video_id", "videoid", "id", "url", "video_url", "link"],
  title: ["title", "video_title", "name"],
  description: ["description", "video_description", "summary"],
  channelTitle: ["channel_title", "channel", "channel_name", "author", "uploader"],
  channelId: ["channel_id", "channelid"],
  duration: ["duration", "duration_ms", "duration_seconds", "length"],
  language: ["language", "lang", "default_audio_language"],
  category: ["category", "categories", "topic", "topics", "tags", "subject"],
  publishedAt: ["published_at", "publishedat", "publish_date", "published_date", "date", "upload_date"],
  metricsCapturedAt: ["metrics_captured_at", "captured_at", "metric_date", "snapshot_date", "scraped_at"],
  views: ["view_count", "views", "viewcount"],
  likes: ["like_count", "likes", "likecount"],
  comments: ["comment_count", "comments", "commentcount"],
} as const;

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizedRow(row: DatasetRow): Map<string, string> {
  return new Map(Object.entries(row).map(([key, value]) => [normalizedKey(key), value.trim()]));
}

function valueEntryFor(row: DatasetRow, names: readonly string[]): { name: string; value: string } | null {
  const normalized = normalizedRow(row);
  for (const name of names) {
    const value = normalized.get(name);
    if (value) return { name, value };
  }
  return null;
}

function valueFor(row: DatasetRow, names: readonly string[]): string | null {
  return valueEntryFor(row, names)?.value ?? null;
}

function splitLabels(value: string | null): string[] {
  return value
    ? value.split(/[|,;/]/).map((item) => item.trim()).filter(Boolean)
    : [];
}

export function canonicalYoutubeId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return youtubeIdFromUrl(trimmed);
}

export type DurationUnit = "milliseconds" | "seconds" | "auto";

export function parseDurationMs(value: string | null, unit: DurationUnit = "auto"): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const numeric = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/i);
  if (numeric) {
    const amount = Number(numeric[1]);
    const suffix = numeric[2]?.toLowerCase();
    const multiplier = suffix === "ms" || (!suffix && unit === "milliseconds") ? 1 : 1000;
    return Number.isSafeInteger(amount * multiplier) ? Math.round(amount * multiplier) : null;
  }
  const iso = trimmed.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso && (iso[1] !== undefined || iso[2] !== undefined || iso[3] !== undefined)) {
    return Math.round((Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0)) * 1000);
  }
  const clock = trimmed.split(":").map(Number);
  if (clock.every(Number.isFinite) && (clock.length === 2 || clock.length === 3)) {
    const secondsPart = clock.at(-1) ?? -1;
    const minutesPart = clock.length === 2 ? clock[0] : clock[1];
    const hoursPart = clock.length === 3 ? clock[0] : 0;
    if (secondsPart < 0 || secondsPart >= 60 || (minutesPart ?? -1) < 0 || (clock.length === 3 && (minutesPart ?? 60) >= 60)) return null;
    const seconds = (hoursPart ?? 0) * 3600 + (minutesPart ?? 0) * 60 + secondsPart;
    return seconds >= 0 ? Math.round(seconds * 1000) : null;
  }
  return null;
}

function durationFor(row: DatasetRow): number | null {
  const milliseconds = valueEntryFor(row, ["duration_ms"]);
  if (milliseconds) return parseDurationMs(milliseconds.value, "milliseconds");
  const seconds = valueEntryFor(row, ["duration_seconds"]);
  if (seconds) return parseDurationMs(seconds.value, "seconds");
  const generic = valueEntryFor(row, ["duration", "length"]);
  return generic ? parseDurationMs(generic.value) : null;
}

function parseCount(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value.replaceAll(",", "").replaceAll(" ", ""));
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableRecordHash(row: DatasetRow): string {
  const stable = Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function normalizeYoutubeRow(row: DatasetRow): NormalizedYoutubeRow | null {
  const rawId = valueFor(row, fieldAliases.id);
  const youtubeId = canonicalYoutubeId(rawId);
  const title = valueFor(row, fieldAliases.title);
  if (!youtubeId || !title) return null;
  return {
    youtubeId,
    canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    title,
    description: valueFor(row, fieldAliases.description),
    channelTitle: valueFor(row, fieldAliases.channelTitle),
    channelId: valueFor(row, fieldAliases.channelId),
    durationMs: durationFor(row),
    language: valueFor(row, fieldAliases.language),
    categoryLabels: splitLabels(valueFor(row, fieldAliases.category)),
    publishedAt: parseDate(valueFor(row, fieldAliases.publishedAt)),
    metricsCapturedAt: parseDate(valueFor(row, fieldAliases.metricsCapturedAt)),
    viewCount: parseCount(valueFor(row, fieldAliases.views)),
    likeCount: parseCount(valueFor(row, fieldAliases.likes)),
    commentCount: parseCount(valueFor(row, fieldAliases.comments)),
    sourceRecordHash: stableRecordHash(row),
    sourceRecord: row,
  };
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

export function parseCsvLine(line: string): string[] {
  return parseDelimitedLine(line, ",");
}

function hasOpenQuote(value: string): boolean {
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '"') continue;
    if (quoted && value[index + 1] === '"') {
      index += 1;
      continue;
    }
    quoted = !quoted;
  }
  return quoted;
}

async function* rowsFromDelimitedFile(filePath: string): AsyncGenerator<DatasetRow> {
  const delimiter = extname(filePath).toLowerCase() === ".tsv" ? "\t" : ",";
  const input = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let headers: string[] | null = null;
  let record = "";
  for await (const line of input) {
    if (!record && !line.trim()) continue;
    record = record ? `${record}\n${line}` : line;
    if (hasOpenQuote(record)) continue;
    const values = parseDelimitedLine(record, delimiter);
    record = "";
    if (!headers) {
      headers = values.map((value) => value.trim());
      continue;
    }
    yield Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  }
  if (record) throw new Error("Delimited dataset ended inside a quoted field");
}

async function* rowsFromJsonFile(filePath: string): AsyncGenerator<DatasetRow> {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(value)) throw new Error("JSON dataset must contain an array of records");
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      yield Object.fromEntries(Object.entries(item).map(([key, field]) => [key, String(field ?? "")]));
    }
  }
}

export async function* datasetRows(filePath: string): AsyncGenerator<DatasetRow> {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".json") {
    yield* rowsFromJsonFile(filePath);
    return;
  }
  yield* rowsFromDelimitedFile(filePath);
}

export async function profileYoutubeDataset(
  filePath: string,
  licence: string | null,
): Promise<DatasetProfile> {
  const seenIds = new Set<string>();
  const categoryDistribution: Record<string, number> = {};
  const languageDistribution: Record<string, number> = {};
  const nullCounts: Record<string, number> = {};
  const missingFields: Record<string, number> = {};
  const metricCaptureDates = new Set<string>();
  let rowCount = 0;
  let duplicateYoutubeIds = 0;
  let invalidUrls = 0;
  let minPublishedAt: Date | null = null;
  let maxPublishedAt: Date | null = null;

  for await (const row of datasetRows(filePath)) {
    rowCount += 1;
    const rawId = valueFor(row, fieldAliases.id);
    const rawFields: Array<[string, string | null]> = [
      ["id", rawId],
      ["title", valueFor(row, fieldAliases.title)],
      ["description", valueFor(row, fieldAliases.description)],
      ["channelTitle", valueFor(row, fieldAliases.channelTitle)],
      ["duration", valueFor(row, fieldAliases.duration)],
      ["language", valueFor(row, fieldAliases.language)],
      ["publishedAt", valueFor(row, fieldAliases.publishedAt)],
      ["metricsCapturedAt", valueFor(row, fieldAliases.metricsCapturedAt)],
      ["viewCount", valueFor(row, fieldAliases.views)],
      ["likeCount", valueFor(row, fieldAliases.likes)],
      ["commentCount", valueFor(row, fieldAliases.comments)],
    ];
    for (const [field, value] of rawFields) {
      if (value === null) {
        nullCounts[field] = (nullCounts[field] ?? 0) + 1;
        missingFields[field] = (missingFields[field] ?? 0) + 1;
      }
    }
    if (!canonicalYoutubeId(rawId)) invalidUrls += 1;
    const normalized = normalizeYoutubeRow(row);
    if (!normalized) {
      continue;
    }
    if (seenIds.has(normalized.youtubeId)) duplicateYoutubeIds += 1;
    seenIds.add(normalized.youtubeId);
    for (const label of normalized.categoryLabels) categoryDistribution[label] = (categoryDistribution[label] ?? 0) + 1;
    if (normalized.language) languageDistribution[normalized.language] = (languageDistribution[normalized.language] ?? 0) + 1;
    if (normalized.metricsCapturedAt) metricCaptureDates.add(normalized.metricsCapturedAt.toISOString().slice(0, 10));
    if (normalized.publishedAt && (!minPublishedAt || normalized.publishedAt < minPublishedAt)) minPublishedAt = normalized.publishedAt;
    if (normalized.publishedAt && (!maxPublishedAt || normalized.publishedAt > maxPublishedAt)) maxPublishedAt = normalized.publishedAt;
  }

  return {
    dataset: "harisundarrajendran/educational-youtube-content",
    licence,
    rowCount,
    uniqueYoutubeIds: seenIds.size,
    duplicateYoutubeIds,
    invalidUrls,
    nullRates: Object.fromEntries(Object.entries(nullCounts).map(([field, count]) => [field, rowCount === 0 ? 0 : count / rowCount])),
    missingFields,
    categoryDistribution,
    languageDistribution,
    publishDateRange: {
      min: minPublishedAt?.toISOString() ?? null,
      max: maxPublishedAt?.toISOString() ?? null,
    },
    metricCaptureDates: [...metricCaptureDates].sort(),
  };
}

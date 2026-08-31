import postgres from "postgres";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { profileYoutubeDataset, datasetRows, normalizeYoutubeRow, type NormalizedYoutubeRow } from "../lib/discovery/dataset";
import { scoreYoutubeQuality } from "../lib/discovery/quality";

const datasetName = "harisundarrajendran/educational-youtube-content";
const allowedLicences = ["cc0", "cc by", "cc by 4.0", "cc by-sa", "cc by-sa 4.0", "mit", "apache 2.0", "odc-pddl", "odc-by"];

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function normaliseLabel(value: string): string {
  return value.toLowerCase().trim().replaceAll(/[^a-z0-9]+/g, " ").replaceAll(/\s+/g, " ");
}

function readLicence(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).licenseName ?? (metadata as Record<string, unknown>).license;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function datasetLicence(inputPath: string): Promise<string | null> {
  const explicit = argument("--license") ?? process.env.DISCOVERY_DATASET_LICENSE;
  if (explicit) return explicit;
  try {
    const metadata = JSON.parse(await readFile(resolve(dirname(inputPath), "dataset-metadata.json"), "utf8")) as unknown;
    return readLicence(metadata);
  } catch {
    return null;
  }
}

function assertLicence(licence: string | null): asserts licence is string {
  if (!licence || !allowedLicences.some((allowed) => licence.toLowerCase().startsWith(allowed))) {
    throw new Error(`Refusing import: dataset licence is missing or not approved for this use (${licence ?? "unknown"}).`);
  }
}

type ConceptRow = { id: string; slug: string; name: string };

async function loadConceptMap(sql: ReturnType<typeof postgres>): Promise<Map<string, string>> {
  const concepts = await sql<ConceptRow[]>`SELECT id, slug, name FROM knowledge.concepts WHERE status = 'active'`;
  const aliases = await sql<{ concept_id: string; alias: string; normalized_alias: string }[]>`SELECT concept_id, alias, normalized_alias FROM knowledge.concept_aliases`;
  const map = new Map<string, string>();
  for (const concept of concepts) {
    map.set(normaliseLabel(concept.slug), concept.id);
    map.set(normaliseLabel(concept.name), concept.id);
  }
  for (const alias of aliases) {
    map.set(normaliseLabel(alias.alias), alias.concept_id);
    map.set(normaliseLabel(alias.normalized_alias), alias.concept_id);
  }
  return map;
}

const explicitLabelMappings: Record<string, string[]> = {
  ai: ["ai-machine-learning", "artificial intelligence", "machine learning"],
  "machine learning": ["ai-machine-learning"],
  "data science": ["data-science"],
  programming: ["programming-computer-science"],
  "computer science": ["programming-computer-science"],
  web: ["web-development"],
  "web development": ["web-development"],
  devops: ["devops-cloud"],
  cloud: ["devops-cloud"],
  cybersecurity: ["cybersecurity"],
  mathematics: ["mathematics-statistics"],
  statistics: ["mathematics-statistics"],
  physics: ["physics"],
  biology: ["biology"],
  english: ["english-language-learning"],
  communication: ["communication-public-speaking"],
};

function resolveConcepts(row: NormalizedYoutubeRow, conceptMap: Map<string, string>): string[] {
  const ids = new Set<string>();
  for (const label of row.categoryLabels) {
    const normalized = normaliseLabel(label);
    const direct = conceptMap.get(normalized);
    if (direct) ids.add(direct);
    for (const mapped of explicitLabelMappings[normalized] ?? []) {
      const id = conceptMap.get(normaliseLabel(mapped));
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function importBatch(
  sql: ReturnType<typeof postgres>,
  rows: NormalizedYoutubeRow[],
  conceptMap: Map<string, string>,
  importedAt: Date,
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const row of rows) {
      const quality = scoreYoutubeQuality({
        title: row.title,
        description: row.description,
        channelTitle: row.channelTitle,
        durationMs: row.durationMs,
        publishedAt: row.publishedAt,
        viewCount: row.viewCount,
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        metricsCapturedAt: row.metricsCapturedAt,
      }, importedAt);
      const [resource] = await tx<{ id: string }[]>`
        INSERT INTO catalog.resources
          (owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
        VALUES
          (NULL, 'video', 'youtube', ${row.youtubeId}, ${row.canonicalUrl}, ${row.title}, ${row.description}, ${row.language}, 'public', 'ready', ${quality.finalQualityScore}, ${JSON.stringify({
            dataset: datasetName,
            sourceRecordHash: row.sourceRecordHash,
            mappingVersion: "youtube-dataset-v1",
            thumbnailUrl: `https://i.ytimg.com/vi/${row.youtubeId}/hqdefault.jpg`,
          })}::jsonb)
        ON CONFLICT (provider, external_id) WHERE owner_user_id IS NULL AND external_id IS NOT NULL DO UPDATE SET
          canonical_url = EXCLUDED.canonical_url,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          language = EXCLUDED.language,
          status = EXCLUDED.status,
          quality_score = EXCLUDED.quality_score,
          metadata = EXCLUDED.metadata,
          updated_at = ${importedAt}
        RETURNING id
      `;
      if (!resource) throw new Error(`Could not persist YouTube resource ${row.youtubeId}`);
      await tx`
        INSERT INTO catalog.video_details
          (resource_id, youtube_id, channel_id, channel_title, duration_ms, published_at, default_audio_language, latest_view_count, latest_like_count, latest_comment_count, metrics_captured_at, fetched_at)
        VALUES
          (${resource.id}, ${row.youtubeId}, ${row.channelId}, ${row.channelTitle}, ${row.durationMs}, ${row.publishedAt}, ${row.language}, ${row.viewCount}, ${row.likeCount}, ${row.commentCount}, ${row.metricsCapturedAt}, ${importedAt})
        ON CONFLICT (resource_id) DO UPDATE SET
          channel_id = EXCLUDED.channel_id,
          channel_title = EXCLUDED.channel_title,
          duration_ms = EXCLUDED.duration_ms,
          published_at = EXCLUDED.published_at,
          default_audio_language = EXCLUDED.default_audio_language,
          latest_view_count = EXCLUDED.latest_view_count,
          latest_like_count = EXCLUDED.latest_like_count,
          latest_comment_count = EXCLUDED.latest_comment_count,
          metrics_captured_at = EXCLUDED.metrics_captured_at,
          fetched_at = EXCLUDED.fetched_at
      `;
      if (row.metricsCapturedAt && (row.viewCount !== null || row.likeCount !== null || row.commentCount !== null)) {
        await tx`
          INSERT INTO catalog.video_metric_snapshots (resource_id, captured_at, view_count, like_count, comment_count)
          VALUES (${resource.id}, ${row.metricsCapturedAt}, ${row.viewCount}, ${row.likeCount}, ${row.commentCount})
          ON CONFLICT (resource_id, captured_at) DO UPDATE SET
            view_count = EXCLUDED.view_count,
            like_count = EXCLUDED.like_count,
            comment_count = EXCLUDED.comment_count
        `;
      }
      await tx`
        INSERT INTO discovery.resource_quality_snapshots
          (resource_id, feature_version, captured_at, bayesian_engagement, comment_quality, freshness_prior, content_coverage, source_authority, final_quality_score, features)
        VALUES
          (${resource.id}, 'youtube-quality-v1', ${importedAt}, ${quality.bayesianEngagement}, ${quality.commentQuality}, ${quality.freshnessPrior}, ${quality.contentCoverage}, ${quality.sourceAuthority}, ${quality.finalQualityScore}, ${JSON.stringify(quality.features)}::jsonb)
        ON CONFLICT (resource_id, feature_version, captured_at) DO UPDATE SET
          bayesian_engagement = EXCLUDED.bayesian_engagement,
          comment_quality = EXCLUDED.comment_quality,
          freshness_prior = EXCLUDED.freshness_prior,
          content_coverage = EXCLUDED.content_coverage,
          source_authority = EXCLUDED.source_authority,
          final_quality_score = EXCLUDED.final_quality_score,
          features = EXCLUDED.features
      `;
      for (const conceptId of resolveConcepts(row, conceptMap)) {
        await tx`
          INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary, extractor_version)
          VALUES (${resource.id}, ${conceptId}, 'youtube-dataset', 0.75, false, 'youtube-dataset-mapping-v1')
          ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET
            relevance = EXCLUDED.relevance,
            extractor_version = EXCLUDED.extractor_version
        `;
      }
    }
  });
}

async function main(): Promise<void> {
  const input = argument("--input") ?? process.env.DISCOVERY_YOUTUBE_DATASET_FILE;
  if (!input) throw new Error("Use --input <csv|tsv|json> or DISCOVERY_YOUTUBE_DATASET_FILE.");
  const inputPath = resolve(input);
  const licence = await datasetLicence(inputPath);
  assertLicence(licence);
  const profile = await profileYoutubeDataset(inputPath, licence);
  const profilePath = resolve(process.env.DISCOVERY_PROFILE_OUTPUT ?? "../../artifacts/discovery/youtube-dataset-profile.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  process.stdout.write(`Profiled ${profile.rowCount} rows; ${profile.uniqueYoutubeIds} unique YouTube IDs; ${profile.duplicateYoutubeIds} duplicates; ${profile.invalidUrls} rejected.\n`);
  if (process.argv.includes("--profile-only")) return;

  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for catalog import");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const conceptMap = await loadConceptMap(sql);
  const importedAt = new Date(process.env.DISCOVERY_IMPORT_CAPTURED_AT ?? new Date().toISOString());
  const seenIds = new Set<string>();
  let importedRows = 0;
  let rejectedRows = 0;
  let duplicateRows = 0;
  let batch: NormalizedYoutubeRow[] = [];
  try {
    for await (const rawRow of datasetRows(inputPath)) {
      const row = normalizeYoutubeRow(rawRow);
      if (!row) {
        rejectedRows += 1;
        continue;
      }
      if (seenIds.has(row.youtubeId)) {
        duplicateRows += 1;
        continue;
      }
      seenIds.add(row.youtubeId);
      batch.push(row);
      if (batch.length >= 100) {
        await importBatch(sql, batch, conceptMap, importedAt);
        importedRows += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await importBatch(sql, batch, conceptMap, importedAt);
      importedRows += batch.length;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.stdout.write(`Imported ${importedRows} rows; ${duplicateRows} duplicate rows skipped; ${rejectedRows} malformed rows rejected.\n`);
}

await main();

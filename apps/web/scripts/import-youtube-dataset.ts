import postgres from "postgres";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { profileYoutubeDataset, datasetRows, normalizeYoutubeRow, type NormalizedYoutubeRow } from "@learnspace/shared/youtube-dataset";
import { scoreYoutubeQuality, YOUTUBE_QUALITY_FEATURE_VERSION } from "@learnspace/shared/youtube-quality";

const datasetName = "harisundarrajendran/educational-youtube-content";
const allowedLicences = new Set([
  "cc0",
  "cc0 1 0",
  "cc by",
  "cc by 2 0",
  "cc by 3 0",
  "cc by 4 0",
  "cc by sa",
  "cc by sa 2 0",
  "cc by sa 3 0",
  "cc by sa 4 0",
  "mit",
  "apache 2 0",
  "apache license 2 0",
  "odc pddl",
  "odc by",
]);

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

function normaliseLicence(value: string): string {
  return value.toLowerCase().replaceAll(/[._-]+/g, " ").replaceAll(/\s+/g, " ").trim();
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

function assertImportAuthorization(licence: string | null, ownerAuthorized: boolean): void {
  if ((!licence && ownerAuthorized) || (licence && allowedLicences.has(normaliseLicence(licence)))) {
    return;
  }
  if (!licence || !allowedLicences.has(normaliseLicence(licence))) {
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
  "data science ai": ["data-science", "ai-machine-learning"],
  "machine learning": ["ai-machine-learning"],
  "ai innovation": ["ai-machine-learning", "generative-ai"],
  "data science": ["data-science"],
  "coding programming": ["programming-computer-science"],
  programming: ["programming-computer-science"],
  "computer science": ["programming-computer-science"],
  web: ["web-development"],
  "web development": ["web-development"],
  devops: ["devops-cloud"],
  cloud: ["devops-cloud"],
  cybersecurity: ["cybersecurity"],
  biology: ["biology"],
  mathematics: ["mathematics-statistics"],
  statistics: ["mathematics-statistics"],
  physics: ["physics"],
  "language learning": ["english-language-learning"],
  english: ["english-language-learning"],
  "writing content": ["writing-skills"],
  "soft skills": ["communication-public-speaking"],
  "public speaking": ["communication-public-speaking", "public-speaking"],
  design: ["visual-communication"],
  communication: ["communication-public-speaking"],
};

function resolveConcepts(row: NormalizedYoutubeRow, conceptMap: Map<string, string>): string[] {
  const ids = new Set<string>();
  for (const label of row.categoryLabels) {
    const normalized = normaliseLabel(label);
    const direct = conceptMap.get(normalized);
    if (direct) ids.add(direct);
    else for (const mapped of explicitLabelMappings[normalized] ?? []) {
      const id = conceptMap.get(normaliseLabel(mapped));
      if (id) {
        ids.add(id);
        break;
      }
    }
  }
  return [...ids];
}

async function importBatch(
  sql: ReturnType<typeof postgres>,
  rows: NormalizedYoutubeRow[],
  conceptMap: Map<string, string>,
  importedAt: Date,
  provenance: Record<string, string>,
): Promise<void> {
  const preparedRows = rows.map((row) => ({
    row,
    quality: scoreYoutubeQuality({
      title: row.title,
      description: row.description,
      channelTitle: row.channelTitle,
      durationMs: row.durationMs,
      publishedAt: row.publishedAt,
      viewCount: row.viewCount,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      metricsCapturedAt: row.metricsCapturedAt,
      channelSubscriberCount: null,
      channelViewCount: null,
      channelVideoCount: null,
    }, importedAt),
    conceptIds: resolveConcepts(row, conceptMap),
    resourceMetadata: {
      dataset: datasetName,
      sourceRecordHash: row.sourceRecordHash,
      mappingVersion: "youtube-dataset-v1",
      thumbnailUrl: `https://i.ytimg.com/vi/${row.youtubeId}/hqdefault.jpg`,
      ...provenance,
    },
  }));

  await sql.begin(async (tx) => {
    const resourceRows = preparedRows.map(({ row, quality, resourceMetadata }) => ({
      owner_user_id: null,
      type: "video",
      provider: "youtube",
      external_id: row.youtubeId,
      canonical_url: row.canonicalUrl,
      title: row.title,
      description: row.description,
      language: row.language,
      visibility: "public",
      status: "ready",
      quality_score: quality.finalQualityScore,
      metadata: resourceMetadata,
      updated_at: importedAt,
    }));
    const resources = await tx.unsafe<{ id: string; external_id: string }[]>(
      `INSERT INTO catalog.resources
        (owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata, updated_at)
      SELECT
        input.owner_user_id,
        input.type::catalog.resource_type,
        input.provider,
        input.external_id,
        input.canonical_url,
        input.title,
        input.description,
        input.language,
        input.visibility::catalog.resource_visibility,
        input.status::catalog.resource_status,
        input.quality_score,
        input.metadata,
        input.updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        owner_user_id uuid,
        type text,
        provider text,
        external_id text,
        canonical_url text,
        title text,
        description text,
        language text,
        visibility text,
        status text,
        quality_score real,
        metadata jsonb,
        updated_at timestamptz
      )
      ON CONFLICT (provider, external_id) WHERE owner_user_id IS NULL AND external_id IS NOT NULL DO UPDATE SET
        canonical_url = EXCLUDED.canonical_url,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        status = EXCLUDED.status,
        quality_score = EXCLUDED.quality_score,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING id, external_id
    `,
      [tx.json(resourceRows)],
    );
    const resourceIds = new Map(resources.map((resource) => [resource.external_id, resource.id]));
    const idFor = (youtubeId: string): string => {
      const resourceId = resourceIds.get(youtubeId);
      if (!resourceId) throw new Error(`Could not persist YouTube resource ${youtubeId}`);
      return resourceId;
    };

    const videoDetailRows = preparedRows.map(({ row }) => ({
      resource_id: idFor(row.youtubeId),
      youtube_id: row.youtubeId,
      channel_id: row.channelId,
      channel_title: row.channelTitle,
      duration_ms: row.durationMs,
      published_at: row.publishedAt,
      default_audio_language: row.language,
      latest_view_count: row.viewCount,
      latest_like_count: row.likeCount,
      latest_comment_count: row.commentCount,
      metrics_captured_at: row.metricsCapturedAt,
      fetched_at: importedAt,
    }));
    await tx.unsafe(
      `INSERT INTO catalog.video_details
        (resource_id, youtube_id, channel_id, channel_title, duration_ms, published_at, default_audio_language, latest_view_count, latest_like_count, latest_comment_count, metrics_captured_at, fetched_at)
      SELECT
        input.resource_id,
        input.youtube_id,
        input.channel_id,
        input.channel_title,
        input.duration_ms,
        input.published_at,
        input.default_audio_language,
        input.latest_view_count,
        input.latest_like_count,
        input.latest_comment_count,
        input.metrics_captured_at,
        input.fetched_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        resource_id uuid,
        youtube_id text,
        channel_id text,
        channel_title text,
        duration_ms integer,
        published_at timestamptz,
        default_audio_language text,
        latest_view_count bigint,
        latest_like_count bigint,
        latest_comment_count bigint,
        metrics_captured_at timestamptz,
        fetched_at timestamptz
      )
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
    `,
      [tx.json(videoDetailRows)],
    );

    const metricRows = preparedRows
      .filter(({ row }) => row.metricsCapturedAt && (row.viewCount !== null || row.likeCount !== null || row.commentCount !== null))
      .map(({ row }) => ({
        resource_id: idFor(row.youtubeId),
        captured_at: row.metricsCapturedAt,
        view_count: row.viewCount,
        like_count: row.likeCount,
        comment_count: row.commentCount,
      }));
    if (metricRows.length > 0) {
      await tx.unsafe(
        `INSERT INTO catalog.video_metric_snapshots
          (resource_id, captured_at, view_count, like_count, comment_count)
        SELECT
          input.resource_id,
          input.captured_at,
          input.view_count,
          input.like_count,
          input.comment_count
        FROM jsonb_to_recordset($1::jsonb) AS input(
          resource_id uuid,
          captured_at timestamptz,
          view_count bigint,
          like_count bigint,
          comment_count bigint
        )
        ON CONFLICT (resource_id, captured_at) DO UPDATE SET
          view_count = EXCLUDED.view_count,
          like_count = EXCLUDED.like_count,
          comment_count = EXCLUDED.comment_count
      `,
        [tx.json(metricRows)],
      );
    }

    const qualityRows = preparedRows.map(({ row, quality }) => ({
      resource_id: idFor(row.youtubeId),
      feature_version: YOUTUBE_QUALITY_FEATURE_VERSION,
      captured_at: importedAt,
      bayesian_engagement: quality.bayesianEngagement,
      comment_quality: quality.commentQuality,
      freshness_prior: quality.freshnessPrior,
      content_coverage: quality.contentCoverage,
      source_authority: quality.sourceAuthority,
      final_quality_score: quality.finalQualityScore,
      features: quality.features,
    }));
    await tx.unsafe(
      `INSERT INTO discovery.resource_quality_snapshots
        (resource_id, feature_version, captured_at, bayesian_engagement, comment_quality, freshness_prior, content_coverage, source_authority, final_quality_score, features)
      SELECT
        input.resource_id,
        input.feature_version,
        input.captured_at,
        input.bayesian_engagement,
        input.comment_quality,
        input.freshness_prior,
        input.content_coverage,
        input.source_authority,
        input.final_quality_score,
        input.features
      FROM jsonb_to_recordset($1::jsonb) AS input(
        resource_id uuid,
        feature_version text,
        captured_at timestamptz,
        bayesian_engagement real,
        comment_quality real,
        freshness_prior real,
        content_coverage real,
        source_authority real,
        final_quality_score real,
        features jsonb
      )
      ON CONFLICT (resource_id, feature_version, captured_at) DO UPDATE SET
        bayesian_engagement = EXCLUDED.bayesian_engagement,
        comment_quality = EXCLUDED.comment_quality,
        freshness_prior = EXCLUDED.freshness_prior,
        content_coverage = EXCLUDED.content_coverage,
        source_authority = EXCLUDED.source_authority,
        final_quality_score = EXCLUDED.final_quality_score,
        features = EXCLUDED.features
    `,
      [tx.json(qualityRows)],
    );

    const conceptRows = preparedRows.flatMap(({ row, conceptIds }) => conceptIds.map((conceptId) => ({
      resource_id: idFor(row.youtubeId),
      concept_id: conceptId,
      source: "youtube-dataset",
      relevance: 0.75,
      is_primary: false,
      extractor_version: "youtube-dataset-mapping-v1",
    })));
    if (conceptRows.length > 0) {
      await tx.unsafe(
        `INSERT INTO catalog.resource_concepts
          (resource_id, concept_id, source, relevance, is_primary, extractor_version)
        SELECT
          input.resource_id,
          input.concept_id,
          input.source,
          input.relevance,
          input.is_primary,
          input.extractor_version
        FROM jsonb_to_recordset($1::jsonb) AS input(
          resource_id uuid,
          concept_id uuid,
          source text,
          relevance real,
          is_primary boolean,
          extractor_version text
        )
        ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET
          relevance = EXCLUDED.relevance,
          extractor_version = EXCLUDED.extractor_version
      `,
        [tx.json(conceptRows)],
      );
    }
  });
}

async function main(): Promise<void> {
  const input = argument("--input") ?? process.env.DISCOVERY_YOUTUBE_DATASET_FILE;
  if (!input) throw new Error("Use --input <csv|tsv|json> or DISCOVERY_YOUTUBE_DATASET_FILE.");
  const inputPath = resolve(input);
  const licence = await datasetLicence(inputPath);
  const ownerAuthorized = process.argv.includes("--owner-authorized");
  assertImportAuthorization(licence, ownerAuthorized);
  const provenance = licence ? { datasetLicense: licence } : { datasetAuthorization: "owner-authorized" };
  const profile = await profileYoutubeDataset(inputPath, licence);
  const profilePath = resolve(process.env.DISCOVERY_PROFILE_OUTPUT ?? "../../artifacts/discovery/youtube-dataset-profile.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  process.stdout.write(`Profiled ${profile.rowCount} rows; ${profile.uniqueYoutubeIds} unique YouTube IDs; ${profile.duplicateYoutubeIds} duplicates; ${profile.invalidUrls} rejected.\n`);
  if (process.argv.includes("--profile-only")) return;

  const databaseUrl = process.env.DATABASE_WORKER_URL;
  if (!databaseUrl) throw new Error("DATABASE_WORKER_URL is required for catalog import");
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
        await importBatch(sql, batch, conceptMap, importedAt, provenance);
        importedRows += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await importBatch(sql, batch, conceptMap, importedAt, provenance);
      importedRows += batch.length;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.stdout.write(`Imported ${importedRows} rows; ${duplicateRows} duplicate rows skipped; ${rejectedRows} malformed rows rejected.\n`);
}

await main();

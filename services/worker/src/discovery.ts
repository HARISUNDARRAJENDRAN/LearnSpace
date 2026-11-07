import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { RECOMMENDATION_CONFIG as recommendationConfig, semanticRecommendationsEnabled } from "@learnspace/shared/recommendation-config";
import { discoverCandidates, type DiscoveryRequest } from "@learnspace/shared/exa-discovery";
import { redisCommands, recommendationCatalogKey } from "@learnspace/shared/recommendation-cache";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { dailyUsage, recordUsage } from "./api-usage.js";
import { configuredNumber } from "./config.js";
import { type DiscoveryLane, discoveryLanes } from "./discovery-lanes.js";
import { recommendationMaintenance, recommendationUpkeep } from "./recommendation-maintenance.js";
import { purgeExpiredYoutubeStatistics, refreshYoutubeMetrics } from "./youtube-metrics.js";
import {
  DISCOVERY_LEARNING_FORMATS,
  canonicalYoutubeUrl,
  type DiscoveryLearningFormat,
  youtubeIdFromUrl,
} from "@learnspace/shared";

type JsonObject = Record<string, postgres.JSONValue | undefined>;
type SqlClient = ReturnType<typeof postgres>;
type TransactionSql = postgres.TransactionSql;

type OutboxRow = {
  id: string;
  event_type: string;
  user_id: string | null;
  payload: JsonObject;
  correlation_id: string | null;
  trace_id: string | null;
};

type JobRow = {
  id: string;
  job_type: string;
  payload: JsonObject;
  attempts: number;
  max_attempts: number;
  correlation_id: string | null;
  trace_id: string | null;
};

type YoutubeProposal = {
  youtube_id: string;
  canonical_url: string;
  title: string;
  channel: string | null;
  published_at: string | null;
  duration_ms: number | null;
  language: string | null;
  matched_concept_ids: string[];
  learning_format: DiscoveryLearningFormat | null;
  estimated_level: string | null;
  has_implementation: boolean | null;
  evidence: string[];
  confidence: number;
};

type ArxivProposal = {
  arxiv_id: string;
  canonical_url: string;
  title: string;
  authors: string[];
  abstract: string | null;
  published_at: string | null;
  categories: string[];
  matched_concept_ids: string[];
  estimated_level: string | null;
  paper_class: "current" | "foundational";
  evidence: string[];
  confidence: number;
};

type CandidateBatch = {
  trace_id: string;
  youtube: YoutubeProposal[];
  arxiv: ArxivProposal[];
  failures: string[];
  cache_hit: boolean;
  provider_calls: number;
  fallback_calls: number;
};

function refreshDeduplicationHours(): number {
  return configuredNumber("DISCOVERY_REFRESH_DEDUP_HOURS", 12, 1, 168);
}

export function refreshIntervalHours(conceptName: string): number {
  const name = conceptName.toLowerCase();
  if (/\b(artificial intelligence|machine learning|ai|ml|web development|cybersecurity)\b/.test(name)) {
    return configuredNumber("DISCOVERY_REFRESH_FAST_HOURS", 24, 1, 168);
  }
  if (/(programming|computer science|data science|devops|cloud)/.test(name)) {
    return configuredNumber("DISCOVERY_REFRESH_MEDIUM_HOURS", 24, 1, 336);
  }
  return configuredNumber("DISCOVERY_REFRESH_SLOW_HOURS", 72, 1, 720);
}

export function nextRefreshAt(conceptId: string, conceptName: string, finishedAt: Date): Date {
  const jitterPercent = configuredNumber("DISCOVERY_REFRESH_JITTER_PERCENT", 0.1, 0, 0.5);
  const hash = createHash("sha256").update(`${conceptId}:${finishedAt.toISOString()}`).digest().readUInt32BE(0);
  const jitter = ((hash % 2001) / 1000 - 1) * jitterPercent;
  const delayMs = refreshIntervalHours(conceptName) * 60 * 60 * 1000 * (1 + jitter);
  return new Date(finishedAt.getTime() + delayMs);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countValue(value: unknown): number {
  const count = numberValue(value);
  return count === null ? 0 : Math.min(100, Math.max(0, Math.floor(count)));
}

export function resourceIdsFromJobResult(value: unknown): string[] {
  const body = objectValue(value);
  if (!body || !Array.isArray(body.resourceIds)) return [];
  return [...new Set(body.resourceIds.filter((id): id is string => (
    typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)
  )))].slice(0, 100);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function learningFormat(value: unknown): DiscoveryLearningFormat | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && (DISCOVERY_LEARNING_FORMATS as readonly string[]).includes(value)
    ? value as DiscoveryLearningFormat
    : undefined;
}

function objectValue(value: unknown): JsonObject | null {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function youtubeId(value: unknown): string | null {
  const id = stringValue(value);
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function arxivId(value: unknown): string | null {
  const id = stringValue(value);
  return id && /^(?:[A-Za-z][A-Za-z0-9.-]{1,31}\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/.test(id)
    ? id.replace(/v\d+$/i, "")
    : null;
}

function isYoutubeUrl(value: string, id: string): boolean {
  return youtubeIdFromUrl(value) === id;
}

function isArxivUrl(value: string, id: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "arxiv.org"
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && arxivId(url.pathname.replace(/^\/abs\//, "")) === id;
  } catch {
    return false;
  }
}

function parseYoutube(value: unknown): YoutubeProposal | null {
  const item = objectValue(value);
  if (!item) return null;
  const id = youtubeId(item.youtube_id);
  const url = stringValue(item.canonical_url);
  const title = stringValue(item.title);
  const confidence = numberValue(item.confidence);
  const format = learningFormat(item.learning_format);
  if (!id || !url || !isYoutubeUrl(url, id) || !title || title.length < 3 || confidence === null || confidence < 0.5 || confidence > 1 || format === undefined) return null;
  return {
    youtube_id: id,
    canonical_url: canonicalYoutubeUrl(id),
    title: title.slice(0, 500),
    channel: stringValue(item.channel),
    published_at: stringValue(item.published_at),
    duration_ms: numberValue(item.duration_ms),
    language: stringValue(item.language),
    matched_concept_ids: stringArray(item.matched_concept_ids),
    learning_format: format,
    estimated_level: stringValue(item.estimated_level),
    has_implementation: typeof item.has_implementation === "boolean" ? item.has_implementation : null,
    evidence: stringArray(item.evidence).slice(0, 5),
    confidence,
  };
}

function parseArxiv(value: unknown): ArxivProposal | null {
  const item = objectValue(value);
  if (!item) return null;
  const id = arxivId(item.arxiv_id);
  const url = stringValue(item.canonical_url);
  const title = stringValue(item.title);
  const confidence = numberValue(item.confidence);
  const paperClass = item.paper_class === "foundational" ? "foundational" : item.paper_class === "current" ? "current" : null;
  if (!id || !url || !isArxivUrl(url, id) || !title || title.length < 3 || confidence === null || confidence < 0.5 || confidence > 1 || !paperClass) return null;
  return {
    arxiv_id: id,
    canonical_url: `https://arxiv.org/abs/${id}`,
    title: title.slice(0, 500),
    authors: stringArray(item.authors).slice(0, 50),
    abstract: stringValue(item.abstract),
    published_at: stringValue(item.published_at),
    categories: stringArray(item.categories).slice(0, 20),
    matched_concept_ids: stringArray(item.matched_concept_ids),
    estimated_level: stringValue(item.estimated_level),
    paper_class: paperClass,
    evidence: stringArray(item.evidence).slice(0, 5),
    confidence,
  };
}

export function parseBatch(value: unknown): CandidateBatch {
  const body = objectValue(value);
  if (!body) throw new Error("discovery returned a non-object batch");
  const youtube: YoutubeProposal[] = [];
  const youtubeIds = new Set<string>();
  for (const item of Array.isArray(body.youtube) ? body.youtube.slice(0, 50) : []) {
    const candidate = parseYoutube(item);
    if (candidate && !youtubeIds.has(candidate.youtube_id)) {
      youtubeIds.add(candidate.youtube_id);
      youtube.push(candidate);
    }
  }
  const arxiv: ArxivProposal[] = [];
  const arxivIds = new Set<string>();
  for (const item of Array.isArray(body.arxiv) ? body.arxiv.slice(0, 50) : []) {
    const candidate = parseArxiv(item);
    if (candidate && !arxivIds.has(candidate.arxiv_id)) {
      arxivIds.add(candidate.arxiv_id);
      arxiv.push(candidate);
    }
  }
  return {
    trace_id: stringValue(body.trace_id) ?? "worker-trace",
    youtube,
    arxiv,
    failures: stringArray(body.failures).slice(0, 10),
    cache_hit: body.cache_hit === true,
    provider_calls: countValue(body.provider_calls),
    fallback_calls: countValue(body.fallback_calls),
  };
}

/** One background search: a concept in one lane. Only the "recent" lane also searches papers, so papers are fetched once per concept. */
export function discoveryPayload(traceId: string, conceptId: string, conceptName: string, lane: DiscoveryLane): JsonObject {
  return {
    concept_id: conceptId,
    concept_name: conceptName,
    ranking_intent: lane,
    source_kind: lane === "recent" ? null : "video",
    concept_ids: [conceptId],
    concept_names: [conceptName],
    level: "mixed",
    preferred_formats: [],
    video_coverage: 0,
    paper_coverage: 0,
    window_days: 30,
    audit_user_id: null,
    force_refresh: false,
    trace_id: traceId,
  };
}

export function sourcePickerJobPayload(
  traceId: string,
  userId: string,
  runId: string,
  queryText: string | null,
  sourceKind: string | null,
  conceptIds: string[],
  conceptNames: string[],
  rankingIntent: string | null = null,
): JsonObject {
  if (conceptIds.length > 0 && conceptIds.length !== conceptNames.length) {
    throw new Error("source-picker concept ids and names must have the same length");
  }
  return {
    concept_ids: conceptIds,
    concept_names: conceptIds.length > 0 ? conceptNames.slice(0, conceptIds.length) : [],
    query_text: queryText,
    source_kind: sourceKind,
    level: "mixed",
    preferred_formats: [],
    video_coverage: 0,
    paper_coverage: 0,
    window_days: 30,
    audit_user_id: userId,
    force_refresh: true,
    source_picker_run_id: runId,
    refresh_reason: "source_picker",
    ...(rankingIntent ? { ranking_intent: rankingIntent } : {}),
    trace_id: traceId,
  };
}

function refreshDedupKey(conceptId: string, lane: DiscoveryLane): string {
  return `discovery:${conceptId}:${lane}`;
}

async function scheduleDueRefreshes(sql: SqlClient): Promise<number> {
  // Jobs from before lanes carry no ranking_intent; they refresh as the basics lane.
  const rows = await sql<{ concept_id: string; concept_name: string; lane: DiscoveryLane; finished_at: Date }[]>`
    SELECT DISTINCT ON (payload->>'concept_id', COALESCE(payload->>'ranking_intent', 'beginner_friendly'))
      payload->>'concept_id' AS concept_id,
      COALESCE(payload->>'concept_name', payload->'concept_names'->>0, payload->>'concept_id') AS concept_name,
      COALESCE(payload->>'ranking_intent', 'beginner_friendly') AS lane,
      finished_at
    FROM ops.jobs
    WHERE queue = 'discovery'
      AND job_type = 'discovery.refresh_concept'
      AND status IN ('done', 'dead')
      AND finished_at IS NOT NULL
      AND payload->>'concept_id' IS NOT NULL
    ORDER BY payload->>'concept_id', COALESCE(payload->>'ranking_intent', 'beginner_friendly'), finished_at DESC
  `;
  const scheduledRows = await sql<{ dedup_key: string; created_at: Date }[]>`
    SELECT DISTINCT ON (dedup_key) dedup_key, created_at
    FROM ops.jobs
    WHERE queue = 'discovery'
      AND job_type = 'discovery.refresh_concept'
      AND payload->>'refresh_reason' = 'scheduled'
      AND status IN ('pending', 'running')
    ORDER BY dedup_key, created_at DESC
  `;
  const existingScheduled = new Map(scheduledRows.map((job) => [job.dedup_key, job]));
  let scheduled = 0;
  for (const row of rows) {
    const nextAt = nextRefreshAt(row.concept_id, row.concept_name, row.finished_at);
    if (nextAt.getTime() > Date.now()) continue;
    const dedupKey = refreshDedupKey(row.concept_id, row.lane);
    const existing = existingScheduled.get(dedupKey);
    if (existing && existing.created_at >= row.finished_at) continue;
    const traceId = `scheduled-${row.concept_id}-${row.lane}-${row.finished_at.getTime()}`;
    const payload = { ...discoveryPayload(traceId, row.concept_id, row.concept_name, row.lane), refresh_reason: "scheduled" };
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO ops.jobs (queue, job_type, payload, status, priority, dedup_key, idempotency_key, available_at, trace_id)
      VALUES ('discovery', 'discovery.refresh_concept', ${sql.json(payload)}, 'pending', 0,
        ${dedupKey}, ${`scheduled:${row.concept_id}:${row.lane}:${row.finished_at.toISOString()}`}, ${nextAt}, ${traceId})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) scheduled += 1;
  }
  return scheduled;
}

async function promoteOutbox(sql: SqlClient): Promise<string | null> {
  return sql.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      SELECT id, event_type, user_id, payload, correlation_id, trace_id
      FROM ops.outbox_events
      WHERE status = 'pending'
        AND event_type IN ('discovery.refresh_requested', 'discovery.candidates_discovered')
        AND available_at <= now()
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const outbox = rows[0];
    if (!outbox?.user_id) return null;
    const outboxPayload = objectValue(outbox.payload);
    if (!outboxPayload) return null;
    const traceId = outbox.trace_id ?? `outbox-${outbox.id}`;
    const conceptIds = stringArray(outboxPayload.conceptIds);
    const conceptNames = stringArray(outboxPayload.conceptNames);
    const sourcePickerRunId = stringValue(outboxPayload.sourcePickerRunId);
    const queryText = stringValue(outboxPayload.queryText);
    const sourceKind = stringValue(outboxPayload.sourceKind);
    const rankingIntent = stringValue(outboxPayload.rankingIntent);
    const jobs: Array<{ id: string }> = [];
    if (outbox.event_type === 'discovery.candidates_discovered' && sourcePickerRunId) {
      const candidateBatch = objectValue(outboxPayload.candidateBatch);
      if (!candidateBatch) throw new Error(`outbox ${outbox.id} has no candidate batch`);
      const payload = {
        source_picker_run_id: sourcePickerRunId,
        audit_user_id: outbox.user_id,
        concept_ids: conceptIds,
        candidate_batch: candidateBatch,
        trace_id: traceId,
      };
      const dedupKey = `discovery:source-picker-persist:${sourcePickerRunId}`;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO ops.jobs (queue, job_type, payload, status, priority, dedup_key, idempotency_key, correlation_id, trace_id)
        VALUES ('discovery', 'discovery.persist_candidates', ${tx.json(payload)}, 'pending', 10, ${dedupKey}, ${`${outbox.id}:source-picker-persist`}, ${outbox.correlation_id}, ${traceId})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (inserted[0]) jobs.push(inserted[0]);
    } else if (sourcePickerRunId) {
      const payload = sourcePickerJobPayload(
        traceId,
        outbox.user_id,
        sourcePickerRunId,
        queryText,
        sourceKind,
        conceptIds,
        conceptNames,
        rankingIntent,
      );
      const dedupKey = `discovery:source-picker:${sourcePickerRunId}`;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO ops.jobs (queue, job_type, payload, status, priority, dedup_key, idempotency_key, correlation_id, trace_id)
        VALUES ('discovery', 'discovery.refresh_concept', ${tx.json(payload)}, 'pending', 10, ${dedupKey}, ${`${outbox.id}:source-picker`}, ${outbox.correlation_id}, ${traceId})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (inserted[0]) jobs.push(inserted[0]);
    } else for (const [index, conceptId] of conceptIds.entries()) for (const lane of discoveryLanes({
      persona: stringValue(outboxPayload.persona),
      learningIntents: stringArray(outboxPayload.learningIntents),
      preferredFormats: stringArray(outboxPayload.preferredFormats),
      level: stringValue(outboxPayload.level),
    })) {
      const conceptName = conceptNames[index] ?? conceptId;
      const payload = { ...discoveryPayload(traceId, conceptId, conceptName, lane), audit_user_id: outbox.user_id };
      const dedupKey = refreshDedupKey(conceptId, lane);
      const recentJobs = await tx<{ id: string }[]>`
        SELECT id
        FROM ops.jobs
        WHERE queue = 'discovery'
          AND job_type = 'discovery.refresh_concept'
          AND dedup_key = ${dedupKey}
          AND (
            status IN ('pending', 'running')
            OR (
              status IN ('done', 'dead')
              AND finished_at >= now() - make_interval(hours => ${refreshDeduplicationHours()})
            )
          )
        LIMIT 1
      `;
      if (recentJobs.length > 0) continue;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO ops.jobs (queue, job_type, payload, status, priority, dedup_key, idempotency_key, correlation_id, trace_id)
        VALUES ('discovery', 'discovery.refresh_concept', ${tx.json(payload)}, 'pending', 5, ${dedupKey}, ${`${outbox.id}:${conceptId}:${lane}`}, ${outbox.correlation_id}, ${traceId})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (inserted[0]) jobs.push(inserted[0]);
    }
    await tx`
      UPDATE ops.outbox_events
      SET status = 'published', published_at = now()
      WHERE id = ${outbox.id}
    `;
    return jobs[0]?.id ?? null;
  });
}

async function claimJob(sql: SqlClient, workerId: string): Promise<JobRow | null> {
  return sql.begin(async (tx) => {
    const rows = await tx<JobRow[]>`
      SELECT id, job_type, payload, attempts, max_attempts, correlation_id, trace_id
      FROM ops.jobs
      WHERE queue = 'discovery'
        AND status = 'pending'
        AND available_at <= now()
        AND attempts < max_attempts
      ORDER BY CASE WHEN created_at < now() - interval '5 minutes' THEN 10 ELSE priority END DESC, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const job = rows[0];
    if (!job) return null;
    const claimed = await tx<JobRow[]>`
      UPDATE ops.jobs
      SET status = 'running', attempts = attempts + 1, lease_owner = ${workerId}, lease_expires_at = now() + interval '2 minutes', heartbeat_at = now(), started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = ${job.id}
      RETURNING id, job_type, payload, attempts, max_attempts, correlation_id, trace_id
    `;
    const claimedJob = claimed[0];
    if (!claimedJob) return null;
    const payload = objectValue(claimedJob.payload);
    if (!payload) throw new Error(`discovery job ${claimedJob.id} has invalid JSON payload`);
    return { ...claimedJob, payload };
  });
}

async function reclaimExpiredJobs(sql: SqlClient): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; run_id: string | null; terminal: boolean }[]>`
      UPDATE ops.jobs
      SET status = CASE
          WHEN attempts >= max_attempts THEN 'dead'::ops.job_status
          ELSE 'pending'::ops.job_status
        END,
        available_at = CASE
          WHEN attempts >= max_attempts THEN available_at
          ELSE now() + make_interval(secs => LEAST(3600::double precision, 30::double precision * power(2::double precision, GREATEST(0, attempts - 1))))
        END,
        finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE finished_at END,
        last_error_code = 'DISCOVERY_LEASE_EXPIRED',
        last_error_detail = 'Worker lease expired before completion',
        lease_owner = NULL,
        lease_expires_at = NULL,
        heartbeat_at = NULL,
        updated_at = now()
      WHERE queue = 'discovery'
        AND status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
      RETURNING id, payload->>'source_picker_run_id' AS run_id, attempts >= max_attempts AS terminal
    `;
    for (const row of rows) {
      if (!row.terminal || !row.run_id) continue;
      await tx`
        UPDATE discovery.recommendation_runs
        SET status = 'failed', completed_at = now(), context_snapshot = context_snapshot || ${tx.json({ refreshStatus: "failed" })}
        WHERE id = ${row.run_id} AND status IN ('queued', 'running')
      `;
    }
    return rows.length;
  });
}

/** Searches Exa for the job's concept lane; without EXA_API_KEY a job finds nothing and reports why. */
async function discover(job: JobRow): Promise<CandidateBatch> {
  const exaApiKey = process.env.EXA_API_KEY;
  const request = discoveryRequest(job.payload);
  if (!exaApiKey) return parseBatch({ trace_id: request.trace_id, youtube: [], arxiv: [], failures: ["exa_not_configured"] });
  return parseBatch(await discoverCandidates(request as DiscoveryRequest, {
    exaApiKey,
    timeoutMs: configuredNumber("DISCOVERY_REQUEST_TIMEOUT_SECONDS", 8, 1, 30) * 1000,
  }));
}

const discoveryRequestKeys = [
  "concept_ids",
  "concept_names",
  "level",
  "preferred_formats",
  "video_coverage",
  "paper_coverage",
  "window_days",
  "paper_strategy",
  "audit_user_id",
  "force_refresh",
  "trace_id",
  "query_text",
  "source_kind",
  "ranking_intent",
] as const;

export function discoveryRequest(payload: JsonObject): JsonObject {
  const request = Object.fromEntries(
    discoveryRequestKeys.flatMap((key) => key in payload ? [[key, payload[key]]] : []),
  );
  const conceptIds = stringArray(payload.concept_ids);
  const conceptNames = stringArray(payload.concept_names);
  if ((conceptIds.length !== 1 || conceptNames.length !== 1) && !stringValue(payload.query_text)) {
    throw new Error("discovery requests require one canonical concept or query text");
  }
  return {
    ...request,
    level: "mixed",
    preferred_formats: [],
    audit_user_id: null,
    force_refresh: payload.force_refresh === true,
  };
}

async function validConceptIds(tx: TransactionSql, ids: string[]): Promise<string[]> {
  const uniqueIds = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (uniqueIds.length === 0) return [];
  const rows = await tx<{ id: string }[]>`
    SELECT id::text AS id FROM knowledge.concepts
    WHERE status = 'active' AND id = ANY(${uniqueIds})
  `;
  return rows.map((row) => row.id);
}

async function persistBatch(sql: SqlClient, job: JobRow, batch: CandidateBatch): Promise<{ videos: number; papers: number; resourceIds: string[] }> {
  const userId = stringValue(job.payload.audit_user_id);
  const sourcePickerRunId = stringValue(job.payload.source_picker_run_id);
  return sql.begin(async (tx) => {
    const targetConceptId = (await validConceptIds(tx, [
      stringValue(job.payload.concept_id) ?? stringArray(job.payload.concept_ids)[0] ?? "",
    ]))[0];
    if (!targetConceptId && !sourcePickerRunId) return { videos: 0, papers: 0, resourceIds: [] };
    const sourcePickerOwner = sourcePickerRunId && userId ? userId : null;
    async function resourceIdFor(
      provider: string,
      externalId: string,
      type: "video" | "paper",
      canonicalUrl: string,
      title: string,
      description: string | null,
      language: string | null,
      metadata: JsonObject,
    ): Promise<string | null> {
      const existing = userId
        ? await tx<{ id: string }[]>`
            SELECT id FROM catalog.resources
            WHERE provider = ${provider} AND external_id = ${externalId} AND deleted_at IS NULL
              AND (owner_user_id IS NULL OR owner_user_id = ${userId})
            ORDER BY owner_user_id NULLS FIRST
            LIMIT 1
          `
        : await tx<{ id: string }[]>`
            SELECT id FROM catalog.resources
            WHERE provider = ${provider} AND external_id = ${externalId} AND deleted_at IS NULL
              AND owner_user_id IS NULL
            LIMIT 1
          `;
      if (existing[0]) return existing[0].id;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO catalog.resources
          (owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, metadata)
        VALUES
          (${sourcePickerOwner}, ${type}, ${provider}, ${externalId}, ${canonicalUrl}, ${title}, ${description}, ${language}, ${sourcePickerOwner ? "private" : "public"}, 'ready', ${tx.json(metadata)})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (inserted[0]) return inserted[0].id;
      const afterRace = userId
        ? await tx<{ id: string }[]>`
            SELECT id FROM catalog.resources
            WHERE provider = ${provider} AND external_id = ${externalId} AND deleted_at IS NULL
              AND (owner_user_id IS NULL OR owner_user_id = ${userId})
            ORDER BY owner_user_id NULLS FIRST
            LIMIT 1
          `
        : await tx<{ id: string }[]>`
            SELECT id FROM catalog.resources
            WHERE provider = ${provider} AND external_id = ${externalId} AND deleted_at IS NULL
              AND owner_user_id IS NULL
            LIMIT 1
          `;
      return afterRace[0]?.id ?? null;
    }
    let videos = 0;
    let papers = 0;
    const resourceIds = new Set<string>();
    for (const candidate of batch.youtube) {
      if (targetConceptId && !candidate.matched_concept_ids.includes(targetConceptId)) continue;
      const resourceId = await resourceIdFor("youtube", candidate.youtube_id, "video", candidate.canonical_url, candidate.title, candidate.evidence.join("\n") || null, candidate.language, { source: sourcePickerRunId ? "source-picker" : "discovery-agent", featureVersion: "discovery-v1", learningFormat: candidate.learning_format, estimatedLevel: candidate.estimated_level, hasImplementation: candidate.has_implementation, sourceConfidence: candidate.confidence });
      if (!resourceId) continue;
      resourceIds.add(resourceId);
      await tx`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at, default_audio_language, fetched_at)
        VALUES (${resourceId}, ${candidate.youtube_id}, ${candidate.channel}, ${candidate.duration_ms}, ${candidate.published_at}, ${candidate.language}, now())
        ON CONFLICT (resource_id) DO UPDATE SET channel_title = COALESCE(catalog.video_details.channel_title, EXCLUDED.channel_title), duration_ms = COALESCE(catalog.video_details.duration_ms, EXCLUDED.duration_ms), published_at = COALESCE(catalog.video_details.published_at, EXCLUDED.published_at), default_audio_language = COALESCE(catalog.video_details.default_audio_language, EXCLUDED.default_audio_language), fetched_at = now()
      `;
      if (targetConceptId) await tx`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary, extractor_version)
        VALUES (${resourceId}, ${targetConceptId}, 'discovery-agent-v1', ${candidate.confidence}, false, 'discovery-agent-v1')
        ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET relevance = GREATEST(catalog.resource_concepts.relevance, EXCLUDED.relevance), extractor_version = EXCLUDED.extractor_version
      `;
      videos += 1;
    }
    for (const candidate of batch.arxiv) {
      if (targetConceptId && !candidate.matched_concept_ids.includes(targetConceptId)) continue;
      const resourceId = await resourceIdFor("arxiv", candidate.arxiv_id, "paper", candidate.canonical_url, candidate.title, candidate.abstract, null, { source: sourcePickerRunId ? "source-picker" : "discovery-agent", featureVersion: "discovery-v1", paperClass: candidate.paper_class, sourceConfidence: candidate.confidence, categories: candidate.categories });
      if (!resourceId) continue;
      resourceIds.add(resourceId);
      await tx`
        INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, submitted_at, primary_category, metadata)
        VALUES (${resourceId}, ${candidate.arxiv_id}, ${candidate.abstract}, 'arXiv', ${candidate.published_at?.slice(0, 10) ?? null}, ${candidate.published_at}, ${candidate.categories[0] ?? null}, ${tx.json({ authors: candidate.authors, source: sourcePickerRunId ? "source-picker" : "discovery-agent" })})
        ON CONFLICT (resource_id) DO UPDATE SET abstract = EXCLUDED.abstract, publication_date = EXCLUDED.publication_date, submitted_at = EXCLUDED.submitted_at, primary_category = EXCLUDED.primary_category, metadata = EXCLUDED.metadata
      `;
      if (targetConceptId) await tx`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary, extractor_version)
        VALUES (${resourceId}, ${targetConceptId}, 'discovery-agent-v1', ${candidate.confidence}, false, 'discovery-agent-v1')
        ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET relevance = GREATEST(catalog.resource_concepts.relevance, EXCLUDED.relevance), extractor_version = EXCLUDED.extractor_version
      `;
      papers += 1;
    }
    return { videos, papers, resourceIds: [...resourceIds].slice(0, 100) };
  });
}

async function finishJob(sql: SqlClient, job: JobRow, result: JsonObject): Promise<void> {
  await sql`
    UPDATE ops.jobs
    SET status = 'done', result = ${sql.json(result)}, finished_at = now(), lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = ${job.id}
  `;
}

async function markSourcePickerRefresh(sql: SqlClient, job: JobRow, resourceIds: string[]): Promise<void> {
  const runId = stringValue(job.payload.source_picker_run_id);
  if (!runId) return;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-picker-refresh:${runId}`}, 0))`;
    for (const resourceId of resourceIds) {
      const [nextRank] = await tx<{ rank: number }[]>`
        SELECT coalesce(max(candidate_rank), 0) + 1 AS rank
        FROM discovery.recommendation_candidates
        WHERE recommendation_run_id = ${runId}
      `;
      await tx`
        INSERT INTO discovery.recommendation_candidates
          (recommendation_run_id, resource_id, candidate_rank, final_rank, score, reason_codes, selected)
        VALUES (${runId}, ${resourceId}, ${nextRank?.rank ?? 1}, NULL, 0, ${tx.json(["external_refresh"])}, false)
        ON CONFLICT DO NOTHING
      `;
    }
    await tx`
      UPDATE discovery.recommendation_runs
      SET status = 'completed', completed_at = COALESCE(completed_at, now()), context_snapshot = context_snapshot || ${tx.json({ refreshStatus: "done", refreshedResourceIds: resourceIds })}
      WHERE id = ${runId}
        AND (status IN ('queued', 'running') OR context_snapshot->>'refreshStatus' = 'pending_persistence')
    `;
  });
}

async function failJob(sql: SqlClient, job: JobRow, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message.slice(0, 500) : "discovery worker failed";
  const retryDelaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  await sql`
    UPDATE ops.jobs
    SET status = (CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END)::ops.job_status,
      last_error_code = 'DISCOVERY_REFRESH_FAILED',
      last_error_detail = ${detail},
      available_at = now() + make_interval(secs => ${retryDelaySeconds}),
      finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE finished_at END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
    WHERE id = ${job.id}
  `;
  const runId = stringValue(job.payload.source_picker_run_id);
  if (runId && job.attempts >= job.max_attempts) {
    await sql`
      UPDATE discovery.recommendation_runs
      SET status = 'failed', completed_at = now(), context_snapshot = context_snapshot || ${sql.json({ refreshStatus: "failed" })}
      WHERE id = ${runId} AND status IN ('queued', 'running')
    `;
  }
}

/** One queue tick. `housekeeping` (reclaiming, scheduling, idle YouTube upkeep) runs on one lane at the poll cadence, never per wake-up. */
export async function runDiscoveryWorker(options: { maintenance?: boolean; housekeeping?: boolean; onPromoted?: () => void } = {}): Promise<JsonObject> {
  const databaseUrl = process.env.DATABASE_WORKER_URL;
  if (!databaseUrl) throw new Error("DATABASE_WORKER_URL is required");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const workerId = `discovery-worker-${randomUUID()}`;
  try {
    const housekeeping = options.housekeeping !== false;
    const reclaimedCount = housekeeping ? await reclaimExpiredJobs(sql) : 0;
    const scheduledCount = housekeeping ? await scheduleDueRefreshes(sql) : 0;
    const promotedJobId = await promoteOutbox(sql);
    if (promotedJobId) options.onPromoted?.();
    const job = await claimJob(sql, workerId);
    if (!job) {
      if (!housekeeping) return { status: "idle", promotedJobId, scheduledCount, reclaimedCount };
      // Idle ticks keep YouTube metrics fresh and within the 30-day retention policy.
      const youtube = await refreshYoutubeMetrics(sql);
      const purged = await purgeExpiredYoutubeStatistics(sql);
      if (youtube.videos || purged) await redisCommands([["INCR", recommendationCatalogKey]]);
      await sql`DELETE FROM ops.rate_limit_counters WHERE reset_at < now()`;
      if (options.maintenance !== false) await recommendationMaintenance(sql);
      return { status: "idle", promotedJobId, scheduledCount, reclaimedCount };
    }
    try {
      if (job.job_type === "discovery.persist_candidates") {
        const candidateBatch = objectValue(job.payload.candidate_batch);
        if (!candidateBatch) throw new Error("source-picker persistence job has no candidate batch");
        const persisted = await persistBatch(sql, job, parseBatch(candidateBatch));
        const youtube = await refreshYoutubeMetrics(sql, persisted.resourceIds);
        const result = { ...persisted, youtubeQuotaUnits: youtube.quotaUnits, youtubeGated: youtube.gated };
        await markSourcePickerRefresh(sql, job, persisted.resourceIds);
        if (persisted.resourceIds.length) await redisCommands([["INCR", recommendationCatalogKey]]);
      await finishJob(sql, job, result);
        return { status: "done", jobId: job.id, scheduledCount, reclaimedCount, ...result };
      }
      const sourcePickerRunId = stringValue(job.payload.source_picker_run_id);
      // Background refreshes stop at the daily Exa cap; the feed keeps ranking the catalog it already has.
      if (!sourcePickerRunId && await dailyUsage(sql, "exa") >= configuredNumber("EXA_DAILY_CALL_CAP", 1000, 1, 1_000_000)) {
        await finishJob(sql, job, { skipped: "exa_daily_cap" });
        return { status: "done", jobId: job.id, scheduledCount, reclaimedCount, skipped: "exa_daily_cap" };
      }
      const batch = await discover(job);
      await recordUsage(sql, "exa", batch.provider_calls);
      if (sourcePickerRunId && batch.failures.length > 0 && batch.youtube.length === 0 && batch.arxiv.length === 0) {
        throw new Error(`discovery found no candidates: ${batch.failures[0]}`);
      }
      const persisted = await persistBatch(sql, job, batch);
      const youtube = await refreshYoutubeMetrics(sql, persisted.resourceIds);
      const result = {
        traceId: batch.trace_id,
        providerCalls: batch.provider_calls,
        fallbackCalls: batch.fallback_calls,
        failures: batch.failures,
        cacheHit: batch.cache_hit,
        ...persisted,
        youtubeQuotaUnits: youtube.quotaUnits,
        youtubeGated: youtube.gated,
      };
      await markSourcePickerRefresh(sql, job, persisted.resourceIds);
      if (persisted.resourceIds.length) await redisCommands([["INCR", recommendationCatalogKey]]);
      await finishJob(sql, job, result);
      return { status: "done", jobId: job.id, scheduledCount, reclaimedCount, ...result };
    } catch (error) {
      await failJob(sql, job, error);
      throw error;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Runs `concurrency` queue lanes so one user's topics are discovered in parallel. Lanes sleep until the
 * poll interval or a `discovery_wake` NOTIFY (sent when a discovery request commits), whichever is first.
 */
export async function runDiscoveryWorkerLoop(options: { maxJobs?: number; intervalMs?: number; concurrency?: number; signal?: AbortSignal } = {}): Promise<JsonObject> {
  const maxJobs = options.maxJobs ?? configuredNumber("DISCOVERY_WORKER_MAX_JOBS", 0, 0, 100_000);
  const intervalMs = options.intervalMs ?? configuredNumber("DISCOVERY_WORKER_INTERVAL_MS", 30_000, 1_000, 300_000);
  const concurrency = options.concurrency ?? configuredNumber("DISCOVERY_WORKER_CONCURRENCY", 3, 1, 16);
  let processed = 0;
  let scheduled = 0;
  let maintenance: Promise<void> | null = null;
  let nextMaintenance = 0;
  let nextHousekeeping = 0;
  let wakeLanes = () => {};
  let woken = new Promise<void>((resolve) => { wakeLanes = resolve; });
  const wake = () => {
    const resolve = wakeLanes;
    woken = new Promise<void>((next) => { wakeLanes = next; });
    resolve();
  };
  const pause = async () => {
    const timer = new AbortController();
    const stop = () => timer.abort();
    options.signal?.addEventListener("abort", stop, { once: true });
    try {
      await Promise.race([delay(intervalMs, undefined, { signal: timer.signal }), woken]);
    } catch (error) {
      if (!timer.signal.aborted) throw error;
    } finally {
      timer.abort();
      options.signal?.removeEventListener("abort", stop);
    }
  };
  const listener = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  await listener.listen("discovery_wake", wake).catch((error) => {
    console.warn(JSON.stringify({ metric: "discovery_wake_listen_failure", error: error instanceof Error ? error.message : "listen failed" }));
  });
  options.signal?.addEventListener("abort", wake, { once: true });
  const lane = async (index: number) => {
    while (!options.signal?.aborted && (maxJobs <= 0 || processed < maxJobs)) {
      const housekeeping = index === 0 && Date.now() >= nextHousekeeping;
      if (housekeeping) nextHousekeeping = Date.now() + intervalMs;
      let result: JsonObject;
      try {
        // A promotion turns one request into several jobs; wake the other lanes to share them.
        result = await runDiscoveryWorker({ maintenance: false, housekeeping, onPromoted: wake });
      } catch (error) {
        console.warn(JSON.stringify({ metric: "discovery_worker_failure", lane: index, error: error instanceof Error ? error.message : "job failed" }));
        if (maxJobs > 0) processed += 1;
        await pause();
        continue;
      }
      if (process.env.WORKER_HEARTBEAT_PATH) await writeFile(process.env.WORKER_HEARTBEAT_PATH, String(Date.now()));
      if (result.status !== "idle") console.info(JSON.stringify({ metric: "discovery_worker_tick", lane: index, status: result.status, jobId: result.jobId }));
      scheduled += typeof result.scheduledCount === "number" ? result.scheduledCount : 0;
      // One maintenance batch may run beside queue processing. It owns one small
      // pool; provider latency cannot monopolize the discovery queue connection.
      if (!maintenance && semanticRecommendationsEnabled() && Date.now() >= nextMaintenance) {
        nextMaintenance = Date.now() + recommendationConfig.maintenanceIntervalMs;
        const db = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false, connect_timeout: 10 });
        maintenance = recommendationMaintenance(db, options.signal)
          .catch((error) => console.warn(JSON.stringify({ metric: "recommendation_maintenance_failure", error: error instanceof Error ? error.message : "maintenance failed" })))
          .finally(async () => { await db.end({ timeout: 5 }); maintenance = null; });
      }
      if (result.status === "done") { processed += 1; continue; }
      await pause();
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, (_, index) => lane(index)));
  } finally {
    options.signal?.removeEventListener("abort", wake);
    await maintenance;
    await listener.end({ timeout: 5 });
  }
  return { status: options.signal?.aborted ? "stopped" : "complete", processed, scheduled };
}

/**
 * Serverless entry: `concurrency` lanes work the queue until it is empty or the deadline nears, so one
 * short invocation per wake-up replaces the long-running loop. `housekeeping` invocations also reclaim,
 * schedule and refresh YouTube metrics, then run recommendation upkeep. Jobs left at the deadline stay
 * queued for the next invocation.
 */
export async function drainDiscoveryQueue(options: { housekeeping?: boolean; concurrency?: number; deadlineMs?: number } = {}): Promise<JsonObject> {
  if (!process.env.DATABASE_WORKER_URL) throw new Error("DATABASE_WORKER_URL is required");
  const deadline = Date.now() + (options.deadlineMs ?? 100_000);
  const concurrency = options.concurrency ?? configuredNumber("DISCOVERY_WORKER_CONCURRENCY", 3, 1, 16);
  let processed = 0;
  let failed = 0;
  const tick = async (housekeeping: boolean) => {
    try {
      const result = await runDiscoveryWorker({ maintenance: false, housekeeping });
      if (result.status === "done") processed += 1;
      return result.status;
    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({ metric: "discovery_worker_failure", error: error instanceof Error ? error.message : "job failed" }));
      return "failed";
    }
  };
  // Reclaim and schedule first, so due refreshes are drained in this same invocation.
  if (options.housekeeping) await tick(true);
  // Turn every pending request into jobs before the lanes start, so no lane sees an empty queue and exits early.
  const outboxSql = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    while (Date.now() < deadline && await promoteOutbox(outboxSql)) { /* next request */ }
  } finally {
    await outboxSql.end({ timeout: 5 });
  }
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (Date.now() < deadline && await tick(false) !== "idle") { /* next job */ }
  }));
  if (options.housekeeping && Date.now() < deadline) {
    // An empty queue lets the housekeeping tick refresh YouTube metrics and purge expired statistics.
    await tick(true);
    const db = postgres(process.env.DATABASE_WORKER_URL!, { max: 1, prepare: false, connect_timeout: 10 });
    try {
      await recommendationUpkeep(db, AbortSignal.timeout(Math.max(1_000, deadline - Date.now())));
    } catch (error) {
      console.warn(JSON.stringify({ metric: "recommendation_maintenance_failure", error: error instanceof Error ? error.message : "maintenance failed" }));
    } finally {
      await db.end({ timeout: 5 });
    }
  }
  return { status: Date.now() < deadline ? "drained" : "deadline", processed, failed };
}

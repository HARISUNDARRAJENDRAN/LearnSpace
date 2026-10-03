import { redisCommands, recommendationCatalogKey } from "@learnspace/shared/recommendation-cache";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { recommendationMaintenance } from "./recommendation-maintenance.js";
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
  audit_run_id: string | null;
  cache_hit: boolean;
  provider_calls: number;
  fallback_calls: number;
  enrichment_calls: number;
};

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function refreshDeduplicationHours(): number {
  return configuredNumber("DISCOVERY_REFRESH_DEDUP_HOURS", 12, 1, 168);
}

export function refreshIntervalHours(conceptName: string): number {
  const name = conceptName.toLowerCase();
  if (/\b(artificial intelligence|machine learning|ai|ml|web development|cybersecurity)\b/.test(name)) {
    return configuredNumber("DISCOVERY_REFRESH_FAST_HOURS", 12, 1, 168);
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
  if (!body) throw new Error("discovery agent returned a non-object response");
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
    audit_run_id: stringValue(body.audit_run_id),
    cache_hit: body.cache_hit === true,
    provider_calls: countValue(body.provider_calls),
    fallback_calls: countValue(body.fallback_calls),
    enrichment_calls: countValue(body.enrichment_calls),
  };
}

export function discoveryPayload(traceId: string, conceptId: string, conceptName: string): JsonObject {
  return {
    concept_id: conceptId,
    concept_name: conceptName,
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

async function scheduleDueRefreshes(sql: SqlClient): Promise<number> {
  const rows = await sql<{ concept_id: string; concept_name: string; payload: JsonObject; finished_at: Date }[]>`
    SELECT DISTINCT ON (payload->>'concept_id')
      payload->>'concept_id' AS concept_id,
      COALESCE(payload->>'concept_name', payload->'concept_names'->>0, payload->>'concept_id') AS concept_name,
      payload,
      finished_at
    FROM ops.jobs
    WHERE queue = 'discovery'
      AND job_type = 'discovery.refresh_concept'
      AND status IN ('done', 'dead')
      AND finished_at IS NOT NULL
      AND payload->>'concept_id' IS NOT NULL
    ORDER BY payload->>'concept_id', finished_at DESC
  `;
  const scheduledRows = await sql<{ concept_id: string; status: string; created_at: Date }[]>`
    SELECT DISTINCT ON (payload->>'concept_id')
      payload->>'concept_id' AS concept_id,
      status,
      created_at
    FROM ops.jobs
    WHERE queue = 'discovery'
      AND job_type = 'discovery.refresh_concept'
      AND payload->>'refresh_reason' = 'scheduled'
      AND status IN ('pending', 'running')
    ORDER BY payload->>'concept_id', created_at DESC
  `;
  const existingScheduled = new Map(scheduledRows.map((job) => [job.concept_id, job]));
  let scheduled = 0;
  for (const row of rows) {
    const nextAt = nextRefreshAt(row.concept_id, row.concept_name, row.finished_at);
    if (nextAt.getTime() > Date.now()) continue;
    const existing = existingScheduled.get(row.concept_id);
    if (existing && existing.created_at >= row.finished_at) continue;
    const payload = {
      ...discoveryPayload(
        `scheduled-${row.concept_id}-${row.finished_at.getTime()}`,
        row.concept_id,
        row.concept_name,
      ),
      refresh_reason: "scheduled",
      trace_id: `scheduled-${row.concept_id}-${row.finished_at.getTime()}`,
    };
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO ops.jobs (queue, job_type, payload, status, priority, dedup_key, idempotency_key, available_at, trace_id)
      VALUES ('discovery', 'discovery.refresh_concept', ${sql.json(payload)}, 'pending', 0,
        ${`discovery:${row.concept_id}:refresh`}, ${`scheduled:${row.concept_id}:${row.finished_at.toISOString()}`}, ${nextAt}, ${payload.trace_id})
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
    } else for (const [index, conceptId] of conceptIds.entries()) {
      const conceptName = conceptNames[index] ?? conceptId;
      const payload = {
        ...discoveryPayload(traceId, conceptId, conceptName),
        audit_user_id: outbox.user_id,
        ...(sourcePickerRunId ? { source_picker_run_id: sourcePickerRunId, query_text: queryText, source_kind: sourceKind } : {}),
      };
      const dedupKey = `discovery:${conceptId}:refresh`;
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
        INSERT INTO ops.jobs (queue, job_type, payload, dedup_key, idempotency_key, correlation_id, trace_id)
        VALUES ('discovery', 'discovery.refresh_concept', ${tx.json(payload)}, ${dedupKey}, ${`${outbox.id}:${conceptId}`}, ${outbox.correlation_id}, ${traceId})
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

async function callAgent(agentUrl: string, token: string, job: JobRow): Promise<CandidateBatch> {
  const agentPayload = discoveryAgentPayload(job.payload);
  const response = await fetch(`${agentUrl.replace(/\/$/, "")}/internal/v1/discovery/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-service-token": token },
    body: JSON.stringify(agentPayload),
    signal: AbortSignal.timeout(configuredNumber("DISCOVERY_AGENT_TIMEOUT_SECONDS", 120, 5, 300) * 1000),
  });
  if (!response.ok) throw new Error(`discovery agent returned ${response.status}`);
  return parseBatch(await response.json());
}

const discoveryAgentPayloadKeys = [
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

export function discoveryAgentPayload(payload: JsonObject): JsonObject {
  const request = Object.fromEntries(
    discoveryAgentPayloadKeys.flatMap((key) => key in payload ? [[key, payload[key]]] : []),
  );
  const conceptIds = stringArray(payload.concept_ids);
  const conceptNames = stringArray(payload.concept_names);
  if ((conceptIds.length !== 1 || conceptNames.length !== 1) && !stringValue(payload.query_text)) {
    throw new Error("discovery agent requests require one canonical concept or query text");
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
        ON CONFLICT (resource_id) DO UPDATE SET channel_title = EXCLUDED.channel_title, duration_ms = EXCLUDED.duration_ms, published_at = EXCLUDED.published_at, default_audio_language = EXCLUDED.default_audio_language, fetched_at = now()
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
    if (userId && batch.audit_run_id) await persistAudit(sql, job, batch);
    return { videos, papers, resourceIds: [...resourceIds].slice(0, 100) };
  });
}

async function persistAudit(sql: SqlClient, job: JobRow, batch: CandidateBatch): Promise<void> {
  const userId = stringValue(job.payload.audit_user_id);
  if (!userId || !batch.audit_run_id) return;
  const auditSqlUrl = process.env.DATABASE_AI_URL;
  if (!auditSqlUrl) throw new Error("DATABASE_AI_URL is required for discovery agent audit persistence");
  const auditSql = postgres(auditSqlUrl, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await auditSql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userId}, true)`;
      const [run] = await tx<{ id: string }[]>`
        INSERT INTO agent.agent_runs (id, user_id, purpose, status, goal, policy_version, max_iterations, max_tool_calls, max_tokens, trace_id, correlation_id, started_at, completed_at, final_answer)
        VALUES (${batch.audit_run_id}, ${userId}, 'recommendation', 'done', 'Refresh bounded discovery candidates for canonical interests', 'discovery-policy-v1', 3, 4, 12000, ${batch.trace_id}, ${job.correlation_id}, now(), now(), ${JSON.stringify({ youtube: batch.youtube.length, arxiv: batch.arxiv.length })})
        ON CONFLICT (id) DO UPDATE SET status = 'done', completed_at = now(), final_answer = EXCLUDED.final_answer
        RETURNING id
      `;
      if (!run) return;
      const [step] = await tx<{ id: string }[]>`
        INSERT INTO agent.agent_steps (agent_run_id, step_key, sequence_no, kind, status, input, output_summary, started_at, completed_at)
        VALUES (${run.id}, 'discovery.validate', 1, 'validate', 'done', ${tx.json({ conceptIds: stringArray(job.payload.concept_ids) })}, ${`Validated ${batch.youtube.length} videos and ${batch.arxiv.length} papers`}, now(), now())
        ON CONFLICT (agent_run_id, step_key) DO UPDATE SET status = 'done', completed_at = now(), output_summary = EXCLUDED.output_summary
        RETURNING id
      `;
      if (step) {
        await tx`
          INSERT INTO agent.tool_invocations (agent_run_id, agent_step_id, tool_name, tool_version, status, input, output, latency_ms, started_at, completed_at)
          VALUES (${run.id}, ${step.id}, 'candidate-validation', 'discovery-guardrails-v1', 'succeeded', ${tx.json({ conceptCount: stringArray(job.payload.concept_ids).length })}, ${tx.json({ youtube: batch.youtube.length, arxiv: batch.arxiv.length })}, 0, now(), now())
        `;
      }
    });
  } finally {
    await auditSql.end({ timeout: 5 });
  }
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

export async function runDiscoveryWorker(): Promise<JsonObject> {
  const databaseUrl = process.env.DATABASE_WORKER_URL;
  const agentUrl = process.env.DISCOVERY_AGENT_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!databaseUrl) throw new Error("DATABASE_WORKER_URL is required");
  if (!agentUrl) throw new Error("DISCOVERY_AGENT_URL is required");
  if (!token) throw new Error("INTERNAL_SERVICE_TOKEN is required");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const workerId = `discovery-worker-${randomUUID()}`;
  try {
    await recommendationMaintenance(sql);
    const reclaimedCount = await reclaimExpiredJobs(sql);
    const scheduledCount = await scheduleDueRefreshes(sql);
    const promotedJobId = await promoteOutbox(sql);
    const job = await claimJob(sql, workerId);
    if (!job) return { status: "idle", promotedJobId, scheduledCount, reclaimedCount };
    try {
      if (job.job_type === "discovery.persist_candidates") {
        const candidateBatch = objectValue(job.payload.candidate_batch);
        if (!candidateBatch) throw new Error("source-picker persistence job has no candidate batch");
        const persisted = await persistBatch(sql, job, parseBatch(candidateBatch));
        const result = { ...persisted };
        await markSourcePickerRefresh(sql, job, persisted.resourceIds);
        if (persisted.resourceIds.length) await redisCommands([["INCR", recommendationCatalogKey]]);
      await finishJob(sql, job, result);
        return { status: "done", jobId: job.id, scheduledCount, reclaimedCount, ...result };
      }
      const batch = await callAgent(agentUrl, token, job);
      const sourcePickerRunId = stringValue(job.payload.source_picker_run_id);
      if (sourcePickerRunId && batch.failures.length > 0 && batch.youtube.length === 0 && batch.arxiv.length === 0) {
        throw new Error(`discovery agent reported no candidates: ${batch.failures[0]}`);
      }
      const persisted = await persistBatch(sql, job, batch);
      const result = {
        traceId: batch.trace_id,
        providerCalls: batch.provider_calls,
        fallbackCalls: batch.fallback_calls,
        enrichmentCalls: batch.enrichment_calls,
        failures: batch.failures,
        cacheHit: batch.cache_hit,
        ...persisted,
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

export async function runDiscoveryWorkerLoop(options: { maxJobs?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<JsonObject> {
  const maxJobs = options.maxJobs ?? configuredNumber("DISCOVERY_WORKER_MAX_JOBS", 0, 0, 100_000);
  const intervalMs = options.intervalMs ?? configuredNumber("DISCOVERY_WORKER_INTERVAL_MS", 30_000, 1_000, 300_000);
  let processed = 0;
  let scheduled = 0;
  while (!options.signal?.aborted && (maxJobs <= 0 || processed < maxJobs)) {
    let result: JsonObject;
    try {
      result = await runDiscoveryWorker();
    } catch {
      if (maxJobs > 0) processed += 1;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    scheduled += typeof result.scheduledCount === "number" ? result.scheduledCount : 0;
    if (result.status === "done") {
      processed += 1;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { status: options.signal?.aborted ? "stopped" : "complete", processed, scheduled };
}

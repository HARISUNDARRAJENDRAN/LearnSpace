import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalYoutubeUrl, youtubeIdFromUrl } from "@learnspace/shared";

type JsonObject = Record<string, postgres.JSONValue | undefined>;
type SqlClient = ReturnType<typeof postgres>;
type TransactionSql = postgres.TransactionSql;

type OutboxRow = {
  id: string;
  user_id: string | null;
  payload: JsonObject;
  correlation_id: string | null;
  trace_id: string | null;
};

type JobRow = {
  id: string;
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
  learning_format: string | null;
  estimated_level: string | null;
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
  audit_run_id: string | null;
};

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function refreshIntervalHours(conceptName: string): number {
  const name = conceptName.toLowerCase();
  if (/(artificial intelligence|machine learning|ai|web development|cybersecurity)/.test(name)) {
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
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
  return id && /^[A-Za-z0-9][A-Za-z0-9.-]{2,99}$/.test(id) ? id : null;
}

function isYoutubeUrl(value: string, id: string): boolean {
  return youtubeIdFromUrl(value) === id;
}

function isArxivUrl(value: string, id: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "arxiv.org" && url.pathname === `/abs/${id}`;
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
  if (!id || !url || !isYoutubeUrl(url, id) || !title || title.length < 3 || confidence === null || confidence < 0.5 || confidence > 1) return null;
  return {
    youtube_id: id,
    canonical_url: canonicalYoutubeUrl(id),
    title: title.slice(0, 500),
    channel: stringValue(item.channel),
    published_at: stringValue(item.published_at),
    duration_ms: numberValue(item.duration_ms),
    language: stringValue(item.language),
    matched_concept_ids: stringArray(item.matched_concept_ids),
    learning_format: stringValue(item.learning_format),
    estimated_level: stringValue(item.estimated_level),
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

function parseBatch(value: unknown): CandidateBatch {
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
    audit_run_id: stringValue(body.audit_run_id),
  };
}

export function discoveryPayload(payload: JsonObject, userId: string, traceId: string, conceptId: string, conceptName: string): JsonObject {
  return {
    concept_id: conceptId,
    concept_name: conceptName,
    concept_ids: [conceptId],
    concept_names: [conceptName],
    level: stringValue(payload.level) ?? "mixed",
    preferred_formats: stringArray(payload.preferredFormats),
    video_coverage: 0,
    paper_coverage: 0,
    window_days: 30,
    audit_user_id: userId,
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
      AND status = 'done'
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
      AND status IN ('pending', 'running', 'dead')
    ORDER BY payload->>'concept_id', created_at DESC
  `;
  const existingScheduled = new Map(scheduledRows.map((job) => [job.concept_id, job]));
  let scheduled = 0;
  for (const row of rows) {
    const basePayload = objectValue(row.payload);
    if (!basePayload) continue;
    const nextAt = nextRefreshAt(row.concept_id, row.concept_name, row.finished_at);
    if (nextAt.getTime() > Date.now()) continue;
    const existing = existingScheduled.get(row.concept_id);
    if (existing && existing.created_at >= row.finished_at) continue;
    const payload = {
      ...basePayload,
      audit_user_id: null,
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
      SELECT id, user_id, payload, correlation_id, trace_id
      FROM ops.outbox_events
      WHERE status = 'pending'
        AND event_type = 'discovery.refresh_requested'
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
    const jobs: Array<{ id: string }> = [];
    for (const [index, conceptId] of conceptIds.entries()) {
      const conceptName = conceptNames[index] ?? conceptId;
      const payload = discoveryPayload(outboxPayload, outbox.user_id, traceId, conceptId, conceptName);
      const dedupKey = `discovery:${conceptId}:refresh`;
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
      SELECT id, payload, attempts, max_attempts, correlation_id, trace_id
      FROM ops.jobs
      WHERE queue = 'discovery'
        AND status = 'pending'
        AND available_at <= now()
        AND attempts < max_attempts
      ORDER BY priority DESC, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const job = rows[0];
    if (!job) return null;
    const claimed = await tx<JobRow[]>`
      UPDATE ops.jobs
      SET status = 'running', attempts = attempts + 1, lease_owner = ${workerId}, lease_expires_at = now() + interval '2 minutes', heartbeat_at = now(), started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = ${job.id}
      RETURNING id, payload, attempts, max_attempts, correlation_id, trace_id
    `;
    const claimedJob = claimed[0];
    if (!claimedJob) return null;
    const payload = objectValue(claimedJob.payload);
    if (!payload) throw new Error(`discovery job ${claimedJob.id} has invalid JSON payload`);
    return { ...claimedJob, payload };
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
  "trace_id",
] as const;

export function discoveryAgentPayload(payload: JsonObject): JsonObject {
  return Object.fromEntries(
    discoveryAgentPayloadKeys.flatMap((key) => key in payload ? [[key, payload[key]]] : []),
  );
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

async function persistBatch(sql: SqlClient, job: JobRow, batch: CandidateBatch): Promise<{ videos: number; papers: number }> {
  const userId = stringValue(job.payload.audit_user_id);
  return sql.begin(async (tx) => {
    const targetConceptId = (await validConceptIds(tx, [
      stringValue(job.payload.concept_id) ?? stringArray(job.payload.concept_ids)[0] ?? "",
    ]))[0];
    if (!targetConceptId) return { videos: 0, papers: 0 };
    let videos = 0;
    let papers = 0;
    for (const candidate of batch.youtube) {
      if (!candidate.matched_concept_ids.includes(targetConceptId)) continue;
      const [resource] = await tx<{ id: string }[]>`
        INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, description, language, visibility, status, metadata)
        VALUES ('video', 'youtube', ${candidate.youtube_id}, ${candidate.canonical_url}, ${candidate.title}, ${candidate.evidence.join("\n") || null}, ${candidate.language}, 'public', 'ready', ${tx.json({ source: "discovery-agent", featureVersion: "discovery-v1", learningFormat: candidate.learning_format, estimatedLevel: candidate.estimated_level, sourceConfidence: candidate.confidence })})
        ON CONFLICT (provider, external_id) WHERE owner_user_id IS NULL AND external_id IS NOT NULL
        DO UPDATE SET canonical_url = EXCLUDED.canonical_url, title = EXCLUDED.title, description = EXCLUDED.description, language = EXCLUDED.language, status = 'ready', deleted_at = NULL, updated_at = now(), metadata = EXCLUDED.metadata
        RETURNING id
      `;
      if (!resource) continue;
      await tx`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at, default_audio_language, fetched_at)
        VALUES (${resource.id}, ${candidate.youtube_id}, ${candidate.channel}, ${candidate.duration_ms}, ${candidate.published_at}, ${candidate.language}, now())
        ON CONFLICT (resource_id) DO UPDATE SET channel_title = EXCLUDED.channel_title, duration_ms = EXCLUDED.duration_ms, published_at = EXCLUDED.published_at, default_audio_language = EXCLUDED.default_audio_language, fetched_at = now()
      `;
      await tx`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary, extractor_version)
        VALUES (${resource.id}, ${targetConceptId}, 'discovery-agent-v1', ${candidate.confidence}, false, 'discovery-agent-v1')
        ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET relevance = GREATEST(catalog.resource_concepts.relevance, EXCLUDED.relevance), extractor_version = EXCLUDED.extractor_version
      `;
      videos += 1;
    }
    for (const candidate of batch.arxiv) {
      if (!candidate.matched_concept_ids.includes(targetConceptId)) continue;
      const [resource] = await tx<{ id: string }[]>`
        INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, description, visibility, status, metadata)
        VALUES ('paper', 'arxiv', ${candidate.arxiv_id}, ${candidate.canonical_url}, ${candidate.title}, ${candidate.abstract}, 'public', 'ready', ${tx.json({ source: "discovery-agent", featureVersion: "discovery-v1", paperClass: candidate.paper_class, sourceConfidence: candidate.confidence, categories: candidate.categories })})
        ON CONFLICT (provider, external_id) WHERE owner_user_id IS NULL AND external_id IS NOT NULL
        DO UPDATE SET canonical_url = EXCLUDED.canonical_url, title = EXCLUDED.title, description = EXCLUDED.description, status = 'ready', deleted_at = NULL, updated_at = now(), metadata = EXCLUDED.metadata
        RETURNING id
      `;
      if (!resource) continue;
      await tx`
        INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, submitted_at, primary_category, metadata)
        VALUES (${resource.id}, ${candidate.arxiv_id}, ${candidate.abstract}, 'arXiv', ${candidate.published_at?.slice(0, 10) ?? null}, ${candidate.published_at}, ${candidate.categories[0] ?? null}, ${tx.json({ authors: candidate.authors, source: "discovery-agent" })})
        ON CONFLICT (resource_id) DO UPDATE SET abstract = EXCLUDED.abstract, publication_date = EXCLUDED.publication_date, submitted_at = EXCLUDED.submitted_at, primary_category = EXCLUDED.primary_category, metadata = EXCLUDED.metadata
      `;
      await tx`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary, extractor_version)
        VALUES (${resource.id}, ${targetConceptId}, 'discovery-agent-v1', ${candidate.confidence}, false, 'discovery-agent-v1')
        ON CONFLICT (resource_id, concept_id, source) DO UPDATE SET relevance = GREATEST(catalog.resource_concepts.relevance, EXCLUDED.relevance), extractor_version = EXCLUDED.extractor_version
      `;
      papers += 1;
    }
    if (userId && batch.audit_run_id) await persistAudit(sql, job, batch);
    return { videos, papers };
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

async function failJob(sql: SqlClient, job: JobRow, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message.slice(0, 500) : "discovery worker failed";
  const retryDelaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  await sql`
    UPDATE ops.jobs
    SET status = (CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END)::ops.job_status,
      last_error_code = 'DISCOVERY_REFRESH_FAILED',
      last_error_detail = ${detail},
      available_at = now() + make_interval(secs => ${retryDelaySeconds}),
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
    WHERE id = ${job.id}
  `;
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
    const scheduledCount = await scheduleDueRefreshes(sql);
    const promotedJobId = await promoteOutbox(sql);
    const job = await claimJob(sql, workerId);
    if (!job) return { status: "idle", promotedJobId, scheduledCount };
    try {
      const batch = await callAgent(agentUrl, token, job);
      const persisted = await persistBatch(sql, job, batch);
      await finishJob(sql, job, { traceId: batch.trace_id, ...persisted });
      return { status: "done", jobId: job.id, traceId: batch.trace_id, scheduledCount, ...persisted };
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

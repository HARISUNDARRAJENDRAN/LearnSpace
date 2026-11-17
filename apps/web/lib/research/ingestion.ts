import { after } from "next/server";
import postgres from "postgres";

// Matches the worker's ingestion lease, so a crashed attempt is retried only after its lease could have expired.
const REQUEST_WINDOW_SECONDS = 600;

type Sql = ReturnType<typeof postgres>;

/** Marks an unparsed paper as requested; false when it is parsed, failed, or another request holds the window. */
export async function claimPaperIngestion(sql: Sql, resourceId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE catalog.resources r SET metadata = r.metadata || jsonb_build_object('paperIngestionRequestedAt', now())
    WHERE r.id = ${resourceId} AND r.type = 'paper' AND r.deleted_at IS NULL AND r.status <> 'failed'
      AND NOT EXISTS (SELECT 1 FROM catalog.resource_versions v WHERE v.id = r.current_version_id AND v.processing_status = 'ready')
      AND (r.metadata->>'paperIngestionRequestedAt' IS NULL
        OR (r.metadata->>'paperIngestionRequestedAt')::timestamptz < now() - ${REQUEST_WINDOW_SECONDS} * interval '1 second')
    RETURNING r.id`;
  return rows.length > 0;
}

/**
 * Parses a paper that has no ready version, after the response is sent. Every open or poll may call this; an atomic
 * claim on the resource row lets only one request per window download and parse the PDF.
 */
export function requestPaperIngestion(resourceId: string): void {
  const url = process.env.DATABASE_WORKER_URL;
  if (!url) return;
  after(async () => {
    const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
    try {
      if (!(await claimPaperIngestion(sql, resourceId))) return;
      // Loaded only here: the parser forks a child process around a native module, which only this background step needs.
      const [{ ingestPaperById }, { embeddingProvider }] = await Promise.all([import("@learnspace/worker/paper-ingestion"), import("@learnspace/worker/embeddings")]);
      const outcome = await ingestPaperById(sql, resourceId, embeddingProvider());
      console.info(JSON.stringify({ metric: "paper_ingestion_request", resourceId, status: outcome.status }));
    } catch (error) {
      console.warn(JSON.stringify({ metric: "paper_ingestion_request", resourceId, status: "error", error: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
}

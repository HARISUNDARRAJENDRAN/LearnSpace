import { createHash } from "node:crypto";
import type postgres from "postgres";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { redisCommands, recommendationCatalogKey } from "@learnspace/shared/recommendation-cache";
import { validVector } from "@learnspace/shared/recommendation-model";
import { contentEmbeddingText, type EmbeddingProvider } from "./embeddings.js";

type Sql = ReturnType<typeof postgres>;
type Resource = { id: string; title: string; description: string | null; topics: string[]; transcript: string | null; source_hash: string | null; embedding: string | null; attempts: number | null };
const hash = (row: Resource) => createHash("sha256").update(contentEmbeddingText(row)).digest("hex");

async function resources(tx: postgres.TransactionSql, ids: string[], pendingOnly: boolean) {
  return tx<Resource[]>`
    SELECT r.id, r.title, r.description, e.source_hash, e.embedding, e.attempts,
      ARRAY(SELECT c.name FROM catalog.resource_concepts rc JOIN knowledge.concepts c ON c.id = rc.concept_id WHERE rc.resource_id = r.id ORDER BY rc.relevance DESC, c.id LIMIT 12) topics,
      (SELECT string_agg(s.content, E'\n' ORDER BY s.ordinal) FROM (SELECT content, ordinal FROM retrieval.resource_chunks WHERE resource_version_id = r.current_version_id ORDER BY ordinal LIMIT 3) s) transcript
    FROM catalog.resources r LEFT JOIN discovery.resource_embeddings e ON e.resource_id = r.id AND e.model = ${config.embeddingModel}
    WHERE (${ids.length === 0} OR r.id = ANY(${ids}::uuid[])) AND r.type = 'video' AND r.status = 'ready' AND r.deleted_at IS NULL
      AND (NOT ${pendingOnly} OR (e.resource_id IS NULL OR e.retry_at <= now()) AND
        (e.resource_id IS NULL OR r.updated_at > e.updated_at OR e.embedding IS NULL AND e.attempts < ${config.embeddingRetryLimit}))
    ORDER BY r.updated_at, r.id LIMIT ${config.embeddingBatchSize} FOR UPDATE OF r SKIP LOCKED
  `;
}

export async function backfillResourceEmbeddings(db: Sql, provider: EmbeddingProvider | null, resourceIds: string[] = []): Promise<{ embedded: number; failed: number }> {
  if (!provider) return { embedded: 0, failed: 0 };
  const batch = await db.begin(async (tx) => {
    const pending = [];
    for (const row of await resources(tx, resourceIds, true)) {
      const sourceHash = hash(row);
      if (sourceHash === row.source_hash && row.embedding) {
        await tx`UPDATE discovery.resource_embeddings SET updated_at = now() WHERE resource_id = ${row.id} AND model = ${config.embeddingModel}`;
        continue;
      }
      // retry_at doubles as a bounded lease. Its exact database timestamp is the
      // claim token, so an expired request cannot overwrite a later worker's claim.
      const [claim] = await tx<{ lease: string }[]>`
        INSERT INTO discovery.resource_embeddings (resource_id, model, source_hash, retry_at)
        VALUES (${row.id}, ${config.embeddingModel}, ${sourceHash}, now() + make_interval(secs => ${config.embeddingLeaseSeconds}))
        ON CONFLICT (resource_id, model) DO UPDATE SET source_hash = EXCLUDED.source_hash,
          embedding = NULL, retry_at = EXCLUDED.retry_at
        RETURNING retry_at::text lease`;
      pending.push({ row, hash: sourceHash, lease: claim!.lease, text: contentEmbeddingText(row) });
    }
    return pending;
  });
  if (!batch.length) return { embedded: 0, failed: 0 };

  let vectors: number[][] | null = null;
  let failure = "Embedding failed";
  try {
    vectors = await provider.embedDocuments(batch.map((item) => item.text));
    if (vectors.length !== batch.length || !vectors.every((vector) => validVector(vector))) throw new Error("Invalid embedding provider response");
  } catch (error) {
    vectors = null;
    failure = error instanceof Error ? error.message.slice(0, 200) : failure;
    console.warn(JSON.stringify({ metric: "embedding_failure_count", count: batch.length }));
  }

  const result = await db.begin(async (tx) => {
    let embedded = 0, failed = 0;
    const current = new Map((await resources(tx, batch.map((item) => item.row.id), false)).map((row) => [row.id, row]));
    for (const [index, item] of batch.entries()) {
      const row = current.get(item.row.id);
      if (!row) continue;
      if (hash(row) !== item.hash) {
        await tx`UPDATE discovery.resource_embeddings SET retry_at = now(), attempts = 0
          WHERE resource_id = ${row.id} AND model = ${config.embeddingModel} AND source_hash = ${item.hash} AND retry_at = ${item.lease}::text::timestamptz`;
        continue;
      }
      const attempts = item.hash === item.row.source_hash ? (item.row.attempts ?? 0) + 1 : 1;
      const updated = vectors
        ? await tx`UPDATE discovery.resource_embeddings SET embedding = ${JSON.stringify(vectors[index])}::vector,
            attempts = 0, last_error = NULL, retry_at = now(), updated_at = now()
            WHERE resource_id = ${row.id} AND model = ${config.embeddingModel} AND source_hash = ${item.hash} AND retry_at = ${item.lease}::text::timestamptz RETURNING resource_id`
        : await tx`UPDATE discovery.resource_embeddings SET attempts = ${attempts}, last_error = ${failure},
            retry_at = now() + make_interval(secs => ${Math.min(3600, 30 * 2 ** attempts)}), updated_at = now()
            WHERE resource_id = ${row.id} AND model = ${config.embeddingModel} AND source_hash = ${item.hash} AND retry_at = ${item.lease}::text::timestamptz RETURNING resource_id`;
      if (vectors) embedded += updated.length;
      else failed += updated.length;
    }
    return { embedded, failed };
  });
  if (result.embedded) await redisCommands([["INCR", recommendationCatalogKey]]);
  return result;
}

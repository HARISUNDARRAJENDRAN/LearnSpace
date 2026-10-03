import { createHash } from "node:crypto";
import type postgres from "postgres";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { redisCommands, recommendationCatalogKey } from "@learnspace/shared/recommendation-cache";
import { validVector } from "@learnspace/shared/recommendation-model";
import { contentEmbeddingText, type EmbeddingProvider } from "./embeddings.js";

type Sql = ReturnType<typeof postgres>;
export async function backfillResourceEmbeddings(db: Sql, provider: EmbeddingProvider | null, resourceIds: string[] = []): Promise<{ embedded: number; failed: number }> {
  if (!provider) return { embedded: 0, failed: 0 };
  const result = await db.begin(async (tx) => {
    const rows = await tx<{ id: string; title: string; description: string | null; topics: string[]; transcript: string | null; source_hash: string | null; embedding: string | null; attempts: number | null }[]>`
      SELECT r.id, r.title, r.description, e.source_hash, e.embedding, e.attempts,
        ARRAY(SELECT c.name FROM catalog.resource_concepts rc JOIN knowledge.concepts c ON c.id = rc.concept_id WHERE rc.resource_id = r.id ORDER BY rc.relevance DESC LIMIT 12) topics,
        (SELECT string_agg(s.content, E'\n') FROM (SELECT content FROM retrieval.resource_chunks WHERE resource_version_id = r.current_version_id ORDER BY ordinal LIMIT 3) s) transcript
      FROM catalog.resources r LEFT JOIN discovery.resource_embeddings e ON e.resource_id = r.id AND e.model = ${config.embeddingModel}
      WHERE (${resourceIds.length === 0} OR r.id = ANY(${resourceIds}::uuid[])) AND r.type = 'video' AND r.status = 'ready' AND r.deleted_at IS NULL
        AND (e.resource_id IS NULL OR r.updated_at > e.updated_at OR (e.embedding IS NULL AND e.attempts < ${config.embeddingRetryLimit} AND e.retry_at <= now()))
      ORDER BY r.updated_at, r.id LIMIT ${config.embeddingBatchSize} FOR UPDATE OF r SKIP LOCKED
    `;
    const pending = rows.map((row) => { const text = contentEmbeddingText(row); return { row, text, hash: createHash("sha256").update(text).digest("hex") }; });
    const changed = pending.filter((item) => item.hash !== item.row.source_hash || !item.row.embedding);
    for (const item of pending.filter((item) => item.hash === item.row.source_hash && item.row.embedding)) await tx`UPDATE discovery.resource_embeddings SET updated_at = now() WHERE resource_id = ${item.row.id} AND model = ${config.embeddingModel}`;
    if (!changed.length) return { embedded: 0, failed: 0 };
    try {
      const vectors = await provider.embedDocuments(changed.map((item) => item.text));
      if (vectors.length !== changed.length || !vectors.every((vector) => validVector(vector))) throw new Error("Invalid embedding provider response");
      for (const [index, item] of changed.entries()) await tx`
        INSERT INTO discovery.resource_embeddings (resource_id, model, source_hash, embedding, updated_at) VALUES (${item.row.id}, ${config.embeddingModel}, ${item.hash}, ${JSON.stringify(vectors[index])}::vector, now())
        ON CONFLICT (resource_id, model) DO UPDATE SET embedding = EXCLUDED.embedding, source_hash = EXCLUDED.source_hash, attempts = 0, last_error = NULL, updated_at = now()
      `;
      return { embedded: changed.length, failed: 0 };
    } catch (error) {
      for (const item of changed) {
        const attempts = item.hash === item.row.source_hash ? (item.row.attempts ?? 0) + 1 : 1;
        await tx`INSERT INTO discovery.resource_embeddings (resource_id, model, source_hash, attempts, retry_at, last_error) VALUES (${item.row.id}, ${config.embeddingModel}, ${item.hash}, ${attempts}, now() + make_interval(secs => ${Math.min(3600, 30 * 2 ** attempts)}), ${error instanceof Error ? error.message.slice(0, 200) : "Embedding failed"}) ON CONFLICT (resource_id, model) DO UPDATE SET embedding = NULL, source_hash = EXCLUDED.source_hash, attempts = EXCLUDED.attempts, retry_at = EXCLUDED.retry_at, last_error = EXCLUDED.last_error, updated_at = now()`;
      }
      console.warn(JSON.stringify({ metric: "embedding_failure_count", count: changed.length }));
      return { embedded: 0, failed: changed.length };
    }
  });
  if (result.embedded) await redisCommands([["INCR", recommendationCatalogKey]]);
  return result;
}

import type { Transaction } from "@learnspace/db";
import { sql } from "drizzle-orm";
import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { validVector } from "@learnspace/shared/recommendation-model";

export async function retrieveRecommendationCandidates(tx: Transaction, userId: string, vector: number[] | null, topicIds: string[], focused: boolean): Promise<{ ids: string[]; similarities: Map<string, number>; continuationIds: string[]; fallback: boolean; annMs: number }> {
  const topicFilter = topicIds.length ? sql`EXISTS (SELECT 1 FROM catalog.resource_concepts rc WHERE rc.resource_id = r.id AND rc.concept_id = ANY(ARRAY[${sql.join(topicIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]) AND rc.relevance >= ${config.minimumTopicRelevance})` : sql`TRUE`;
  const eligible = sql`r.type = 'video' AND r.owner_user_id IS NULL AND r.visibility IN ('public','unlisted') AND r.status = 'ready' AND r.deleted_at IS NULL
    AND (${process.env.AUTH_TEST_MODE === 'true' && process.env.NODE_ENV !== 'production'} OR (coalesce(r.metadata->>'test', 'false') <> 'true' AND coalesce(r.metadata->>'sample', 'false') <> 'true'))
    AND coalesce(r.quality_score, .5) >= ${config.qualityFloor}
    AND NOT EXISTS (SELECT 1 FROM catalog.library_items li WHERE li.user_id = ${userId} AND li.resource_id = r.id AND li.status = 'removed')
    AND NOT EXISTS (SELECT 1 FROM study.user_resource_progress p WHERE p.user_id = ${userId} AND p.resource_id = r.id AND (p.completed_at IS NOT NULL OR p.status = 'completed') AND NOT EXISTS (SELECT 1 FROM catalog.resource_concepts rc JOIN knowledge.concept_mastery m ON m.concept_id = rc.concept_id AND m.user_id = ${userId} WHERE rc.resource_id = r.id AND m.next_review_at <= now() AND coalesce(p.completed_at, p.updated_at) < now() - interval '7 days'))`;
  let ann: Array<{ id: string; similarity: number }> = [];
  let fallback = !validVector(vector);
  const started = performance.now();
  if (validVector(vector)) {
    try {
      ann = await tx.transaction(async (savepoint) => {
        await savepoint.execute(sql`SELECT set_config('hnsw.ef_search', ${String(config.annEfSearch)}, true)`);
        await savepoint.execute(sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);
        const result = await savepoint.execute(sql`SELECT r.id, 1 - (e.embedding <=> ${JSON.stringify(vector)}::vector) similarity FROM discovery.resource_embeddings e JOIN catalog.resources r ON r.id = e.resource_id WHERE e.model = ${config.embeddingModel} AND e.embedding IS NOT NULL AND ${eligible} AND ${focused ? topicFilter : sql`TRUE`} ORDER BY e.embedding <=> ${JSON.stringify(vector)}::vector LIMIT ${config.semanticCandidates}`);
        return Array.from(result) as Array<{ id: string; similarity: number }>;
      });
      fallback = ann.length === 0;
    } catch { fallback = true; }
  }
  const annMs = performance.now() - started;
  const [topicRows, qualityRows, progressionRows] = await Promise.all([
    topicIds.length ? tx.execute(sql`SELECT r.id FROM catalog.resources r WHERE ${eligible} AND ${topicFilter} ORDER BY r.quality_score DESC NULLS LAST, r.id LIMIT ${fallback ? config.candidateCount - config.qualityCandidates : config.topicCandidates}`) : Promise.resolve([]),
    tx.execute(sql`SELECT r.id FROM catalog.resources r WHERE ${eligible} AND ${focused ? topicFilter : sql`TRUE`} ORDER BY r.quality_score DESC NULLS LAST, r.id LIMIT ${topicIds.length ? config.qualityCandidates : config.candidateCount}`),
    tx.execute(sql`SELECT next.id FROM catalog.collection_enrollments en JOIN catalog.collection_items current ON current.id = en.current_item_id JOIN catalog.collection_sections current_section ON current_section.id = current.section_id JOIN LATERAL (SELECT r.id FROM catalog.collection_items ci JOIN catalog.collection_sections next_section ON next_section.id = ci.section_id JOIN catalog.resources r ON r.id = ci.resource_id WHERE next_section.collection_id = current_section.collection_id AND (next_section.position > current_section.position OR next_section.position = current_section.position AND ci.position >= current.position) AND ${eligible} AND ${focused ? topicFilter : sql`TRUE`} ORDER BY next_section.position, ci.position LIMIT 1) next ON true WHERE en.user_id = ${userId} AND en.status = 'active' LIMIT 5`),
  ]);
  const idsFrom = (result: unknown) => Array.from(result as Array<{ id: string }>).map((row) => row.id);
  const continuationIds = idsFrom(progressionRows);
  const ids = [...new Set([...continuationIds, ...ann.map((row) => row.id), ...idsFrom(topicRows), ...idsFrom(qualityRows)])].slice(0, config.candidateCount);
  return { ids, similarities: new Map(ann.map((row) => [row.id, Math.max(0, Math.min(1, Number(row.similarity)))])), continuationIds, fallback, annMs };
}

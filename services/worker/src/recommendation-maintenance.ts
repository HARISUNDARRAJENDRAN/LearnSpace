import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { RECOMMENDATION_CONFIG as config, semanticRecommendationsEnabled } from "@learnspace/shared/recommendation-config";
import { embeddingProvider } from "./embeddings.js";
import { backfillResourceEmbeddings } from "./recommendation-embeddings.js";
import { projectRecommendationProfiles } from "./recommendation-profiles.js";
import { syncCuratedCatalog } from "./curated-catalog.js";

let syncedAt = 0;
let lastRun = 0;
export async function recommendationMaintenance(db: ReturnType<typeof postgres>, signal?: AbortSignal) {
  if (!semanticRecommendationsEnabled() || Date.now() - lastRun < config.maintenanceIntervalMs) return;
  lastRun = Date.now();
  const file = process.env.CURRICULUM_PATH ?? fileURLToPath(new URL("../../../apps/web/public/data/learnspace_youtube_curriculum_master.csv", import.meta.url));
  try {
    const modified = (await stat(file)).mtimeMs;
    if (modified !== syncedAt) { await syncCuratedCatalog(db); syncedAt = modified; }
  } catch (error) { console.warn(JSON.stringify({ metric: "recommendation_catalog_sync_failure", error: error instanceof Error ? error.message : "catalog sync failed" })); }
  const provider = embeddingProvider();
  // Separate failures: delayed embeddings must not stop behavioural projection.
  await projectRecommendationProfiles(db, provider, [], signal);
  if (signal?.aborted) return;
  try { await backfillResourceEmbeddings(db, provider); } catch (error) { console.warn(JSON.stringify({ metric: "embedding_failure_count", error: error instanceof Error ? error.message : "backfill failed" })); }
}

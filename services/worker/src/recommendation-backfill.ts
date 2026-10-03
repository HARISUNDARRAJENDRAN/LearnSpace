import postgres from "postgres";
import { embeddingProvider } from "./embeddings.js";
import { backfillResourceEmbeddings } from "./recommendation-embeddings.js";
import { projectRecommendationProfiles } from "./recommendation-profiles.js";
import { syncCuratedCatalog } from "./curated-catalog.js";
import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";

const batches = Number(process.argv.find((arg) => arg.startsWith("--batches="))?.split("=")[1] ?? 1);
if (!Number.isInteger(batches) || batches < 1 || batches > 1000) throw new Error("--batches must be between 1 and 1000");
if (!process.env.DATABASE_WORKER_URL) throw new Error("DATABASE_WORKER_URL is required");
const provider = embeddingProvider();
if (!provider) throw new Error("OPENAI_API_KEY is required for the embedding backfill");
const db = postgres(process.env.DATABASE_WORKER_URL, { max: 1, prepare: false });
try {
  console.info(JSON.stringify({ curatedResourcesUpdated: await syncCuratedCatalog(db) }));
  for (let batch = 1; batch <= batches; batch++) {
    const result = await backfillResourceEmbeddings(db, provider);
    console.info(JSON.stringify({ batch, ...result }));
    if (!result.embedded && !result.failed) break;
  }
  console.info(JSON.stringify({ profilesUpdated: await projectRecommendationProfiles(db, provider) }));
} finally { await db.end(); await closeRecommendationRedis(); }

import postgres from "postgres";
import { closeRecommendationRedis, recommendationCatalogKey, redisCommands } from "@learnspace/shared/recommendation-cache";
import { purgeExpiredYoutubeStatistics, recomputeYoutubeQuality, refreshYoutubeMetrics } from "./youtube-metrics.js";

// One-off: enrich every stale video (curated and discovered), then rescore all of them.
if (!process.env.DATABASE_WORKER_URL) throw new Error("DATABASE_WORKER_URL is required");
if (!process.env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is required for the YouTube backfill");
const db = postgres(process.env.DATABASE_WORKER_URL, { max: 1, prepare: false });
try {
  const total = { videos: 0, channels: 0, gated: 0, quotaUnits: 0 };
  for (;;) {
    const batch = await refreshYoutubeMetrics(db);
    total.videos += batch.videos; total.channels += batch.channels; total.gated += batch.gated; total.quotaUnits += batch.quotaUnits;
    if (!batch.videos || batch.quotaCapped || batch.error) {
      if (batch.quotaCapped || batch.error) console.warn(JSON.stringify({ stopped: batch.quotaCapped ? "quota_cap" : batch.error }));
      break;
    }
  }
  const purged = await purgeExpiredYoutubeStatistics(db);
  const rescored = await recomputeYoutubeQuality(db);
  await redisCommands([["INCR", recommendationCatalogKey]]);
  console.info(JSON.stringify({ ...total, purged, rescored }));
} finally { await db.end(); await closeRecommendationRedis(); }

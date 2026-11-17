import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";
import { runDiscoveryWorker, runDiscoveryWorkerLoop } from "./discovery.js";
import { runPaperIngestionWorker } from "./paper-ingestion.js";

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
const loop = process.argv.includes("--loop");
const [discovery, paperIngestion] = await Promise.all([
  loop ? runDiscoveryWorkerLoop({ signal: stop.signal }) : runDiscoveryWorker(),
  runPaperIngestionWorker({ loop, signal: stop.signal }),
]);
process.stdout.write(`${JSON.stringify({ discovery, paperIngestion })}\n`);
await closeRecommendationRedis();

import { runDiscoveryWorker, runDiscoveryWorkerLoop } from "./discovery.js";

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
const result = process.argv.includes("--loop")
  ? await runDiscoveryWorkerLoop({ signal: stop.signal })
  : await runDiscoveryWorker();
process.stdout.write(`${JSON.stringify(result)}\n`);

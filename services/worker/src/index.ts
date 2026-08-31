import { runDiscoveryWorker } from "./discovery.js";

const result = await runDiscoveryWorker();
process.stdout.write(`${JSON.stringify(result)}\n`);

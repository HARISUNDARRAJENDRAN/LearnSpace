let started = false;

/**
 * Downloads the speech models (~360 MB, once per browser) in the background when the learner enters the app, so talking
 * with Luna or dictating never waits on a download. Skipped on data saver and slow connections: there they still
 * download on first use.
 */
export function prefetchSpeechModels() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (started || typeof caches === "undefined" || connection?.saveData || /2g/.test(connection?.effectiveType ?? "")) return;
  started = true;
  new Worker(new URL("./prefetch.worker.ts", import.meta.url), { type: "module" });
}

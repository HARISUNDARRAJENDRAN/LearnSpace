import { pickListener } from "./models";
import type { PrefetchRequest } from "./prefetch.worker";

let started = false;

/**
 * Downloads Luny's speech models (Supertonic, Silero and Moonshine, plus Parakeet where the device will use it: ~120 MB, or
 * ~480 MB with Parakeet, once per browser) in the background from onboarding or entering the app, so talking with Luny or
 * dictating never waits on a download. Skipped on data saver and slow connections: there they still download on first use.
 */
export function prefetchSpeechModels() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (started || typeof caches === "undefined" || connection?.saveData || /2g/.test(connection?.effectiveType ?? "")) return;
  started = true;
  void pickListener().then((listener) => {
    new Worker(new URL("./prefetch.worker.ts", import.meta.url), { type: "module" }).postMessage({ listener } satisfies PrefetchRequest);
  });
}

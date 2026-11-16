import { env } from "@huggingface/transformers";

// The background prefetch and the listener both fetch model files; one tab's prefetch can be mid-download when the
// learner opens Luny. A lock per file makes the second caller wait for that download instead of fetching it alongside
// (twice the bytes over the same connection), and the downloader posts its progress so the waiting one can show it.
const progress = new BroadcastChannel("learnspace:model-download");
type Progress = { url: string; loaded: number };
// A download that receives nothing for this long has stalled. A waiter that hears nothing for this long takes the
// download over: the holder may be a frozen background tab, which keeps its lock but runs nothing.
const STALL_MS = 30_000;

async function download(url: string, priority: RequestPriority, onLoaded?: (loaded: number) => void) {
  const cache = await caches.open(env.cacheKey);
  if (await cache.match(url)) return;
  const stalled = new AbortController();
  let idle = setTimeout(() => stalled.abort(new Error(`${url}: no data for ${STALL_MS / 1_000} s`)), STALL_MS);
  try {
    const response = await fetch(url, { priority, signal: stalled.signal });
    if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
    let loaded = 0;
    const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        clearTimeout(idle);
        idle = setTimeout(() => stalled.abort(new Error(`${url}: no data for ${STALL_MS / 1_000} s`)), STALL_MS);
        loaded += chunk.byteLength;
        progress.postMessage({ url, loaded } satisfies Progress);
        onLoaded?.(loaded);
        controller.enqueue(chunk);
      },
    }));
    // Streamed to disk, never held in memory; a download cut short fails the put and is never stored.
    await cache.put(url, new Response(counted, { headers: response.headers }));
  } finally {
    clearTimeout(idle);
  }
}

/**
 * Downloads a model file into the browser's model cache (the one transformers.js keeps its own files in), unless it is
 * there; `onLoaded` gets the bytes so far, whoever is downloading.
 */
export async function storeFile(url: string, priority: RequestPriority = "auto", onLoaded?: (loaded: number) => void): Promise<void> {
  const quiet = new AbortController();
  let granted = false;
  let timer = setTimeout(() => quiet.abort(), STALL_MS);
  const listen = (event: MessageEvent<Progress>) => {
    if (event.data.url !== url) return;
    clearTimeout(timer);
    timer = setTimeout(() => quiet.abort(), STALL_MS);
    onLoaded?.(event.data.loaded);
  };
  progress.addEventListener("message", listen);
  const own = () => {
    granted = true;
    clearTimeout(timer);
    progress.removeEventListener("message", listen);
    return download(url, priority, onLoaded);
  };
  try {
    await navigator.locks.request(url, { signal: quiet.signal }, own);
  } catch (error) {
    if (granted || !quiet.signal.aborted) throw error;
    await navigator.locks.request(url, { steal: true }, own);
  } finally {
    clearTimeout(timer);
    progress.removeEventListener("message", listen);
  }
}

/** A model file from the cache, downloaded first if needed. `bytes` is its exact size: a copy of another size is dropped. */
export async function cachedFile(url: string, bytes: number, onLoaded: (loaded: number) => void): Promise<Uint8Array> {
  await storeFile(url, "auto", onLoaded);
  const cache = await caches.open(env.cacheKey);
  const hit = await cache.match(url);
  const buffer = hit ? new Uint8Array(await hit.arrayBuffer()) : new Uint8Array();
  if (buffer.byteLength !== bytes) {
    await cache.delete(url);
    throw new Error(`${url}: cached ${buffer.byteLength} bytes, expected ${bytes}`);
  }
  onLoaded(bytes);
  return buffer;
}

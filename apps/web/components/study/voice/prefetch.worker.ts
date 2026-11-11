import { env, ModelRegistry } from "@huggingface/transformers";
import { DICTATION_MODEL, LISTEN_MODEL, SPEAK_MODEL, SPEAK_VOICE, VAD_MODEL } from "./models";

// Puts every file the speech models read into transformers.js's own cache, under the same keys it looks them up by, and
// loads nothing: the models take memory only once the learner starts talking, and then read from disk, not the network.
const hubUrl = (model: string, file: string) => `${env.remoteHost}${env.remotePathTemplate.replaceAll("{model}", model).replaceAll("{revision}", "main")}${file}`;

async function prefetch() {
  const cache = await caches.open(env.cacheKey);
  const lists = await Promise.all([
    ...[LISTEN_MODEL, SPEAK_MODEL, DICTATION_MODEL].map(({ task, model, options }) => ModelRegistry.get_pipeline_files(task, model, options).then((files) => files.map((file) => hubUrl(model, file)))),
    ModelRegistry.get_files(VAD_MODEL.model, VAD_MODEL.options as never).then((files) => files.map((file) => hubUrl(VAD_MODEL.model, file))),
  ]);
  // One file at a time, at low priority, so the lesson the learner opened loads first.
  for (const url of [SPEAK_VOICE, ...lists.flat()]) {
    if (await cache.match(url)) continue;
    const response = await fetch(url, { priority: "low" });
    if (response.ok) await cache.put(url, response);
  }
}

prefetch().catch((error: unknown) => console.warn("Speech models were not prefetched; they download on first use.", error)).finally(() => self.close());

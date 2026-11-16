import { env, ModelRegistry } from "@huggingface/transformers";
import { storeFile } from "./cache";
import { type Listener, MOONSHINE, PARAKEET_FILES, SPEAK_MODEL, SPEAK_VOICE, VAD_FILE, VAD_MODEL, vadRuntime } from "./models";

export type PrefetchRequest = { listener: Listener };

// Puts every file the speech models read into the models' cache, under the same keys they are looked up by, and loads
// nothing: the models take memory only once the learner starts talking, and then read from disk, not the network.
const hubUrl = (model: string, file: string) => `${env.remoteHost}${env.remotePathTemplate.replaceAll("{model}", model).replaceAll("{revision}", "main")}${file}`;

async function prefetch(listener: Listener) {
  const lists = await Promise.all([
    ...[SPEAK_MODEL, MOONSHINE].map(({ task, model, options }) => ModelRegistry.get_pipeline_files(task, model, options).then((files) => files.map((file) => hubUrl(model, file)))),
    // Silero has no tokenizer or processor; asking for them only logs two 404s per visit.
    ModelRegistry.get_files(VAD_MODEL.model, { ...VAD_MODEL.options, include_tokenizer: false, include_processor: false } as never).then((files) => files.map((file) => hubUrl(VAD_MODEL.model, file))),
  ]);
  // One file at a time, at low priority, so the lesson the learner opened loads first.
  const parakeet = listener === "parakeet" ? Object.values(PARAKEET_FILES).map((file) => file.url) : [];
  // Silero's worker reads its file and ONNX Runtime's plain WASM build directly (see vad.worker.ts).
  const version = env.backends.onnx.versions?.web;
  const silero = version ? [VAD_FILE, vadRuntime(version)] : [VAD_FILE];
  for (const url of [...new Set([SPEAK_VOICE, ...silero, ...lists.flat(), ...parakeet])]) await storeFile(url, "low");
}

self.onmessage = (event: MessageEvent<PrefetchRequest>) => {
  prefetch(event.data.listener).catch((error: unknown) => console.warn("Speech models were not prefetched; they download on first use.", error)).finally(() => self.close());
};

import { type AutomaticSpeechRecognitionPipeline, ModelRegistry, pipeline } from "@huggingface/transformers";

// Moonshine Base (61M parameters) is the most accurate speech model of its size that transformers.js runs in the browser.
// int8 weights keep the one-time download near 62 MB; transformers.js keeps them in the browser's Cache API after that, and audio never leaves the device.
const MODEL = "onnx-community/moonshine-base-ONNX";
const OPTIONS = { device: "wasm", dtype: "q8" } as const;

export type SpeechRequest = { type: "load" } | { type: "transcribe"; audio: Float32Array };
/** `download` reports progress only for a real first-time download; reading the cached model is silent. */
export type SpeechReply = { type: "download"; progress: number } | { type: "ready" } | { type: "text"; text: string } | { type: "error" };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const reply = (message: SpeechReply) => self.postMessage(message);

async function create(): Promise<AutomaticSpeechRecognitionPipeline> {
  const cached = await ModelRegistry.is_pipeline_cached("automatic-speech-recognition", MODEL, OPTIONS).catch(() => false);
  if (cached) return pipeline("automatic-speech-recognition", MODEL, OPTIONS);
  return pipeline("automatic-speech-recognition", MODEL, {
    ...OPTIONS,
    progress_callback: (info) => { if (info.status === "progress_total") reply({ type: "download", progress: info.progress }); },
  });
}

self.onmessage = async (event: MessageEvent<SpeechRequest>) => {
  try {
    asr ??= create();
    const transcribe = await asr;
    if (event.data.type === "load") return reply({ type: "ready" });
    const output = await transcribe(event.data.audio);
    reply({ type: "text", text: (Array.isArray(output) ? output[0]?.text ?? "" : output.text).trim() });
  } catch (error) {
    // A failed download is retried on the next request instead of being cached as broken.
    asr = null;
    console.error(error);
    reply({ type: "error" });
  }
};

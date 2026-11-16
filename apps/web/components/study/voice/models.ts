import { LISTEN_MODEL } from "../speech-model";

// The on-device speech models Luny listens and speaks with, named once for the workers and the prefetch.

/** Silero decides when the learner is speaking. */
export const VAD_MODEL = { model: "onnx-community/silero-vad", options: { config: { model_type: "custom" }, dtype: "fp32" } } as const;
/** Silero's one file (VAD_MODEL's fp32 weights), read directly by its worker. */
export const VAD_FILE = `https://huggingface.co/${VAD_MODEL.model}/resolve/main/onnx/model.onnx`;
/** ONNX Runtime's plain WASM build, which Silero's worker runs on (see vad.worker.ts), for the runtime's `version`. */
export const ortDist = (version: string) => `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
export const vadRuntime = (version: string) => `${ortDist(version)}ort-wasm-simd-threaded.wasm`;
/** Moonshine Base hears the learner on devices without a usable GPU; dictation uses the same model, so it downloads once. */
export const MOONSHINE = LISTEN_MODEL;
/** Supertonic (66M) speaks Luny's replies, on the CPU everywhere: it runs about five times faster than real time on a 2020 laptop. */
export const SPEAK_MODEL = { task: "text-to-speech", model: "onnx-community/Supertonic-TTS-ONNX", options: { device: "wasm", dtype: "fp32", session_options: { enableMemPattern: false } } } as const;
export const SPEAK_VOICE = `https://huggingface.co/${SPEAK_MODEL.model}/resolve/main/voices/F1.bin`;

/**
 * Parakeet Redux (moondream/parakeet-redux): NVIDIA's Parakeet TDT 0.6B v3 with a ternary encoder, within 0.3 points of
 * its English WER (6.55%) at a seventh of the size. Its encoder runs on WebGPU, which Chrome runs on Vulkan, Metal or
 * D3D12, so integrated GPUs (Intel Iris Xe, Apple M-series, Adreno) take it too; the preprocessor and the TDT decoder run
 * on WASM. The revision is pinned, so the sizes below are exact and a cached file can be checked against them.
 */
const PARAKEET_BASE = "https://huggingface.co/mrfakename/parakeet-redux-ONNX/resolve/0f1264f3ce3bcdab31eac2f04cdd5b720eb5fda7/";
export const PARAKEET_FILES = {
  preprocessor: { url: `${PARAKEET_BASE}preprocessor.onnx`, bytes: 1_224_294 },
  encoder: { url: `${PARAKEET_BASE}encoder-model.onnx`, bytes: 343_841_943 },
  decoder: { url: `${PARAKEET_BASE}decoder_joint-model.int8.onnx`, bytes: 18_221_404 },
  vocab: { url: `${PARAKEET_BASE}vocab.txt`, bytes: 93_939 },
} as const;

export type Listener = "parakeet" | "moonshine";
/** Set once Parakeet failed or ran too slowly on this device, so later sessions go straight to Moonshine. */
export const LISTENER_KEY = "learnspace:voice-listener";

type DeviceNavigator = Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean }; connection?: { saveData?: boolean; effectiveType?: string } };

/**
 * Parakeet needs a hardware WebGPU adapter, a desktop's memory (about 0.7 GB while it loads) and a 360 MB download;
 * phones, small devices, data saver and software-only GPUs get Moonshine (62 MB, CPU). The warm-up in the listen worker
 * then checks the GPU is actually fast enough.
 */
export async function pickListener(): Promise<Listener> {
  const device = navigator as DeviceNavigator;
  const mobile = device.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || (device.deviceMemory ?? 8) < 4 || device.connection?.saveData || /2g/.test(device.connection?.effectiveType ?? "")) return "moonshine";
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(LISTENER_KEY) === "moonshine") return "moonshine";
  } catch {
    // Storage can be blocked; the device checks still apply.
  }
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
  const info = adapter?.info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined;
  return adapter && !info?.isFallbackAdapter ? "parakeet" : "moonshine";
}

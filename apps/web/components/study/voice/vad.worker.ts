import * as ort from "onnxruntime-web/wasm";
import { ortDist, VAD_FILE, vadRuntime } from "./models";
import { Endpointer, FRAME, type Utterance } from "./vad";

// Silero decides when the learner is speaking, in a worker of its own: it runs 31 times a second, so it must never wait
// behind a transcription (sharing the listener's worker, a barge-in or a turn's end was only heard once the words before
// were written down), and in one worker, ONNX Runtime's thread pool, which the listener needs, spins after each of its frames.
//
// It runs on ONNX Runtime's plain WASM build, not the one transformers.js loads for the listener and Luny's voice: the same
// runtime and the same CPU kernels, so the same scores, but a separate, 14 MB module. A third copy of transformers.js's
// 27 MB module made Chrome compile that module's optimised tier on two cores for the first half-minute, slowing Luny's
// first answers by half a second. One thread: a frame is too little work to share out.
const VERSION = ort.env.versions.web as string;
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = ortDist(VERSION);
// Silero's file and the runtime's WASM sit in the models' cache under their URLs, where transformers.js and the prefetch
// keep theirs, so they download once.
const MODEL_CACHE = "transformers-cache";
const SAMPLE_RATE = 16_000;

/**
 * From the page: `frames` is the port the microphone's worklet posts 16 kHz frames to (each with when it was captured),
 * `listener` the port to the listener; frames count only while `active` (all of Luny's models are ready). `epoch` is the
 * page's count of resets: every utterance carries it, so words heard before a reset are recognised as such wherever they are.
 */
export type VadRequest =
  | { type: "load" }
  | { type: "connect"; frames: MessagePort; listener?: MessagePort }
  | { type: "active"; active: boolean }
  | { type: "playing"; playing: boolean }
  | { type: "reset"; epoch: number };
/** `speech` fires once per utterance, as soon as it is clearly the learner talking. */
export type VadReply = { type: "ready" } | { type: "speech" } | { type: "error" };
export type { Utterance };

const reply = (message: VadReply) => self.postMessage(message);
let listener: MessagePort | null = null;
let frames: MessagePort | null = null;
let model: Promise<ort.InferenceSession> | null = null;
let ready = false;
let active = false;

async function cached(url: string) {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    // Stored alongside, not awaited: the runtime starts from the bytes in hand.
    void cache?.put(url, response.clone()).catch(() => undefined);
  }
  return response.arrayBuffer();
}

async function load() {
  const [runtime, weights] = await Promise.all([cached(vadRuntime(VERSION)), cached(VAD_FILE)]);
  ort.env.wasm.wasmBinary = runtime;
  return ort.InferenceSession.create(new Uint8Array(weights), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
const silent = () => new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let state: ort.Tensor = silent();

const endpointer = new Endpointer({
  score: async (input) => {
    const session = await (model as Promise<ort.InferenceSession>);
    const { output, stateN } = await session.run({ input: new ort.Tensor("float32", input, [1, FRAME]), sr, state });
    state.dispose();
    state = stateN as ort.Tensor;
    const probability = ((output as ort.Tensor).data as Float32Array)[0] ?? 0;
    output?.dispose();
    return probability;
  },
  speech: () => reply({ type: "speech" }),
  // Each guess goes to the listener transferred, not copied.
  utterance: (message: Utterance) => listener?.postMessage(message, message.type === "guess" ? [message.audio.buffer] : []),
  error: (error) => { console.error(error); reply({ type: "error" }); },
});
const listen = () => { endpointer.active = ready && active; };

self.onmessage = async (event: MessageEvent<VadRequest>) => {
  const message = event.data;
  if (message.type === "connect") {
    frames?.close();
    frames = message.frames;
    frames.onmessage = (frame: MessageEvent<{ frame: Float32Array; at: number }>) => { void endpointer.frame(frame.data.frame, frame.data.at); };
    if (message.listener) listener = message.listener;
    return;
  }
  if (message.type === "active") { active = message.active; listen(); return; }
  if (message.type === "playing") { endpointer.playing = message.playing; return; }
  if (message.type === "reset") {
    endpointer.reset(message.epoch, () => { state.dispose(); state = silent(); });
    return;
  }
  try {
    model ??= load();
    await model;
    ready = true;
    listen();
    reply({ type: "ready" });
  } catch (error) {
    // A failed download is retried on the next start instead of being cached as broken.
    model = null;
    ready = false;
    listen();
    console.error(error);
    reply({ type: "error" });
  }
};

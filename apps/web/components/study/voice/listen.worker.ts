import { AutoModel, env, type AutomaticSpeechRecognitionPipeline, ModelRegistry, type PreTrainedModel, pipeline, Tensor } from "@huggingface/transformers";
import { LISTEN_MODEL, VAD_MODEL } from "./models";

// One thread: Silero runs 31 times a second, and idle ONNX threads spin, taking the cores Luna's voice needs (it ran at
// half speed beside a 4-thread listener). A few seconds of speech still transcribes in ~0.15 s.
env.backends.onnx.wasm!.numThreads = 1;

// Silero decides when the learner is speaking; Moonshine Tiny turns each stretch of speech into text. Both run here, on
// the learner's CPU: a few seconds of speech transcribes in ~0.3 s (WebGPU on integrated GPUs was slower, and wrong).
const SAMPLE_RATE = 16_000;
/** Silero reads 512-sample (32 ms) frames at 16 kHz. */
export const FRAME = 512;
const FRAME_MS = (FRAME / SAMPLE_RATE) * 1_000;
// Speech starts above START and continues while above KEEP; while Luna talks, only clearly louder speech counts, so her
// own voice leaking past echo cancellation never reads as the learner.
const START = 0.5;
const KEEP = 0.25;
const START_WHILE_PLAYING = 0.85;
// A turn ends after this much silence. Short, for speed: a pause mid-thought ends a turn too, but Luna stays silent on an
// unfinished thought, and speech that resumes before she is heard cancels her turn and joins it to what comes next.
const END_SILENCE_MS = 200;
const MIN_SPEECH_MS = 200;
// How long the learner must keep talking over Luna before she stops, so a cough or an "mm" never cuts her off.
const BARGE_IN_MS = 320;
const PAD_FRAMES = 6;
const MAX_SPEECH_MS = 28_000;

export type ListenRequest = { type: "load" } | { type: "frame"; frame: Float32Array } | { type: "playing"; playing: boolean } | { type: "reset" };
/**
 * `speech` fires once per utterance, as soon as it is clearly the learner talking; `final` carries the utterance's text.
 * A `final` that was not `heard` was too short to interrupt Luna: an "mm-hm" while she talks, not a turn.
 */
export type ListenReply =
  | { type: "download"; progress: number }
  | { type: "ready" }
  | { type: "speech" }
  | { type: "final"; text: string; heard: boolean; endedAt: number; transcribedAt: number }
  | { type: "error" };

const reply = (message: ListenReply) => self.postMessage(message);
let models: Promise<{ asr: AutomaticSpeechRecognitionPipeline; vad: PreTrainedModel }> | null = null;

async function create() {
  const { task, model, options } = LISTEN_MODEL;
  const cached = await ModelRegistry.is_pipeline_cached(task, model, options).catch(() => false);
  const [asr, vad] = await Promise.all([
    pipeline(task, model, {
      ...options,
      ...(cached ? {} : { progress_callback: (info: { status: string; progress?: number }) => { if (info.status === "progress_total") reply({ type: "download", progress: info.progress ?? 0 }); } }),
    }),
    AutoModel.from_pretrained(VAD_MODEL.model, VAD_MODEL.options as never),
  ]);
  // The first run sets the model up; doing it now keeps that cost out of the learner's first turn.
  await asr(new Float32Array(SAMPLE_RATE));
  ready = true;
  return { asr, vad };
}

const sr = new Tensor("int64", [SAMPLE_RATE], []);
let state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let epoch = 0;
let ready = false;
let playing = false;
let speaking = false;
let announced = false;
let speechMs = 0;
let silenceMs = 0;
let sinceStart = 0;
let speech: Float32Array[] = [];
const pad: Float32Array[] = [];
// Model calls run one at a time, in order, so frames are judged in sequence and each utterance's text arrives in order.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
};

const join = (parts: Float32Array[]) => {
  const audio = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    audio.set(part, offset);
    offset += part.length;
  }
  return audio;
};

async function transcribe(audio: Float32Array): Promise<string> {
  const { asr } = await models!;
  const output = await asr(audio);
  return (Array.isArray(output) ? output[0]?.text ?? "" : output.text).trim();
}

function finish() {
  const turnEpoch = epoch;
  const audio = join(speech);
  const long = speechMs >= MIN_SPEECH_MS;
  const endedAt = Date.now() - silenceMs;
  const heard = announced;
  speaking = false;
  announced = false;
  speech = [];
  speechMs = 0;
  silenceMs = 0;
  sinceStart = 0;
  if (!long) return;
  void serial(async () => turnEpoch === epoch ? transcribe(audio) : "").then((text) => { if (turnEpoch === epoch) reply({ type: "final", text, heard, endedAt, transcribedAt: Date.now() }); }).catch((error: unknown) => { console.error(error); reply({ type: "error" }); });
}

async function frame(input: Float32Array, frameEpoch: number) {
  if (frameEpoch !== epoch) return;
  const { vad } = await models!;
  const { output, stateN } = await vad({ input: new Tensor("float32", input, [1, FRAME]), sr, state }) as { output: Tensor; stateN: Tensor };
  if (frameEpoch !== epoch) { output.dispose(); stateN.dispose(); return; }
  state.dispose();
  state = stateN;
  const probability = (output.data as Float32Array)[0] ?? 0;
  output.dispose();
  if (!speaking) {
    pad.push(input);
    if (pad.length > PAD_FRAMES) pad.shift();
    if (probability < (playing ? START_WHILE_PLAYING : START)) return;
    speaking = true;
    speech = [...pad];
    pad.length = 0;
    return;
  }
  speech.push(input);
  sinceStart += FRAME_MS;
  if (probability >= KEEP) {
    speechMs += FRAME_MS + silenceMs;
    silenceMs = 0;
  } else silenceMs += FRAME_MS;
  if (!announced && speechMs >= (playing ? BARGE_IN_MS : MIN_SPEECH_MS)) {
    announced = true;
    reply({ type: "speech" });
  }
  if (silenceMs >= END_SILENCE_MS || sinceStart >= MAX_SPEECH_MS) finish();
}

self.onmessage = async (event: MessageEvent<ListenRequest>) => {
  const message = event.data;
  try {
    models ??= create();
    if (message.type === "load") {
      await models;
      return reply({ type: "ready" });
    }
    if (message.type === "playing") {
      playing = message.playing;
      return;
    }
    if (message.type === "reset") {
      epoch += 1;
      playing = false;
      speaking = false;
      announced = false;
      speech = [];
      pad.length = 0;
      speechMs = 0;
      silenceMs = 0;
      sinceStart = 0;
      state.dispose();
      state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
      return;
    }
    // Audio from before the models are ready is dropped, never queued: the learner sees Luna is not listening yet.
    if (ready) { const frameEpoch = epoch; await serial(() => frame(message.frame, frameEpoch)); }
  } catch (error) {
    // A failed download is retried on the next start instead of being cached as broken.
    models = null;
    ready = false;
    console.error(error);
    reply({ type: "error" });
  }
};

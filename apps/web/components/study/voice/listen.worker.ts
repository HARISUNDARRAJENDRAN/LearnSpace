import { AutoModel, env, InterruptableStoppingCriteria, ModelRegistry, pipeline } from "@huggingface/transformers";
import { listenGeneration } from "../speech-model";
import { type Listener, MOONSHINE, VAD_MODEL } from "./models";
import { loadParakeet, type Transcriber, UnsuitableDevice } from "./parakeet";
import type { Utterance } from "./vad";

// Parakeet (on the GPU) or Moonshine (on the CPU) turns each stretch of speech into text; audio never leaves the device.
// Silero, which finds those stretches, runs in its own worker (vad.worker.ts) and sends them here over a port of their
// own. With the frame-by-frame work gone, this worker is idle between utterances, so for Moonshine ONNX Runtime keeps its
// default thread pool: it writes a turn down faster, and the threads are asleep again by the time Luny speaks. Parakeet
// runs on one thread, as it always has: its CPU part is many tiny decoder steps, and its speed check was set on one thread.
const SAMPLE_RATE = 16_000;

/** From the page: load a listener, take the port Silero's utterances come in on, or forget everything before a reset. */
export type ListenRequest = { type: "load"; listener: Listener } | { type: "connect"; vad: MessagePort } | { type: "reset"; epoch: number };
/**
 * `final` carries an utterance's text, with the epoch it was heard in; a `final` that was not `heard` was too short to
 * interrupt Luny: an "mm-hm" while she talks, not a turn. `ready` names the listener that loaded; `unsuitable` means
 * Parakeet can't run well on this device, so it should not be tried again.
 */
export type ListenReply =
  | { type: "download"; progress: number }
  | { type: "ready"; listener: Listener; unsuitable: boolean }
  | { type: "final"; text: string; heard: boolean; endedAt: number; epoch: number }
  | { type: "error" };

const reply = (message: ListenReply) => self.postMessage(message);
let model: Promise<Transcriber> | null = null;

async function loadMoonshine(): Promise<Transcriber> {
  const { task, model: name, options } = MOONSHINE;
  const cached = await ModelRegistry.is_pipeline_cached(task, name, options).catch(() => false);
  const asr = await pipeline(task, name, {
    ...options,
    ...(cached ? {} : { progress_callback: (info: { status: string; progress?: number }) => { if (info.status === "progress_total") reply({ type: "download", progress: info.progress ?? 0 }); } }),
  });
  const transcribe: Transcriber = async (audio, stopped) => {
    // A guess the learner talked past stops at its next token instead of being written to the end.
    const stop = new InterruptableStoppingCriteria();
    const watch = stopped ? setInterval(() => { if (stopped()) stop.interrupt(); }, 10) : undefined;
    try {
      const output = await asr(audio, { ...listenGeneration(audio.length), stopping_criteria: [stop] } as never);
      return (Array.isArray(output) ? output[0]?.text ?? "" : output.text).trim();
    } finally {
      clearInterval(watch);
    }
  };
  // The first run sets the model up; doing it now keeps that cost out of the learner's first turn.
  await transcribe(new Float32Array(SAMPLE_RATE));
  return transcribe;
}

async function create(prefer: Listener): Promise<Transcriber> {
  if (prefer === "parakeet") {
    const wasm = env.backends.onnx.wasm;
    if (wasm) wasm.numThreads = 1;
    // A transformers.js session first, which sets ONNX Runtime's WASM up the way transformers.js configures it (cached
    // between visits); Parakeet's sessions then use that. Silero is the smallest model at hand, and is let go at once.
    await (await AutoModel.from_pretrained(VAD_MODEL.model, VAD_MODEL.options as never)).dispose();
  }
  let listener: Listener = "moonshine";
  let unsuitable = false;
  let transcribe: Transcriber | null = null;
  if (prefer === "parakeet") {
    try {
      transcribe = await loadParakeet((progress) => reply({ type: "download", progress }));
      listener = "parakeet";
    } catch (error) {
      unsuitable = error instanceof UnsuitableDevice;
      console.warn("Parakeet isn't available here; Luny listens with Moonshine.", error);
    }
  }
  transcribe ??= await loadMoonshine();
  reply({ type: "ready", listener, unsuitable });
  return transcribe;
}

// Guesses are written down one at a time, in order, so each utterance's text arrives in order. A guess is kept until its
// final (or drop) comes; Silero sends at most one guess per utterance that is not yet dropped or final.
type Guess = { audio: Float32Array; epoch: number; dropped: boolean; text: Promise<string> | null };
const guesses = new Map<number, Guess>();
let queue: Promise<unknown> = Promise.resolve();
let epoch = 0;

function write(id: number, guess: Guess) {
  guess.text = queue.then(async () => {
    if (guess.dropped || guess.epoch !== epoch) return "";
    return (await (model as Promise<Transcriber>))(guess.audio, () => guess.dropped || guess.epoch !== epoch);
  });
  queue = guess.text.catch(() => undefined);
  guess.text.catch((error: unknown) => {
    guesses.delete(id);
    console.error(error);
    reply({ type: "error" });
  });
}

function onUtterance(event: MessageEvent<Utterance>) {
  const message = event.data;
  if (message.type === "guess") {
    const guess: Guess = { audio: message.audio, epoch: message.epoch, dropped: false, text: null };
    guesses.set(message.id, guess);
    write(message.id, guess);
    return;
  }
  const guess = guesses.get(message.id);
  if (!guess) return;
  if (message.type === "drop") {
    guess.dropped = true;
    guesses.delete(message.id);
    return;
  }
  // The turn ended: its guess is the utterance. Once written (now, or when it finishes), the text goes to the page.
  void guess.text?.then((text) => {
    if (!guesses.has(message.id)) return;
    guesses.delete(message.id);
    if (message.epoch === epoch) reply({ type: "final", text, heard: message.heard, endedAt: message.endedAt, epoch: message.epoch });
  }, () => undefined);
}

self.onmessage = async (event: MessageEvent<ListenRequest>) => {
  const message = event.data;
  if (message.type === "connect") {
    message.vad.onmessage = onUtterance;
    return;
  }
  if (message.type === "reset") {
    epoch = message.epoch;
    for (const guess of guesses.values()) guess.dropped = true;
    guesses.clear();
    return;
  }
  try {
    model ??= create(message.listener);
    await model;
  } catch (error) {
    // A failed download is retried on the next start instead of being cached as broken.
    model = null;
    console.error(error);
    reply({ type: "error" });
  }
};

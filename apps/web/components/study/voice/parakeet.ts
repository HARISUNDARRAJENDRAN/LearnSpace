import * as ort from "onnxruntime-web/webgpu";
import { cachedFile } from "./cache";
import { PARAKEET_FILES } from "./models";

// Parakeet TDT: a preprocessor turns 16 kHz audio into mel features, the FastConformer encoder turns those into one
// vector per 80 ms, and the token-and-duration decoder walks them greedily, emitting a token and how many frames to skip.
// This is the same ONNX Runtime transformers.js loads (one copy in the bundle); transformers.js has set up its WASM files.
const BLANK = 8_192;
const VOCAB = 8_193;
const DURATIONS = [0, 1, 2, 3, 4];
const MAX_SYMBOLS_PER_FRAME = 10;
const STATE_SIZE = 2 * 1 * 640;
const SKIP = new Set(["<unk>", "<pad>", "<blk>"]);
// Once warm, four seconds of speech must transcribe within this, or Moonshine on the CPU is the better listener. Moonshine
// Base takes ~0.2 s per second of speech on a 2020 laptop CPU; Parakeet on that laptop's Intel Iris Xe takes the same
// (~0.2 s, encoder-bound) with far fewer mistakes, so a GPU up to 1.6x slower than that still wins (2026-11-13).
const WARM_SECONDS = 4;
const WARM_LIMIT_MS = 1_300;

/** `stopped`, checked as it works, ends a transcription no longer wanted (a guess the learner talked past) early. */
export type Transcriber = (audio: Float32Array, stopped?: () => boolean) => Promise<string>;
/** Parakeet can't run well here (no working WebGPU, or too slow); unlike a failed download, trying again won't help. */
export class UnsuitableDevice extends Error {}

const wasm: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };

export async function loadParakeet(onProgress: (percent: number) => void): Promise<Transcriber> {
  const files = Object.values(PARAKEET_FILES);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const loaded = files.map(() => 0);
  const [preprocessorBytes, encoderBytes, decoderBytes, vocabBytes] = await Promise.all(files.map((file, index) => cachedFile(file.url, file.bytes, (count) => {
    loaded[index] = count;
    onProgress(Math.min(100, Math.round((loaded.reduce((sum, part) => sum + part, 0) / total) * 100)));
  }))) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  const vocab: string[] = [];
  for (const line of new TextDecoder().decode(vocabBytes).split("\n")) {
    const space = line.lastIndexOf(" ");
    if (space > 0) vocab[Number(line.slice(space + 1))] = line.slice(0, space);
  }
  // One at a time: ONNX Runtime sets its backends up on the first session, and concurrent first sessions race.
  const preprocessor = await ort.InferenceSession.create(preprocessorBytes, wasm);
  const decoder = await ort.InferenceSession.create(decoderBytes, wasm);
  let encoder: ort.InferenceSession;
  try {
    encoder = await ort.InferenceSession.create(encoderBytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
  } catch (error) {
    await Promise.all([preprocessor.release(), decoder.release()]);
    throw new UnsuitableDevice(`WebGPU couldn't run the encoder: ${error instanceof Error ? error.message : String(error)}`);
  }

  async function encode(audio: Float32Array): Promise<Float32Array[]> {
    const features = await preprocessor.run({
      waveforms: new ort.Tensor("float32", audio, [1, audio.length]),
      waveforms_lens: new ort.Tensor("int64", BigInt64Array.from([BigInt(audio.length)]), [1]),
    });
    const encoded = await encoder.run({ audio_signal: features[preprocessor.outputNames[0] ?? ""] as ort.Tensor, length: features[preprocessor.outputNames[1] ?? ""] as ort.Tensor });
    const output = encoded[encoder.outputNames[0] ?? ""] as ort.Tensor;
    const [, width = 0, steps = 0] = output.dims;
    const count = Math.min(steps, Number((encoded[encoder.outputNames[1] ?? ""] as ort.Tensor).data[0]));
    // [1, width, steps] to one vector per frame, the decoder's input.
    const data = output.data as Float32Array;
    const frames = Array.from({ length: count }, (_, step) => {
      const frame = new Float32Array(width);
      for (let d = 0; d < width; d++) frame[d] = data[d * steps + step] ?? 0;
      return frame;
    });
    for (const tensor of [...Object.values(features), ...Object.values(encoded)]) tensor.dispose();
    return frames;
  }

  async function decode(frames: Float32Array[], stopped: () => boolean): Promise<number[]> {
    const tokens: number[] = [];
    let states: ort.Tensor[] = [new ort.Tensor("float32", new Float32Array(STATE_SIZE), [2, 1, 640]), new ort.Tensor("float32", new Float32Array(STATE_SIZE), [2, 1, 640])];
    const targetLength = new ort.Tensor("int32", Int32Array.from([1]), [1]);
    let last = BLANK;
    let budget = MAX_SYMBOLS_PER_FRAME * frames.length;
    for (let at = 0; at < frames.length && budget-- > 0 && !stopped();) {
      const frame = frames[at] as Float32Array;
      const output = await decoder.run({
        encoder_outputs: new ort.Tensor("float32", frame, [1, frame.length, 1]),
        targets: new ort.Tensor("int32", Int32Array.from([last]), [1, 1]),
        target_length: targetLength,
        input_states_1: states[0] as ort.Tensor,
        input_states_2: states[1] as ort.Tensor,
      });
      const logits = (output.outputs as ort.Tensor).data as Float32Array;
      let token = 0;
      for (let index = 1; index < VOCAB; index++) if ((logits[index] ?? -Infinity) > (logits[token] ?? -Infinity)) token = index;
      let duration = 0;
      for (let index = 1; index < DURATIONS.length; index++) if ((logits[VOCAB + index] ?? -Infinity) > (logits[VOCAB + duration] ?? -Infinity)) duration = index;
      let skip = DURATIONS[duration] ?? 1;
      if (token === BLANK) {
        if (skip === 0) skip = 1;
        (output.output_states_1 as ort.Tensor).dispose();
        (output.output_states_2 as ort.Tensor).dispose();
      } else {
        tokens.push(token);
        last = token;
        for (const state of states) state.dispose();
        states = [output.output_states_1 as ort.Tensor, output.output_states_2 as ort.Tensor];
      }
      (output.outputs as ort.Tensor).dispose();
      at += skip;
    }
    for (const state of states) state.dispose();
    return tokens;
  }

  const transcribe: Transcriber = async (audio, stopped = () => false) => {
    const tokens = await decode(await encode(audio), stopped);
    return tokens.map((token) => vocab[token]).filter((piece): piece is string => piece !== undefined && !SKIP.has(piece)).join("").replaceAll("▁", " ").trim();
  };

  try {
    // The first runs compile the GPU shaders, the first at each length a little more; the last shows how fast this GPU is.
    const noise = Float32Array.from({ length: 16_000 * WARM_SECONDS }, () => (Math.random() - 0.5) * 0.02);
    await transcribe(noise);
    const started = performance.now();
    await transcribe(noise);
    const elapsed = performance.now() - started;
    if (elapsed > WARM_LIMIT_MS) throw new UnsuitableDevice(`Parakeet took ${Math.round(elapsed)} ms for ${WARM_SECONDS} s of audio`);
  } catch (error) {
    await Promise.all([preprocessor.release(), decoder.release(), encoder.release()]);
    throw error instanceof UnsuitableDevice ? error : new UnsuitableDevice(`Parakeet failed its warm-up: ${error instanceof Error ? error.message : String(error)}`);
  }
  return transcribe;
}

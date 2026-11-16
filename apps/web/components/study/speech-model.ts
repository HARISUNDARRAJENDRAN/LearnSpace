// The on-device dictation model, named once for the worker and its tests.
// Speech has variable tensor shapes. Disabling fixed-shape memory patterns reduces retained allocations without changing inference math.

/**
 * Moonshine Base turns the learner's speech into text for dictation. On LibriSpeech it misheard 9.7% of words where Tiny
 * misheard 11.7%, for about 80 ms more per few seconds of speech (2026-11-12).
 */
export const LISTEN_MODEL = { task: "automatic-speech-recognition", model: "onnx-community/moonshine-base-ONNX", options: { device: "wasm", dtype: "q8", session_options: { enableMemPattern: false } } } as const;
/**
 * How Moonshine generates for `samples` of 16 kHz audio. transformers.js budgets 6 tokens per whole second, floored, so
 * a 1.9 s "No, it's not too soon" stopped at "not" and a word under a second came back empty; this is Moonshine's own
 * 6.5 per second, rounded up. Within that, a phrase may not repeat, which ends the rare "the handshake of the handshake
 * of…" loop at its second turn.
 */
export const listenGeneration = (samples: number) => ({ max_new_tokens: Math.max(12, Math.ceil(samples / 16_000 * 6.5)), no_repeat_ngram_size: 6 });

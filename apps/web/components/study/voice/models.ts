// The on-device speech models, named once for the workers and prefetch.
// Speech has variable tensor shapes. Disabling fixed-shape memory patterns reduces retained allocations without changing inference math.

/** Moonshine Tiny turns the learner's speech into text while they talk with Luna. */
export const LISTEN_MODEL = { task: "automatic-speech-recognition", model: "onnx-community/moonshine-tiny-ONNX", options: { device: "wasm", dtype: "q8", session_options: { enableMemPattern: false } } } as const;
/** Silero decides when the learner is speaking. */
export const VAD_MODEL = { model: "onnx-community/silero-vad", options: { config: { model_type: "custom" }, dtype: "fp32" } } as const;
/** Supertonic speaks Luna's replies. */
export const SPEAK_MODEL = { task: "text-to-speech", model: "onnx-community/Supertonic-TTS-ONNX", options: { device: "wasm", dtype: "fp32", session_options: { enableMemPattern: false } } } as const;
export const SPEAK_VOICE = `https://huggingface.co/${SPEAK_MODEL.model}/resolve/main/voices/F1.bin`;
/** Moonshine Base, more accurate than Tiny, transcribes dictation, where a moment's wait does not matter. */
export const DICTATION_MODEL = { task: "automatic-speech-recognition", model: "onnx-community/moonshine-base-ONNX", options: { device: "wasm", dtype: "q8" } } as const;

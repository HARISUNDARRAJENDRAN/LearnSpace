# Voice notes verification

References reviewed: [orb/dashboard demo](https://x.com/aniq_ui_pro/status/1990279799223296332), [continuous document editing](https://x.com/SarvasvKulpati/status/2119945644349735408), [lesson annotations](https://x.com/jaeyun_ha/status/2069032478917148673), and [PenEcho](https://github.com/penecho/penecho). The three tweet videos were retrieved and visual sequences inspected across their full durations, not just post metadata. No PenEcho source was incorporated.

## Quality and memory

The ASR models, precision, 16 kHz input resampler, VAD thresholds, Supertonic FP32 weights, F1 voice, three denoising steps and 1.05 speed remain unchanged. Fixed-shape ONNX memory-pattern caching is disabled for the variable-length conversational speech models. In an isolated Chromium/WASM harness, baseline and that setting returned the same JFK transcript and byte-identical seeded samples for three phrases. This is a regression check, not a broad WER or perceptual-quality study.

JFK fixture: [whisper.cpp sample](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav). Normalized transcript: “And so my fellow Americans ask not what your country can do for you ask what you can do for your country.” Baseline and candidate both matched it.

With `random.seed(42)` and one WASM thread, baseline/candidate SHA-256 hashes matched:

| Phrase | Samples | SHA-256 |
| --- | ---: | --- |
| Hi. | 41753 | 5ff711f02e3854078b5f854c28979b77f5ffdf612a7230185bfa94e194d708c5 |
| The hypotenuse is opposite the right angle. | 126977 | 31c1950c1828638ca32b1349f3117ee9da2d31116bed1669fc372e04bca0ef9a |
| Let us work through the next step together. | 111798 | 9c0cc5ff11098453193adaf72c4546f2cb870ffa2816476470c57ead1f2843c0 |

Renderer RSS varied with Chromium collection and concurrent host work. Trials did not establish a reliable large peak-memory reduction, so no percentage saving is claimed. Memory-arena and weight-prepacking changes were rejected. The largest predictable lifecycle improvement is releasing inactive workers immediately, preventing the separate dictation model from remaining loaded, and bounding queued playback to two buffers. Model weights and WASM still impose a substantial active-session memory floor.

## Functional checks

- Shared contracts: note edits/moves, stale edit protection, bounded coordinates/frame payloads.
- Database integration: ownership, streamed reply, saved edits, undo, cancellation and image forwarding without persisting frame bytes.
- Browser: streaming into a saved diagram/document, manual correction, undo by voice command, learner drawing, narrow layouts, cancellation during microphone permission, and single-frame tab capture with track cleanup.
- Real provider smoke: screenshot-grounded triangle explanation/annotation and a diagram; Exa image search followed by persisted image and source-link blocks.
- Production Next build and minimal Docker image build; runtime runs as a non-root user.

Visual tutoring is turn-based: a fresh shared frame accompanies each utterance. It is not continuous video ingestion or an OpenAI Realtime transport. Browser capture cannot silently access a cross-origin YouTube iframe, and requires the learner to select the LearnSpace tab. Annotations remain model-generated and can require correction.

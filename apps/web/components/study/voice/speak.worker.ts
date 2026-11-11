import { env, pipeline, type TextToAudioPipeline } from "@huggingface/transformers";
import { SPEAK_MODEL, SPEAK_VOICE } from "./models";

// Supertonic (66M parameters) speaks Luna's replies on the learner's device, a sentence at a time so the first one plays
// while the rest are still being written. It runs on the CPU, about five times faster than real time on a 2020 laptop;
// on integrated GPUs WebGPU was slower than that.
// Fewer denoising steps answer sooner; below 3 the voice turns rough.
const STEPS = 3;
const SPEED = 1.05;

export type SpeakRequest = { type: "load" } | { type: "speak"; id: number; text: string } | { type: "cancel"; before: number };
export type SpeakReply = { type: "download"; progress: number } | { type: "ready" } | { type: "audio"; id: number; samples: Float32Array; sampleRate: number } | { type: "skipped"; id: number } | { type: "error" };
type Audio = { audio: Float32Array; sampling_rate: number };
type Speaker = (text: string) => Promise<Audio>;

const reply = (message: SpeakReply, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
let tts: Promise<Speaker> | null = null;
let skipBefore = 0;
let queue: Promise<unknown> = Promise.resolve();

async function create(): Promise<Speaker> {
  const [model, voice] = await Promise.all([
    pipeline(SPEAK_MODEL.task, SPEAK_MODEL.model, {
      ...SPEAK_MODEL.options,
      progress_callback: (info: { status: string; progress?: number }) => { if (info.status === "progress_total") reply({ type: "download", progress: info.progress ?? 0 }); },
    }) as Promise<TextToAudioPipeline>,
    // Read once: given a URL, the pipeline would fetch the voice again for every sentence. It sits in the models' cache,
    // where the prefetch may already have put it.
    caches.open(env.cacheKey).then(async (cache) => {
      let response = await cache.match(SPEAK_VOICE);
      if (!response) {
        response = await fetch(SPEAK_VOICE);
        if (!response.ok) throw new Error(`voice ${response.status}`);
        await cache.put(SPEAK_VOICE, response.clone());
      }
      return new Float32Array(await response.arrayBuffer());
    }),
  ]);
  const speak: Speaker = (text) => model(text, { speaker_embeddings: voice, num_inference_steps: STEPS, speed: SPEED }) as never;
  // The first run sets the model up, so Luna's first sentence is not the slow one.
  await speak("Hi.");
  return speak;
}

self.onmessage = (event: MessageEvent<SpeakRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    skipBefore = message.before;
    return;
  }
  if (!tts) {
    tts = create();
  }
  if (message.type === "load") {
    tts.then(() => reply({ type: "ready" }), (error: unknown) => {
      tts = null;
      console.error(error);
      reply({ type: "error" });
    });
    return;
  }
  // One sentence at a time, in order; sentences of a reply the learner cut off are skipped, not spoken late.
  queue = queue.then(async () => {
    try {
      if (message.id < skipBefore) { reply({ type: "skipped", id: message.id }); return; }
      const { audio, sampling_rate } = await (await tts!)(message.text);
      if (message.id < skipBefore) { reply({ type: "skipped", id: message.id }); return; }
      reply({ type: "audio", id: message.id, samples: audio, sampleRate: sampling_rate }, [audio.buffer]);
    } catch (error) {
      tts = null;
      console.error(error);
      reply({ type: "error" });
    }
  });
};

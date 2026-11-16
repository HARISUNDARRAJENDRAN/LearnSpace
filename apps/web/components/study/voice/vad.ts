// When the learner is speaking, frame by frame. Silero scores each 32 ms frame (in the listener's worker); this decides from
// those scores where an utterance starts and ends, and hands the listener the words to write down as early as it can.

const SAMPLE_RATE = 16_000;
/** Silero reads 512-sample (32 ms) frames at 16 kHz. */
export const FRAME = 512;
export const FRAME_MS = (FRAME / SAMPLE_RATE) * 1_000;
// Speech starts above START and continues while above KEEP; while Luny talks or the lesson plays, only clearly louder
// speech counts, so audio leaking past echo cancellation never reads as the learner.
const START = 0.5;
const KEEP = 0.25;
const START_WHILE_PLAYING = 0.85;
// A turn ends after this much silence. Short, for speed: a pause mid-thought ends a turn too, but Luny stays silent on an
// unfinished thought, and speech that resumes before she is heard cancels her turn and joins it to what comes next.
export const END_SILENCE_MS = 200;
// The listener starts writing the words down once the learner has been quiet this long, while the turn's end is still
// being confirmed: by the time it is, the words are mostly written. The words it writes are the utterance up to here, so
// they are the same whether the turn ends now or not; speech that resumes drops the guess and the utterance carries on.
// Three frames: Silero's score trails the voice by about a frame, so a word's soft ending is still inside.
export const GUESS_SILENCE_MS = 3 * FRAME_MS;
export const MIN_SPEECH_MS = 200;
// How long the learner must keep talking over Luny before she stops, so a cough or an "mm" never cuts her off.
export const BARGE_IN_MS = 320;
const PAD_FRAMES = 6;
const MAX_SPEECH_MS = 28_000;

/**
 * To the listener. `guess`: write these words down (the utterance so far, its speaker quiet for a moment). `drop`: the
 * learner carried on, so that guess is not the utterance. `final`: the turn ended; the guess is the utterance, and `heard`
 * says whether it was long enough to interrupt Luny (an "mm-hm" while she talks is not a turn). Each carries the epoch
 * (the page's count of resets) it was heard in, so words from before a reset are recognised as such wherever they are.
 */
export type Utterance =
  | { type: "guess"; id: number; audio: Float32Array; epoch: number }
  | { type: "drop"; id: number }
  | { type: "final"; id: number; heard: boolean; endedAt: number; epoch: number };

type Events = {
  /** Silero's probability that a frame is speech. */
  score: (frame: Float32Array) => Promise<number>;
  /** Once per utterance, as soon as it is clearly the learner talking. */
  speech: () => void;
  utterance: (message: Utterance) => void;
  error: (error: unknown) => void;
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

/** Frames are judged one at a time, in order (Silero's state carries from each frame to the next), and only while active. */
export class Endpointer {
  active = false;
  playing = false;
  private epoch = 0;
  private speaking = false;
  private announced = false;
  private speechMs = 0;
  private silenceMs = 0;
  private sinceStart = 0;
  private speech: Float32Array[] = [];
  private readonly pad: Float32Array[] = [];
  private guessId = 0;
  // The guess sent for the utterance as it stands, if any.
  private guessed: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly events: Events) {}

  /**
   * A frame, and when it was captured (as `Date.now()`, at its end). Turns are timed by when the audio was heard, not by
   * when it was judged, which can be later. Audio from before the models are ready is dropped, never queued: the learner
   * sees Luny is not listening yet.
   */
  frame(input: Float32Array, at: number) {
    if (!this.active) return;
    const epoch = this.epoch;
    this.queue = this.queue.then(() => this.judge(input, at, epoch)).catch(this.events.error);
    return this.queue;
  }

  /** Forgets any half-heard speech; `onReset` runs in turn, once no frame from before is still being scored. */
  reset(epoch: number, onReset?: () => void) {
    this.epoch = epoch;
    this.drop();
    this.speaking = false;
    this.announced = false;
    this.speech = [];
    this.pad.length = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.sinceStart = 0;
    if (onReset) this.queue = this.queue.then(onReset, onReset);
  }

  private guess() {
    this.guessed = ++this.guessId;
    this.events.utterance({ type: "guess", id: this.guessed, audio: join(this.speech), epoch: this.epoch });
  }

  private drop() {
    if (this.guessed !== null) this.events.utterance({ type: "drop", id: this.guessed });
    this.guessed = null;
  }

  private finish(at: number) {
    if (this.speechMs < MIN_SPEECH_MS) this.drop();
    else {
      // A turn cut at its longest, or ended in the very frame its silence began, has no guess yet.
      if (this.guessed === null) this.guess();
      this.events.utterance({ type: "final", id: this.guessed as number, heard: this.announced, endedAt: at - this.silenceMs, epoch: this.epoch });
    }
    this.guessed = null;
    this.speaking = false;
    this.announced = false;
    this.speech = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.sinceStart = 0;
  }

  private async judge(input: Float32Array, at: number, epoch: number) {
    if (epoch !== this.epoch) return;
    const probability = await this.events.score(input);
    if (epoch !== this.epoch) return;
    if (!this.speaking) {
      this.pad.push(input);
      if (this.pad.length > PAD_FRAMES) this.pad.shift();
      if (probability < (this.playing ? START_WHILE_PLAYING : START)) return;
      this.speaking = true;
      this.speech = [...this.pad];
      this.pad.length = 0;
      return;
    }
    this.speech.push(input);
    this.sinceStart += FRAME_MS;
    if (probability >= KEEP) {
      this.speechMs += FRAME_MS + this.silenceMs;
      this.silenceMs = 0;
      // The learner carried on: the words so far were not the whole utterance.
      if (this.guessed !== null) this.drop();
    } else this.silenceMs += FRAME_MS;
    if (!this.announced && this.speechMs >= (this.playing ? BARGE_IN_MS : MIN_SPEECH_MS)) {
      this.announced = true;
      this.events.speech();
    }
    if (this.silenceMs >= END_SILENCE_MS || this.sinceStart >= MAX_SPEECH_MS) this.finish(at);
    else if (this.guessed === null && this.silenceMs >= GUESS_SILENCE_MS && this.speechMs >= MIN_SPEECH_MS) this.guess();
  }
}

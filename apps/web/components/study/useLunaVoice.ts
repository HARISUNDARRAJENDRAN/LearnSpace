"use client";

import { type LessonControl, lessonControlSchema, type VoiceTurnEvent, type VoiceTurnRequest } from "@learnspace/shared/notes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ListenReply, ListenRequest } from "./voice/listen.worker";
import { LISTENER_KEY, pickListener } from "./voice/models";
import type { SpeakReply, SpeakRequest } from "./voice/speak.worker";
import type { VadReply, VadRequest } from "./voice/vad.worker";

export type VoiceState = "off" | "loading" | "listening" | "thinking" | "speaking";
/** The lesson on screen: a video's moment and whether it plays, or for a paper the page being read and any passage picked out. */
export type LessonState = { positionMs: number | null; playing: boolean; paper?: { anchor: { kind: "paper"; page: number; sectionId?: string }; selection: string | null } };
type Options = {
  sessionId: string;
  lesson: () => LessonState;
  /** The lesson as it is on screen now, or null when Luny cannot see it. */
  capture: () => string | null;
  /** Luny seeks, plays or pauses the lesson. */
  onControl: (control: LessonControl) => void;
  /** The learner started talking. */
  onTurn: () => void;
  /** An exchange was saved: Luny answered, or was cut off after she started. `utterance` is what the learner said, if anything. */
  onExchange: (utterance: string | null) => void;
};

// Resamples the microphone to 16 kHz and posts it in Silero's 512-sample frames, transferred, straight to the port it is
// given (Silero's worker): the page's own thread never handles audio, so a busy page cannot hold up hearing the learner.
const FRAMES_WORKLET = `class Frames extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.t = 0; this.prev = 0; this.frame = new Float32Array(512); this.n = 0; this.out = null; this.port.onmessage = (event) => { this.out = event.data; }; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    let t = this.t;
    while (t < x.length - 1) {
      const i = Math.floor(t);
      const a = i < 0 ? this.prev : x[i];
      this.frame[this.n++] = a + (x[i + 1] - a) * (t - i);
      if (this.n === 512) { if (this.out) { this.out.postMessage({ frame: this.frame, at: Date.now() }, [this.frame.buffer]); this.frame = new Float32Array(512); } this.n = 0; }
      t += this.ratio;
    }
    this.t = t - x.length;
    this.prev = x[x.length - 1];
    return true;
  }
}
registerProcessor("frames", Frames);`;

// Luny may chime in when the learner pauses after this much new watching, doubled each time she chimed in and got no
// answer (up to four times), and only after this long without them speaking, so a learner who paused to talk goes first.
const CHIME_AFTER_MS = 60_000;
const CHIME_DELAY_MS = 2_000;

// Luny let the learner's words go by as unfinished ([[listen]]); if they then stay quiet this long, she answers them.
const WAITING_MS = 1_400;
// With nobody talking and the video paused, Luny picks the talk back up after this long, doubled each time it got no
// answer, and at most this many times in a row.
const IDLE_MS = 25_000;
const IDLE_TRIES = 3;
// While the learner may be talking over her, Luny's voice drops to this, until their words show whether it was a real turn.
const DUCKED = 0.08;
// What the learner says while Luny talks that is only listening along, not a turn.
const BACKCHANNEL = /^(?:m+-?h?m+|uh-?huh|uh+|um+|hmm+|ok(?:ay)?|yeah|yep|yes|right|sure|cool|nice|wow|oh|ah|i see|got it)[.!?,\s]*$/i;

/** Logs a turn's timings, and keeps the session's in `window.__lunyTimings` for measuring them. */
function report(clock: { endedAt: number; heardAt: number; firstWordsAt: number | null; firstAudioAt: number | null }) {
  const timing: TurnTiming = { heardMs: clock.heardAt - clock.endedAt, firstWordsMs: clock.firstWordsAt === null ? null : clock.firstWordsAt - clock.endedAt, firstAudioMs: clock.firstAudioAt === null ? null : clock.firstAudioAt - clock.endedAt };
  const store = globalThis as { __lunyTimings?: TurnTiming[] };
  store.__lunyTimings = [...(store.__lunyTimings ?? []).slice(-49), timing];
  console.debug("[Luny] turn", timing);
}

/** Whether a pause after `watchedMs` of new watching is worth a chime-in, having been ignored `ignored` times in a row. */
export const chimeDue = (watchedMs: number, ignored: number) => watchedMs >= CHIME_AFTER_MS * 2 ** Math.min(ignored, 2);

// A reply's first piece may end at its first clause once it has this many characters: "Right —", "Exactly," or "Okay,"
// is spoken while the rest of the sentence is still being voiced, so Luny starts about 400 ms sooner, and the next
// piece is ready before the first has finished playing (measured: no gap between them). A mark in the first few letters
// ("No, it's…") is not a pause worth speaking alone.
const FIRST_CLAUSE_FROM = 4;

/** Where the next piece of `text` worth speaking ends: a sentence, or for a reply's first piece a clause, so it starts sooner. */
export function chunkEnd(text: string, from: number, first: boolean, final: boolean): number {
  const rest = text.slice(from);
  const sentence = /[.!?…]["'”’»)\]]*(\s|$)/.exec(rest);
  if (sentence && (sentence.index + sentence[0].length < rest.length || final)) return from + sentence.index + sentence[0].length;
  if (first) {
    const clause = /[,;:—]\s/.exec(rest.slice(FIRST_CLAUSE_FROM));
    if (clause) return from + FIRST_CLAUSE_FROM + clause.index + clause[0].length;
  }
  return final && rest.trim() ? text.length : -1;
}

/** `utterances` of the pending words this turn answers; `answered` once Luny said anything, which saves the exchange. */
type Turn = { controller: AbortController; utterances: number; spoken: number; answered: boolean };
type Cue = "waiting" | "idle";
/** How long one turn took, in ms from the learner's last word: their words written down, Luny's first words, her first sound. */
export type TurnTiming = { heardMs: number | null; firstWordsMs: number | null; firstAudioMs: number | null };
type Audio = { context: AudioContext; stream: MediaStream; node: AudioWorkletNode; input: MediaStreamAudioSourceNode; output: GainNode; tick: number };
// How often the page tells Silero whether the lesson is playing: once per frame it hears.
const FOLLOW_MS = 32;
/** Silero, the listener and Luny's voice, each ready once loaded. */
type Ready = { vad: boolean; listen: boolean; speak: boolean };
const allReady = (ready: Ready) => ready.vad && ready.listen && ready.speak;

/**
 * A spoken conversation with Luny, on the learner's device: Silero hears when they speak, Parakeet (on the GPU) or
 * Moonshine (on the CPU) writes down what they said, and Supertonic speaks her reply a sentence at a time as GPT-6 Luna
 * streams it from the server. Talking over her stops her; a pause mid-thought that she started answering is joined to
 * what the learner says next.
 */
export function useLunaVoice(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<VoiceState>("off");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vadRef = useRef<Worker | null>(null);
  const listenRef = useRef<Worker | null>(null);
  const speakRef = useRef<Worker | null>(null);
  // The listener's end of its link to Silero, until Silero takes it.
  const link = useRef<MessagePort | null>(null);
  // Resets so far: words heard before the latest one are dropped wherever they still are.
  const epoch = useRef(0);
  const ready = useRef<Ready>({ vad: false, listen: false, speak: false });
  const downloads = useRef({ listen: 0, speak: 0 });
  const startId = useRef(0);
  const starting = useRef(false);
  const audioRef = useRef<Audio | null>(null);
  const pending = useRef<string[]>([]);
  const frame = useRef<string | null>(null);
  const turnRef = useRef<Turn | null>(null);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const speechQueue = useRef<{ id: number; text: string }[]>([]);
  const inFlight = useRef<number | null>(null);
  const speechId = useRef(0);
  const cancelled = useRef(0);
  const nextTime = useRef(0);
  const greeted = useRef(false);
  const heardPlaying = useRef(false);
  const pumpRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<(reason?: string | null) => void>(() => undefined);
  const turnStarter = useRef<(utterance: string | null, watchedFromMs?: number | null, cue?: Cue | null) => void>(() => undefined);
  // The learner may be talking over Luny: her voice is ducked, and her turn kept, until their words show it was a real turn.
  const held = useRef(false);
  const waitTimer = useRef<number | undefined>(undefined);
  const idle = useRef<{ timer?: number; tries: number }>({ tries: 0 });
  // From the learner's last word to Luny's first sound, for the turn being answered; see TurnTiming.
  const timing = useRef<{ endedAt: number; heardAt: number; firstWordsAt: number | null; firstAudioAt: number | null } | null>(null);
  // The stretch watched since Luny and the learner last talked: where it began, how long it played, and the pending chime-in.
  const watch = useRef<{ playing: boolean; since: number; fromMs: number | null; watchedMs: number; ignored: number; timer?: number }>({ playing: false, since: 0, fromMs: null, watchedMs: 0, ignored: 0 });
  const quiet = useCallback(() => { window.clearTimeout(watch.current.timer); watch.current.watchedMs = 0; watch.current.fromMs = null; }, []);

  const calm = useCallback(() => { window.clearTimeout(waitTimer.current); window.clearTimeout(idle.current.timer); }, []);
  /** Nobody talking, Luny idle: she may pick the talk back up after a while, if the lesson is still paused by then. */
  const armIdle = useCallback(() => {
    window.clearTimeout(idle.current.timer);
    if (idle.current.tries >= IDLE_TRIES) return;
    idle.current.timer = window.setTimeout(() => {
      if (turnRef.current || pending.current.length || sources.current.size || speechQueue.current.length || held.current || latest.current.lesson().playing) return;
      idle.current.tries++;
      turnStarter.current(null, null, "idle");
    }, IDLE_MS * 2 ** idle.current.tries);
  }, []);
  const stateRef = useRef<VoiceState>("off");
  const settle = useCallback(() => {
    const queued = sources.current.size + speechQueue.current.length + (inFlight.current === null ? 0 : 1);
    const next: VoiceState = sources.current.size ? "speaking" : turnRef.current || queued ? "thinking" : !audioRef.current ? "off" : !allReady(ready.current) ? "loading" : "listening";
    if (next === "listening" && stateRef.current !== "listening" && greeted.current) armIdle();
    stateRef.current = next;
    setState(next);
  }, [armIdle]);
  /** Luny's voice drops while the learner may be talking over her, and comes back if it was only a cough or an "mm-hm". */
  const duck = useCallback((on: boolean) => {
    held.current = on;
    const audio = audioRef.current;
    if (audio) audio.output.gain.setTargetAtTime(on ? DUCKED : 1, audio.context.currentTime, on ? .02 : .08);
  }, []);
  /**
   * While Luny talks or the lesson plays, only clearly louder speech is the learner: Silero is told the moment that
   * changes (her sentences starting and ending), and the lesson is checked once a frame.
   */
  const syncPlaying = useCallback(() => {
    if (!audioRef.current || !allReady(ready.current)) return;
    const playing = sources.current.size > 0 || latest.current.lesson().playing;
    if (playing === heardPlaying.current) return;
    heardPlaying.current = playing;
    vadRef.current?.postMessage({ type: "playing", playing } satisfies VadRequest);
  }, []);
  /** Silero judges frames only while all of Luny's models are ready, so she never hears what she cannot answer. */
  const activate = useCallback(() => {
    vadRef.current?.postMessage({ type: "active", active: Boolean(audioRef.current) && allReady(ready.current) } satisfies VadRequest);
    syncPlaying();
  }, [syncPlaying]);
  /** Luny stops talking at once, and the reply she was writing is dropped. */
  const interrupt = useCallback(() => {
    const turn = turnRef.current;
    turn?.controller.abort();
    // Words she already answered were saved with her answer; the rest are asked again with what comes next.
    if (turn?.answered) pending.current.splice(0, turn.utterances);
    turnRef.current = null;
    cancelled.current = speechId.current + 1;
    speechQueue.current = [];
    // The cancelled synthesis keeps the worker until it replies, so it stays in flight until then.
    speakRef.current?.postMessage({ type: "cancel", before: cancelled.current } satisfies SpeakRequest);
    for (const source of sources.current) { source.onended = null; source.stop(); source.disconnect(); source.buffer = null; }
    sources.current.clear();
    nextTime.current = 0;
    duck(false);
    syncPlaying();
  }, [duck, syncPlaying]);
  const pump = useCallback(() => {
    // Only two sentences of audio wait for playback; the rest stay as text.
    if (inFlight.current !== null || sources.current.size >= 2 || !ready.current.speak || !audioRef.current) return;
    const job = speechQueue.current.shift();
    if (!job) return;
    inFlight.current = job.id;
    speakRef.current?.postMessage({ type: "speak", ...job } satisfies SpeakRequest);
  }, []);
  pumpRef.current = pump;
  const speak = useCallback((text: string) => {
    if (!text.trim() || !audioRef.current) return;
    speechQueue.current.push({ id: ++speechId.current, text: text.trim() });
    pump();
  }, [pump]);
  const play = useCallback((samples: Float32Array, sampleRate: number) => {
    const audio = audioRef.current;
    if (!audio || !samples.length) return;
    const buffer = audio.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = audio.context.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.output);
    const start = Math.max(audio.context.currentTime + .01, nextTime.current);
    nextTime.current = start + buffer.duration;
    let fallback: number | undefined;
    const ended = () => {
      window.clearTimeout(fallback);
      if (!sources.current.delete(source)) return;
      source.onended = null;
      source.disconnect();
      source.buffer = null;
      syncPlaying();
      pumpRef.current();
      settle();
    };
    source.onended = ended;
    // A sentence whose end never fires (the audio device changed, the context stalled) must not leave Luny "speaking" forever.
    fallback = window.setTimeout(ended, (start - audio.context.currentTime + buffer.duration) * 1_000 + 1_500);
    sources.current.add(source);
    source.start(start);
    syncPlaying();
    const clock = timing.current;
    if (clock && clock.firstAudioAt === null) {
      clock.firstAudioAt = Date.now() + Math.round((start - audio.context.currentTime) * 1_000);
      report(clock);
    }
    stateRef.current = "speaking";
    setState("speaking");
  }, [settle, syncPlaying]);

  const runTurn = useCallback(async (utterance: string | null, watchedFromMs: number | null = null, cue: Cue | null = null) => {
    const turn: Turn = { controller: new AbortController(), utterances: pending.current.length, spoken: 0, answered: false };
    turnRef.current = turn;
    calm();
    stateRef.current = "thinking";
    setState("thinking");
    setError(null);
    if (!utterance) timing.current = null;
    const lesson = latest.current.lesson();
    const body: VoiceTurnRequest = lesson.paper ? { utterance, anchor: lesson.paper.anchor, selection: lesson.paper.selection, cue }
      : { utterance, positionMs: lesson.positionMs, playing: lesson.playing, frame: frame.current ?? latest.current.capture(), watchedFromMs, cue };
    frame.current = null;
    let say = "";
    let completed = false;
    const queue = (final: boolean) => {
      for (let end = chunkEnd(say, turn.spoken, turn.spoken === 0, final); end > 0; end = chunkEnd(say, turn.spoken, false, final)) { speak(say.slice(turn.spoken, end)); turn.spoken = end; }
    };
    try {
      const response = await fetch(`/api/v1/study-sessions/${latest.current.sessionId}/voice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: turn.controller.signal });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(failure?.error?.message ?? "Luny couldn't answer just now.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      const handle = (line: string) => {
        if (!line.trim() || turnRef.current !== turn) return;
        const event = JSON.parse(line) as VoiceTurnEvent;
        // A final say is the reply complete: its last sentence goes to her voice now, while the server saves the exchange.
        if (event.type === "say") {
          say += event.text;
          turn.answered = true;
          if (timing.current && timing.current.firstWordsAt === null) timing.current.firstWordsAt = Date.now();
          queue(event.final === true);
        }
        else if (event.type === "control") { const control = lessonControlSchema.safeParse(event.control); if (control.success) latest.current.onControl(control.data); }
        // A turn where Luny chose to stay quiet left nothing new for the scribe.
        else if (event.type === "done") {
          completed = true;
          queue(true);
          pending.current.splice(0, turn.utterances);
          if (utterance || turn.answered) latest.current.onExchange(utterance);
          // She let their words go by as unfinished: if they now stay quiet, they are waiting for her, and she answers.
          if (utterance && !turn.answered) waitTimer.current = window.setTimeout(() => {
            if (!turnRef.current && !pending.current.length && !sources.current.size && !held.current) turnStarter.current(null, null, "waiting");
          }, WAITING_MS);
        }
        else throw new Error(event.message);
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let newline = buffer.indexOf("\n");
          while (newline >= 0) { handle(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); newline = buffer.indexOf("\n"); }
        }
        handle(buffer);
        if (!completed && !turn.controller.signal.aborted) throw new Error("Lost the connection to Luny. Keep talking to try again.");
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (cause) {
      if (!turn.controller.signal.aborted && turnRef.current === turn) {
        // Her words so far were saved; the learner's stay pending only if she hadn't started.
        if (turn.answered) { pending.current.splice(0, turn.utterances); latest.current.onExchange(utterance); }
        turnRef.current = null;
        setError(cause instanceof Error ? cause.message : "Lost the connection to Luny.");
      }
    } finally {
      if (turnRef.current === turn) turnRef.current = null;
      settle();
    }
  }, [calm, settle, speak]);
  turnStarter.current = (utterance, watchedFromMs, cue) => { void runTurn(utterance, watchedFromMs, cue); };

  /** Luny chimes in after a pause only if she is idle, the learner is silent and the lesson is still paused. */
  const chime = useCallback(() => {
    const seen = watch.current;
    if (turnRef.current || pending.current.length || sources.current.size || speechQueue.current.length || latest.current.lesson().playing) return;
    const fromMs = seen.fromMs;
    quiet();
    seen.ignored++;
    turnStarter.current(null, fromMs ?? 0);
  }, [quiet]);
  /** Follows the lesson playing and pausing, and schedules a chime-in when a pause ends a long enough stretch. */
  const follow = useCallback((lesson: LessonState) => {
    const seen = watch.current;
    if (lesson.playing === seen.playing) return;
    seen.playing = lesson.playing;
    window.clearTimeout(seen.timer);
    if (lesson.playing) { seen.since = Date.now(); seen.fromMs ??= lesson.positionMs; return; }
    seen.watchedMs += Date.now() - seen.since;
    if (chimeDue(seen.watchedMs, seen.ignored)) seen.timer = window.setTimeout(chime, CHIME_DELAY_MS);
  }, [chime]);

  /** Luny opens the conversation once both models are ready, unless the lesson is playing. */
  const greet = useCallback(() => {
    if (greeted.current || !allReady(ready.current) || turnRef.current || pending.current.length) return;
    greeted.current = true;
    if (!latest.current.lesson().playing) turnStarter.current(null);
  }, []);

  const handleVad = useCallback((event: MessageEvent<VadReply>) => {
    const message = event.data;
    if (message.type === "ready") {
      ready.current.vad = true;
      activate();
      settle();
      greet();
    } else if (message.type === "error") stopRef.current("Luny couldn't hear you. Turn her on again to retry.");
    else {
      window.clearTimeout(watch.current.timer);
      calm();
      // Not cut off yet: Luny goes quiet and keeps her turn until the words show whether this was the learner taking the
      // floor, or a cough, a noise or an "mm-hm" (which used to cancel her answer and leave the question unanswered).
      duck(true);
      frame.current = latest.current.capture();
      latest.current.onTurn();
      stateRef.current = "listening";
      setState("listening");
    }
  }, [activate, calm, duck, greet, settle]);
  const handleListen = useCallback((event: MessageEvent<ListenReply>) => {
    const message = event.data;
    if (message.type === "download") {
      downloads.current.listen = message.progress;
      setProgress(Math.round((downloads.current.listen + downloads.current.speak) / 2));
    } else if (message.type === "ready") {
      ready.current.listen = true;
      downloads.current.listen = 100;
      try { if (message.unsuitable) localStorage.setItem(LISTENER_KEY, "moonshine"); } catch { /* storage blocked: it is tried again next time */ }
      // One model set at a time: loading both at once overlaps their download and setup buffers.
      speakRef.current?.postMessage({ type: "load" } satisfies SpeakRequest);
      activate();
      settle();
    } else if (message.type === "error") stopRef.current("Luny couldn't hear you. Turn her on again to retry.");
    else if (message.epoch === epoch.current) {
      const text = message.text.trim();
      const busy = Boolean(turnRef.current || sources.current.size || speechQueue.current.length);
      // Nothing worth a turn: noise, or listening along while she talks. Luny carries on where she was.
      if (!text || (busy && (!message.heard || BACKCHANNEL.test(text)))) {
        duck(false);
        // Words still waiting for an answer whose turn was cut off are asked again, so they are never dropped.
        if (!busy && pending.current.length) turnStarter.current(pending.current.join(" ").slice(-4_000));
        return settle();
      }
      interrupt();
      // The learner is talking: what they watched is now part of the talk, and Luny is welcome to chime in again.
      quiet();
      watch.current.ignored = 0;
      idle.current.tries = 0;
      pending.current.push(text);
      timing.current = { endedAt: message.endedAt, heardAt: Date.now(), firstWordsAt: null, firstAudioAt: null };
      turnStarter.current(pending.current.join(" ").slice(-4_000));
    }
  }, [activate, duck, interrupt, quiet, settle]);
  const handleSpeak = useCallback((event: MessageEvent<SpeakReply>) => {
    const message = event.data;
    if (message.type === "download") {
      downloads.current.speak = message.progress;
      setProgress(Math.round((downloads.current.listen + downloads.current.speak) / 2));
    } else if (message.type === "ready") {
      ready.current.speak = true;
      downloads.current.speak = 100;
      setProgress(null);
      activate();
      pumpRef.current();
      settle();
      greet();
    } else if (message.type === "error") {
      inFlight.current = null;
      speechQueue.current = [];
      stopRef.current("Luny's voice couldn't load. Turn her on again to retry.");
    } else {
      if (inFlight.current === message.id) inFlight.current = null;
      if (message.type === "audio" && message.id >= cancelled.current) play(message.samples, message.sampleRate);
      pumpRef.current();
      settle();
    }
  }, [activate, greet, play, settle]);

  /** Hangs up. The models stay loaded (`unload` false) so turning Luny on again is instant; leaving the lesson unloads them. */
  const stop = useCallback((reason: string | null = null, unload = true) => {
    ++startId.current;
    starting.current = false;
    interrupt();
    calm();
    idle.current.tries = 0;
    timing.current = null;
    pending.current = [];
    frame.current = null;
    greeted.current = false;
    heardPlaying.current = false;
    quiet();
    watch.current = { playing: false, since: 0, fromMs: null, watchedMs: 0, ignored: 0 };
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      window.clearInterval(audio.tick);
      audio.node.port.onmessage = null;
      audio.input.disconnect(); audio.node.disconnect(); audio.output.disconnect();
      audio.stream.getTracks().forEach((track) => { track.stop(); });
      void audio.context.close();
    }
    if (unload || !allReady(ready.current)) {
      // Terminating the workers frees their memory at once, even mid-load.
      vadRef.current?.terminate(); listenRef.current?.terminate(); speakRef.current?.terminate();
      vadRef.current = listenRef.current = speakRef.current = null;
      link.current?.close();
      link.current = null;
      ready.current = { vad: false, listen: false, speak: false };
      inFlight.current = null;
    } else {
      // Kept warm: Silero and the listener forget any half-heard speech, and the sentences queued for Luny's voice are dropped.
      const next = ++epoch.current;
      vadRef.current?.postMessage({ type: "active", active: false } satisfies VadRequest);
      vadRef.current?.postMessage({ type: "reset", epoch: next } satisfies VadRequest);
      listenRef.current?.postMessage({ type: "reset", epoch: next } satisfies ListenRequest);
      heardPlaying.current = false;
    }
    setProgress(null);
    stateRef.current = "off";
    setState("off");
    setError(reason);
  }, [calm, interrupt, quiet]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (audioRef.current || starting.current) return;
    starting.current = true;
    const id = ++startId.current;
    setError(null);
    setState("loading");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Talking with Luny needs a secure connection and a supported browser.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const listener = await pickListener();
      if (id !== startId.current) { stream.getTracks().forEach((track) => { track.stop(); }); return; }
      context = new AudioContext({ latencyHint: "interactive" });
      await context.resume();
      const url = URL.createObjectURL(new Blob([FRAMES_WORKLET], { type: "text/javascript" }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (id !== startId.current) { stream.getTracks().forEach((track) => { track.stop(); }); await context.close(); return; }
      // Models kept warm from the last time she was on are reused, so she is back in a moment instead of loading again.
      const warm = Boolean(vadRef.current && listenRef.current && speakRef.current && allReady(ready.current));
      if (!warm) {
        vadRef.current?.terminate(); listenRef.current?.terminate(); speakRef.current?.terminate();
        link.current?.close();
        ready.current = { vad: false, listen: false, speak: false };
        epoch.current = 0;
        vadRef.current = new Worker(new URL("./voice/vad.worker.ts", import.meta.url), { type: "module" });
        listenRef.current = new Worker(new URL("./voice/listen.worker.ts", import.meta.url), { type: "module" });
        speakRef.current = new Worker(new URL("./voice/speak.worker.ts", import.meta.url), { type: "module" });
        // Silero hands each utterance to the listener over a port of their own, transferred, never through this page.
        const utterances = new MessageChannel();
        listenRef.current.postMessage({ type: "connect", vad: utterances.port1 } satisfies ListenRequest, [utterances.port1]);
        link.current = utterances.port2;
      }
      const vad = vadRef.current as Worker;
      const listen = listenRef.current as Worker;
      const talk = speakRef.current as Worker;
      vad.onmessage = handleVad;
      listen.onmessage = handleListen;
      talk.onmessage = handleSpeak;
      vad.onerror = listen.onerror = talk.onerror = () => stopRef.current("Luny stopped unexpectedly. Turn her on again to retry.");
      // A context the browser suspended (a device change, a long background stretch) is woken, or Luny's sentences never end.
      const audioContext = context;
      audioContext.onstatechange = () => { if (audioContext.state === "suspended" && audioRef.current?.context === audioContext) void audioContext.resume().catch(() => undefined); };
      const node = new AudioWorkletNode(context, "frames");
      const output = context.createGain();
      output.connect(context.destination);
      // The microphone's frames go from the worklet straight to Silero.
      const frames = new MessageChannel();
      node.port.postMessage(frames.port1, [frames.port1]);
      const utterances = link.current;
      link.current = null;
      vad.postMessage({ type: "connect", frames: frames.port2, ...(utterances ? { listener: utterances } : {}) } satisfies VadRequest, utterances ? [frames.port2, utterances] : [frames.port2]);
      const input = context.createMediaStreamSource(stream);
      input.connect(node);
      // A worklet only runs while something pulls on it; it writes silence.
      node.connect(context.destination);
      // The lesson playing and pausing: for Luny's chime-ins, and for how loud the learner must be to be heard.
      const tick = window.setInterval(() => { if (!allReady(ready.current)) return; follow(latest.current.lesson()); syncPlaying(); }, FOLLOW_MS);
      audioRef.current = { context, stream, node, input, output, tick };
      if (warm) {
        activate();
        settle();
        greet();
      } else {
        downloads.current = { listen: 0, speak: 0 };
        vad.postMessage({ type: "load" } satisfies VadRequest);
        listen.postMessage({ type: "load", listener } satisfies ListenRequest);
        settle();
      }
    } catch (cause) {
      stream?.getTracks().forEach((track) => { track.stop(); });
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      if (id === startId.current) stop(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Allow the microphone to talk with Luny." : "Luny couldn't start. Check your connection and try again.");
    } finally {
      if (id === startId.current) starting.current = false;
    }
  }, [activate, follow, greet, handleListen, handleSpeak, handleVad, settle, stop, syncPlaying]);

  useEffect(() => () => stop(), [stop]);
  // Waking a tab can find the audio suspended; it is resumed so Luny is heard again.
  useEffect(() => {
    const wake = () => { const context = audioRef.current?.context; if (document.visibilityState === "visible" && context?.state === "suspended") void context.resume().catch(() => undefined); };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, []);
  // Turned off by hand, she keeps her models loaded for a quick return; the lesson closing unloads them (the effect above).
  const end = useCallback(() => stop(null, false), [stop]);
  return { state, progress, error, start, stop: end };
}

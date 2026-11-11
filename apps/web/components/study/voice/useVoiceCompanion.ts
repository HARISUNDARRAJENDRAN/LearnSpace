"use client";

import type { NotesSpatial, NotesStreamEvent, NotesView, TutorVisual } from "@learnspace/shared/notes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ListenReply, ListenRequest } from "./listen.worker";
import type { SpeakReply, SpeakRequest } from "./speak.worker";

export type VoiceState = "off" | "loading" | "listening" | "hearing" | "thinking" | "speaking";

const FRAMES_WORKLET = `class Frames extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.t = 0; this.prev = 0; this.frame = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    let t = this.t;
    while (t < x.length - 1) {
      const i = Math.floor(t);
      const a = i < 0 ? this.prev : x[i];
      this.frame[this.n++] = a + (x[i + 1] - a) * (t - i);
      if (this.n === 512) { this.port.postMessage(this.frame, [this.frame.buffer]); this.frame = new Float32Array(512); this.n = 0; }
      t += this.ratio;
    }
    this.t = t - x.length;
    this.prev = x[x.length - 1];
    return true;
  }
}
registerProcessor("frames", Frames);`;

export function chunkEnd(text: string, from: number, first: boolean, final: boolean): number {
  const rest = text.slice(from);
  const sentence = /[.!?…]["'”’»)\]]*(\s|$)/.exec(rest);
  if (sentence && (sentence.index + sentence[0].length < rest.length || final)) return from + sentence.index + sentence[0].length;
  if (first) {
    const clause = /[,;:—]\s/.exec(rest.slice(12));
    if (clause) return from + 12 + clause.index + clause[0].length;
  }
  return final && rest.trim() ? text.length : -1;
}

type Turn = { controller: AbortController; utterances: number; spoken: number };
type SpeechJob = { id: number; text: string };
type VoiceOptions = { sessionId: string; positionMs: () => number | null; onNotes: (notes: NotesView) => void; spatial?: () => NotesSpatial; onVisual?: (visual: TutorVisual) => void; onCommand?: (utterance: string) => boolean };

export function useVoiceCompanion(options: VoiceOptions) {
  const { sessionId } = options;
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<VoiceState>("off");
  const [enabled, setEnabled] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const level = useRef(0);
  const listenRef = useRef<Worker | null>(null);
  const speakRef = useRef<Worker | null>(null);
  const readyRef = useRef({ listen: false, speak: false });
  const downloads = useRef({ listen: 0, speak: 0 });
  const startId = useRef(0);
  const starting = useRef(false);
  const audioRef = useRef<{ context: AudioContext; stream: MediaStream; node: AudioWorkletNode; input: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const pending = useRef<string[]>([]);
  const turnRef = useRef<Turn | null>(null);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const speechQueue = useRef<SpeechJob[]>([]);
  const inFlight = useRef<number | null>(null);
  const speechId = useRef(0);
  const cancelled = useRef(0);
  const nextTime = useRef(0);
  const awaiting = useRef<number | null>(null);
  const pumpRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);

  const setPlaying = useCallback((playing: boolean) => listenRef.current?.postMessage({ type: "playing", playing } satisfies ListenRequest), []);
  const settle = useCallback(() => {
    const count = sources.current.size + speechQueue.current.length + (inFlight.current === null ? 0 : 1);
    setState(count && awaiting.current === null ? "speaking" : turnRef.current || count ? "thinking" : !audioRef.current ? "off" : !readyRef.current.listen || !readyRef.current.speak ? "loading" : "listening");
  }, []);
  const interrupt = useCallback(() => {
    turnRef.current?.controller.abort();
    turnRef.current = null;
    cancelled.current = speechId.current + 1;
    awaiting.current = null;
    speechQueue.current = [];
    // Keep the cancelled synthesis in flight until it replies. It owns the worker until then.
    speakRef.current?.postMessage({ type: "cancel", before: cancelled.current } satisfies SpeakRequest);
    for (const source of sources.current) { source.onended = null; source.stop(); source.disconnect(); source.buffer = null; }
    sources.current.clear();
    nextTime.current = 0;
    level.current = 0;
    setPlaying(false);
  }, [setPlaying]);
  const pump = useCallback(() => {
    // Only two audio buffers may wait for playback; the rest stay as tiny text strings.
    if (inFlight.current !== null || sources.current.size >= 2 || !readyRef.current.speak || !audioRef.current) return;
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
    source.connect(audio.analyser);
    const start = Math.max(audio.context.currentTime + .01, nextTime.current);
    nextTime.current = start + buffer.duration;
    source.onended = () => {
      sources.current.delete(source);
      source.disconnect();
      source.buffer = null;
      pumpRef.current();
      if (!sources.current.size) setPlaying(false);
      settle();
    };
    sources.current.add(source);
    source.start(start);
    setPlaying(true);
    setState("speaking");
    if (awaiting.current !== null) { setLatencyMs(Math.round(Date.now() + (start - audio.context.currentTime) * 1000 - awaiting.current)); awaiting.current = null; }
  }, [setPlaying, settle]);

  const runTurn = useCallback(async (endedAt: number) => {
    const utterance = pending.current.join(" ").slice(-4000);
    if (latest.current.onCommand?.(utterance)) { pending.current = []; settle(); return; }
    if (/^(?:please )?(?:stop listening|turn (?:off|the microphone off)|microphone off)[.!?]?$/i.test(utterance.trim())) { stopRef.current(); return; }
    const turn: Turn = { controller: new AbortController(), utterances: pending.current.length, spoken: 0 };
    turnRef.current = turn;
    awaiting.current = endedAt;
    setState("thinking"); setReply(""); setError(null);
    let say = "";
    let completed = false;
    const queue = (final: boolean) => {
      for (let end = chunkEnd(say, turn.spoken, turn.spoken === 0, final); end > 0; end = chunkEnd(say, turn.spoken, false, final)) { speak(say.slice(turn.spoken, end)); turn.spoken = end; }
    };
    try {
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/notes/turn`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ utterance, positionMs: latest.current.positionMs(), spatial: latest.current.spatial?.() }), signal: turn.controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Luna couldn't answer just now.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      const handle = (line: string) => {
        if (!line.trim() || turnRef.current !== turn) return;
        const event = JSON.parse(line) as NotesStreamEvent;
        if (event.type === "say") { say = event.text; setReply(say); queue(false); }
        else if (event.type === "done") { completed = true; say = event.say; setReply(say); queue(true); pending.current.splice(0, turn.utterances); latest.current.onNotes(event.notes); latest.current.onVisual?.(event.visual); }
        else throw new Error(event.message);
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          if (buffer.length > 200_000) throw new Error("Luna's reply was too large. Try a shorter question.");
          let newline = buffer.indexOf("\n");
          while (newline >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); handle(line); newline = buffer.indexOf("\n"); }
        }
        handle(buffer);
        if (!completed && !turn.controller.signal.aborted) throw new Error("Lost the connection to Luna. Try again.");
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } catch (cause) {
      if (!turn.controller.signal.aborted && turnRef.current === turn) {
        interrupt(); pending.current.splice(0, turn.utterances); setError(cause instanceof Error ? cause.message : "Lost the connection to Luna.");
      }
    } finally { if (turnRef.current === turn) turnRef.current = null; settle(); }
  }, [sessionId, settle, speak, interrupt]);

  const handleListen = useCallback((event: MessageEvent<ListenReply>) => {
    const message = event.data;
    if (message.type === "download") { downloads.current.listen = message.progress; setProgress(Math.round((downloads.current.listen + downloads.current.speak) / 2)); }
    else if (message.type === "ready") {
      readyRef.current.listen = true;
      downloads.current.listen = 100;
      // Avoid loading both model sets concurrently: their download/deserialization buffers otherwise overlap.
      speakRef.current?.postMessage({ type: "load" } satisfies SpeakRequest);
      settle();
    } else if (message.type === "error") { setError("Voice couldn't start. Try turning it on again."); stopRef.current(); }
    else if (message.type === "speech") { interrupt(); setState("hearing"); setHeard(pending.current.join(" ")); }
    else {
      const text = message.text.trim();
      if (!text || (!message.heard && (turnRef.current || sources.current.size))) return settle();
      interrupt(); pending.current.push(text); setHeard(pending.current.join(" ")); void runTurn(message.endedAt);
    }
  }, [interrupt, runTurn, settle]);
  const handleSpeak = useCallback((event: MessageEvent<SpeakReply>) => {
    const message = event.data;
    if (message.type === "download") { downloads.current.speak = message.progress; setProgress(Math.round((downloads.current.listen + downloads.current.speak) / 2)); }
    else if (message.type === "ready") { readyRef.current.speak = true; downloads.current.speak = 100; setProgress(null); pumpRef.current(); settle(); }
    else if (message.type === "error") { inFlight.current = null; speechQueue.current = []; setError("Luna's voice couldn't load. Turn voice off and on to retry."); settle(); }
    else {
      if (inFlight.current === message.id) inFlight.current = null;
      if (message.type === "audio" && message.id >= cancelled.current) play(message.samples, message.sampleRate);
      pumpRef.current(); settle();
    }
  }, [play, settle]);

  const stop = useCallback(() => {
    ++startId.current; starting.current = false;
    interrupt(); pending.current = [];
    const audio = audioRef.current; audioRef.current = null;
    if (audio) { audio.node.port.onmessage = null; audio.input.disconnect(); audio.node.disconnect(); audio.analyser.disconnect(); audio.stream.getTracks().forEach((track) => { track.stop(); }); void audio.context.close(); }
    // Terminating the workers returns their WASM high-water heaps immediately, including during model loading.
    listenRef.current?.terminate(); speakRef.current?.terminate(); listenRef.current = speakRef.current = null;
    readyRef.current = { listen: false, speak: false }; inFlight.current = null; level.current = 0;
    setProgress(null); setState("off"); setEnabled(false);
  }, [interrupt]);
  stopRef.current = stop;
  const start = useCallback(async () => {
    if (audioRef.current || starting.current) return;
    starting.current = true;
    const id = ++startId.current;
    setError(null); setState("loading"); setEnabled(true);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Voice needs a secure connection and a supported browser.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (id !== startId.current) { stream.getTracks().forEach((track) => { track.stop(); }); return; }
      context = new AudioContext({ latencyHint: "interactive" });
      await context.resume();
      const url = URL.createObjectURL(new Blob([FRAMES_WORKLET], { type: "text/javascript" }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (id !== startId.current) { stream.getTracks().forEach((track) => { track.stop(); }); await context.close(); return; }
      const listen = new Worker(new URL("./listen.worker.ts", import.meta.url), { type: "module" });
      const talk = new Worker(new URL("./speak.worker.ts", import.meta.url), { type: "module" });
      listenRef.current = listen; speakRef.current = talk;
      listen.onmessage = handleListen; talk.onmessage = handleSpeak;
      const crashed = () => { setError("Voice stopped unexpectedly. Turn it on again to retry."); stopRef.current(); };
      listen.onerror = talk.onerror = crashed;
      const node = new AudioWorkletNode(context, "frames");
      const analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.connect(context.destination);
      const meter = new Float32Array(256);
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!readyRef.current.listen || !readyRef.current.speak) return;
        let sum = 0;
        if (sources.current.size) { analyser.getFloatTimeDomainData(meter); for (const value of meter) sum += value * value; level.current = Math.min(1, Math.sqrt(sum / meter.length) * 4); }
        else { for (const value of event.data) sum += value * value; level.current = Math.min(1, Math.sqrt(sum / event.data.length) * 4); }
        listen.postMessage({ type: "frame", frame: event.data } satisfies ListenRequest, [event.data.buffer]);
      };
      const input = context.createMediaStreamSource(stream); input.connect(node); node.connect(context.destination);
      audioRef.current = { context, stream, node, input, analyser };
      downloads.current = { listen: 0, speak: 0 };
      listen.postMessage({ type: "load" } satisfies ListenRequest);
      settle();
    } catch (cause) {
      stream?.getTracks().forEach((track) => { track.stop(); });
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      if (id === startId.current) { stop(); setError(cause instanceof Error && cause.name === "NotAllowedError" ? "Allow microphone access in your browser to talk with Luna." : "Voice couldn't start. Check your connection and try again."); }
    } finally { if (id === startId.current) starting.current = false; }
  }, [handleListen, handleSpeak, settle, stop]);
  const send = useCallback((text: string) => { if (!text.trim()) return; interrupt(); pending.current.push(text.trim()); setHeard(pending.current.join(" ")); void runTurn(Date.now()); }, [interrupt, runTurn]);
  useEffect(() => stop, [stop]);
  return { state, enabled, progress, error, heard, reply, latencyMs, level, start, stop, send, interrupt };
}

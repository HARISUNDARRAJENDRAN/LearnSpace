"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechReply, SpeechRequest } from "./speech.worker";

export type SpeechState = "idle" | "recording" | "transcribing";

const SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 30_000;

let persistRequested = false;

/** The recording as 16 kHz mono samples, the input the speech model expects. */
async function decode(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    return (await context.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);
  } finally {
    void context.close();
  }
}

/**
 * Dictation that runs entirely in the browser: the microphone is recorded locally and a speech model in a
 * web worker turns it into text. The model downloads once, on first use while the learner is still speaking,
 * and is read from the browser cache after that.
 */
export function useSpeechInput(onText: (text: string) => void) {
  const [state, setState] = useState<SpeechState>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const release = useCallback(() => { workerRef.current?.terminate(); workerRef.current = null; }, []);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const handle = useCallback((event: MessageEvent<SpeechReply>) => {
    const message = event.data;
    if (message.type === "download") {
      setProgress(message.progress < 100 ? message.progress : null);
      // Cache storage is best-effort by default; asking to keep it stops the browser evicting the model under storage pressure.
      if (!persistRequested) {
        persistRequested = true;
        void navigator.storage?.persist?.().catch(() => false);
      }
    } else if (message.type === "ready") setProgress(null);
    else if (message.type === "error") {
      setProgress(null);
      setError("Voice input couldn't start. Check your connection and try again.");
      release();
      setState((current) => (current === "transcribing" ? "idle" : current));
    } else {
      release();
      setState("idle");
      if (message.text) onTextRef.current(message.text);
      else setError("Didn't catch that. Try again a little closer to the mic.");
    }
  }, [release]);

  const send = useCallback((request: SpeechRequest, transfer: Transferable[] = []) => {
    workerRef.current ??= new Worker(new URL("./speech.worker.ts", import.meta.url), { type: "module" });
    const worker = workerRef.current;
    worker.onmessage = handle;
    worker.postMessage(request, transfer);
  }, [handle]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (starting.current || recorderRef.current) return;
    starting.current = true;
    const id = ++generation.current;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      starting.current = false;
      setError("Microphone access is blocked. Allow it in your browser to dictate.");
      return;
    }
    starting.current = false;
    if (id !== generation.current) { stream.getTracks().forEach((track) => { track.stop(); }); return; }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const limit = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, MAX_RECORDING_MS);
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = async () => {
      window.clearTimeout(limit);
      for (const track of stream.getTracks()) track.stop();
      recorderRef.current = null;
      if (id !== generation.current) return;
      setState("transcribing");
      try {
        const audio = await decode(new Blob(chunks, { type: recorder.mimeType }));
        if (id === generation.current) send({ type: "transcribe", audio }, [audio.buffer]);
      } catch {
        setState("idle");
        setError("That recording couldn't be read. Try again.");
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    send({ type: "load" });
  }, [send]);

  useEffect(() => () => {
    generation.current++;
    recorderRef.current?.stream.getTracks().forEach((track) => { track.stop(); });
    release();
  }, [release]);

  return { state, progress, error, start, stop };
}

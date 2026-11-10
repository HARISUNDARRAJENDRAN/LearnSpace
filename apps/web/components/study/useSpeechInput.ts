"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechReply, SpeechRequest } from "./speech.worker";

export type SpeechState = "idle" | "recording" | "transcribing";

const SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 30_000;

// One worker for the whole page, so the loaded model survives the chat remounting (every lesson switch) instead of loading again.
let shared: Worker | null = null;
let persistRequested = false;
const speechWorker = () => {
  shared ??= new Worker(new URL("./speech.worker.ts", import.meta.url), { type: "module" });
  return shared;
};

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
      setState((current) => (current === "transcribing" ? "idle" : current));
    } else {
      setState("idle");
      if (message.text) onTextRef.current(message.text);
      else setError("Didn't catch that. Try again a little closer to the mic.");
    }
  }, []);

  const send = useCallback((request: SpeechRequest, transfer: Transferable[] = []) => {
    const worker = speechWorker();
    worker.onmessage = handle;
    worker.postMessage(request, transfer);
  }, [handle]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Microphone access is blocked. Allow it in your browser to dictate.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const limit = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, MAX_RECORDING_MS);
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = async () => {
      window.clearTimeout(limit);
      for (const track of stream.getTracks()) track.stop();
      recorderRef.current = null;
      setState("transcribing");
      try {
        const audio = await decode(new Blob(chunks, { type: recorder.mimeType }));
        send({ type: "transcribe", audio }, [audio.buffer]);
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
    recorderRef.current?.stream.getTracks().forEach((track) => { track.stop(); });
    if (shared?.onmessage === handle) shared.onmessage = null;
  }, [handle]);

  return { state, progress, error, start, stop };
}

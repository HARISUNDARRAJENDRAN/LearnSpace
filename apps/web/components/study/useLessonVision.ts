"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** One user-chosen browser-tab stream, sampled only when the learner speaks. No video recording or frame history. */
export function useLessonVision(lessonElement: () => HTMLElement | null) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const media = useRef<{ stream: MediaStream; video: HTMLVideoElement } | null>(null);
  const generation = useRef(0);
  const target = useRef(lessonElement);
  target.current = lessonElement;
  const stop = useCallback(() => {
    generation.current++;
    const current = media.current;
    media.current = null;
    current?.stream.getTracks().forEach((track) => { track.stop(); });
    if (current) { current.video.pause(); current.video.srcObject = null; current.video.remove(); }
    setSharing(false);
  }, []);
  const start = useCallback(async () => {
    const id = ++generation.current;
    setError(null);
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Sharing needs a supported desktop browser.");
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser", frameRate: 2 }, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
      if (id !== generation.current) { stream.getTracks().forEach((track) => { track.stop(); }); return; }
      if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser") throw new Error("Choose this LearnSpace browser tab so drawings line up with the lesson.");
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      // Chrome rejects play() for a video outside the document ("the media was removed from the document").
      video.setAttribute("aria-hidden", "true");
      video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.append(video);
      try { await video.play(); } catch (cause) { video.srcObject = null; video.remove(); throw cause; }
      if (id !== generation.current) { stream.getTracks().forEach((track) => { track.stop(); }); video.srcObject = null; video.remove(); return; }
      media.current = { stream, video };
      stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
      setSharing(true);
    } catch (cause) {
      stream?.getTracks().forEach((track) => { track.stop(); });
      if (id === generation.current) setError(cause instanceof Error && cause.name === "Error" ? cause.message : "Luny can’t see the lesson yet.");
    }
  }, [stop]);
  const capture = useCallback((): string | null => {
    const video = media.current?.video;
    const rect = target.current()?.getBoundingClientRect();
    if (!video || video.readyState < 2 || !rect || rect.width <= 0 || rect.height <= 0) return null;
    const sx = video.videoWidth / window.innerWidth;
    const sy = video.videoHeight / window.innerHeight;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / (rect.width * sx));
    canvas.width = Math.round(rect.width * sx * scale);
    canvas.height = Math.round(rect.height * sy * scale);
    const context = canvas.getContext("2d");
    if (!context || canvas.width < 1 || canvas.height < 1) return null;
    context.drawImage(video, rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", .7);
    canvas.width = canvas.height = 0;
    return frame.length <= 700_000 ? frame : null;
  }, []);
  useEffect(() => stop, [stop]);
  return { sharing, error, start, stop, capture };
}

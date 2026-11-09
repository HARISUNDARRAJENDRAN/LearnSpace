"use client";

import { RotateCcw, X } from "lucide-react";
import { useRef } from "react";

/**
 * Plays a finished lesson again in a dialog. It never opens a session or reports progress,
 * so revisiting a lesson cannot reopen it or re-lock the lessons after it.
 */
export function RewatchLesson({ youtubeId, title }: { youtubeId: string; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  function open() {
    if (frame.current) frame.current.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0&modestbranding=1`;
    dialog.current?.showModal();
  }
  // Clearing the source stops playback when the dialog closes.
  function stop() {
    if (frame.current) frame.current.src = "about:blank";
  }
  return <>
    <button className="collection-item-rewatch" type="button" onClick={open} aria-label={`Rewatch ${title}`}><RotateCcw aria-hidden="true" />Rewatch</button>
    <dialog ref={dialog} className="rewatch-dialog" aria-label={`Rewatch ${title}`} onClose={stop}>
      <div className="rewatch-dialog-bar"><strong>{title}</strong><button type="button" aria-label="Close" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button></div>
      <div className="rewatch-dialog-player"><iframe ref={frame} title={title} src="about:blank" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
      <p className="rewatch-dialog-note">Revisiting doesn&apos;t change your progress.</p>
    </dialog>
  </>;
}

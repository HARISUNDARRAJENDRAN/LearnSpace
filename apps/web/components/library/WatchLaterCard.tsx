"use client";

import { ListVideo, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { youtubeThumbnailSources } from "../../lib/home/thumbnail";
import type { WatchLaterPlaylist } from "../../lib/library/watch-later";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";

const addedDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

async function failure(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/** A playlist kept for later: continuing it opens (or reopens) it as a course in Sessions. */
export function WatchLaterCard({ playlist }: { playlist: WatchLaterPlaylist }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const thumbnail = youtubeThumbnailSources(playlist.youtubeId);

  async function continueInSessions() {
    setState("starting");
    setError(null);
    try {
      const response = await fetch(`/api/v1/library/collections/${playlist.collectionId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error(await failure(response, "This playlist couldn't be opened. Try again."));
      const body = await response.json() as { route?: string };
      if (!body.route) throw new Error("This playlist couldn't be opened. Try again.");
      router.push(body.route);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This playlist couldn't be opened. Try again.");
      setState("idle");
    }
  }

  async function remove() {
    setState("removing");
    setError(null);
    try {
      const response = await fetch(`/api/v1/library/watch-later/${playlist.collectionId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await failure(response, "This playlist couldn't be removed. Try again."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This playlist couldn't be removed. Try again.");
      setState("idle");
    }
  }

  return (
    <li className="watch-later-card" data-busy={state !== "idle" || undefined}>
      <span className="watch-later-media">
        {thumbnail ? <YouTubeThumbnail src={thumbnail.primary} fallbackSrc={thumbnail.fallback} alt="" fill loading="lazy" sizes="(max-width: 640px) 100vw, 380px" /> : <span className="library-media-placeholder"><ListVideo aria-hidden="true" /></span>}
        <span className="library-media-badge">{playlist.lessonCount} {playlist.lessonCount === 1 ? "lesson" : "lessons"}</span>
        <button className="watch-later-remove" type="button" onClick={() => void remove()} disabled={state !== "idle"} aria-label={`Remove ${playlist.title} from Watch later`} title="Remove from Watch later"><X aria-hidden="true" /></button>
      </span>
      <span className="watch-later-copy">
        <strong>{playlist.title}</strong>
        <small>Playlist · Added {addedDate.format(new Date(playlist.addedAt))}</small>
      </span>
      <button className="watch-later-continue" type="button" onClick={() => void continueInSessions()} disabled={state !== "idle"}>
        <Play aria-hidden="true" />{state === "starting" ? "Opening…" : "Continue in Sessions"}
      </button>
      {error ? <p className="watch-later-error" role="alert">{error}</p> : null}
    </li>
  );
}

"use client";

import Link from "next/link";
import type { StudyAnchor, StudyProgressRequest, StudySessionResource, StudySessionView } from "@learnspace/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type StudyKind = "video" | "paper";
type ProgressEvent = StudyProgressRequest["event"];

type YouTubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};

type YouTubeStateEvent = { data: number };
type YouTubeReadyEvent = { target: YouTubePlayer };
type YouTubePlayerOptions = {
  height: string;
  width: string;
  videoId: string;
  playerVars: { playsinline: 1; rel: 0; modestbranding: 1 };
  events: { onReady: (event: YouTubeReadyEvent) => void; onStateChange: (event: YouTubeStateEvent) => void; onError: () => void };
};
type YouTubeApi = { Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer };

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function routeFromResponse(value: unknown): string {
  if (!value || typeof value !== "object" || !("route" in value) || typeof value.route !== "string") throw new Error("Study route missing");
  return value.route;
}

function formatTime(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function anchorLabel(anchor: StudyAnchor | null): string | null {
  if (!anchor) return null;
  if (anchor.kind === "video") return formatTime(anchor.positionMs);
  if (anchor.sectionId) return anchor.page ? `${anchor.sectionId} · page ${anchor.page}` : anchor.sectionId;
  return anchor.page ? `Page ${anchor.page}` : null;
}

function provenanceLabel(resource: StudySessionResource["introducedFrom"]): string | null {
  if (!resource) return null;
  const anchor = anchorLabel(resource.anchor);
  return `Opened from: ${resource.title}${anchor ? ` · ${anchor}` : ""}`;
}

async function youtubeApi(): Promise<YouTubeApi> {
  if (window.YT) return window.YT;
  return new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube API did not initialize"));
    };
    const existing = document.getElementById("youtube-iframe-api");
    if (existing) return;
    const script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube API could not load"));
    document.head.appendChild(script);
  });
}

function useProgressSync(sessionId: string, resource: StudySessionResource, onProgress: (value: number) => void) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const lastPositionRef = useRef(0);
  const sync = useCallback(async (event: ProgressEvent, force = false) => {
    const player = playerRef.current;
    if (!player) return;
    const duration = player.getDuration();
    const positionMs = Math.max(0, Math.round(player.getCurrentTime() * 1_000));
    if (!Number.isFinite(duration) || duration <= 0 || (!force && Math.abs(positionMs - lastPositionRef.current) < 5_000)) return;
    lastPositionRef.current = positionMs;
    const progressPct = event === "complete" ? 100 : Math.min(100, Math.max(0, (positionMs / (duration * 1_000)) * 100));
    onProgress(progressPct);
    const anchor: StudyAnchor = { kind: "video", positionMs };
    try {
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: resource.resourceId, progressPct, anchor, event, idempotencyKey: `${event}-${event === "checkpoint" ? Math.floor(positionMs / 15_000) : Math.floor(positionMs / 1_000)}` }) });
      if (!response.ok) throw new Error("Progress sync failed");
    } catch {
      onProgress(progressPct);
    }
  }, [onProgress, resource.resourceId, sessionId]);
  return { playerRef, sync };
}

function YouTubeLessonPlayer({ sessionId, resource, onProgress }: { sessionId: string; resource: StudySessionResource; onProgress: (value: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { playerRef, sync } = useProgressSync(sessionId, resource, onProgress);
  const syncRef = useRef(sync);
  const [playerState, setPlayerState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(resource.lastAnchor?.kind === "video" ? resource.lastAnchor.positionMs : 0);
  const [search, setSearch] = useState("");
  syncRef.current = sync;
  const transcript = useMemo(() => resource.chunks.filter((chunk) => chunk.chunkType === "transcript" && chunk.startMs !== null), [resource.chunks]);
  const filteredTranscript = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? transcript.filter((chunk) => chunk.content.toLowerCase().includes(query)) : transcript;
  }, [search, transcript]);

  useEffect(() => {
    if (!resource.video?.youtubeId || resource.readiness === "unavailable") {
      setPlayerState("unavailable");
      return;
    }
    let cancelled = false;
    void youtubeApi().then((api) => {
      if (cancelled || !containerRef.current) return;
      const player = new api.Player(containerRef.current, {
        height: "100%",
        width: "100%",
        videoId: resource.video?.youtubeId ?? "",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: ({ target }) => {
            playerRef.current = target;
            setPlayerState("ready");
            const resumeMs = resource.lastAnchor?.kind === "video" ? resource.lastAnchor.positionMs : 0;
            if (resumeMs > 0) target.seekTo(resumeMs / 1_000, true);
          },
          onStateChange: ({ data }) => {
            if (data === 1) {
              setPlaying(true);
              void syncRef.current("play", true);
            } else if (data === 2) {
              setPlaying(false);
              void syncRef.current("pause", true);
            } else if (data === 0) {
              setPlaying(false);
              void syncRef.current("complete", true);
            }
          },
          onError: () => {
            setPlaying(false);
            playerRef.current = null;
            setPlayerState("unavailable");
          },
        },
      });
      playerRef.current = player;
    }).catch(() => {
      if (!cancelled) setPlayerState("unavailable");
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [resource.lastAnchor, resource.readiness, resource.video?.youtubeId, playerRef]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player) setCurrentMs(Math.max(0, Math.round(player.getCurrentTime() * 1_000)));
    }, 1_000);
    const checkpoint = window.setInterval(() => { void syncRef.current("checkpoint"); }, 15_000);
    return () => { window.clearInterval(timer); window.clearInterval(checkpoint); };
  }, [playing, playerRef]);

  useEffect(() => {
    const handleVisibility = () => { if (document.visibilityState === "hidden") void syncRef.current("checkpoint", true); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  function seek(startMs: number) {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(startMs / 1_000, true);
    setCurrentMs(startMs);
    void syncRef.current("seek", true);
  }

  return <div className="study-video-stack"><div className="study-player-frame"><div className="study-player" ref={containerRef} />{playerState === "loading" ? <div className="study-player-state">Loading the lesson player…</div> : null}{playerState === "unavailable" ? <div className="study-player-state"><strong>This video can&apos;t be played inside LearnSpace.</strong><span>Your StudySession is still available. Open the source to continue on YouTube.</span>{resource.canonicalUrl ? <a href={resource.canonicalUrl} target="_blank" rel="noreferrer">Open on YouTube</a> : null}</div> : null}</div><section className="study-transcript" aria-labelledby="transcript-title"><div className="study-section-heading"><div><p className="study-label">Supporting material</p><h2 id="transcript-title">Transcript</h2></div>{transcript.length > 0 ? <label className="study-search"><span className="sr-only">Search transcript</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transcript" /></label> : null}</div>{transcript.length === 0 ? <div className="study-preparing"><strong>Transcript is preparing</strong><span>No timestamped transcript chunks exist for this version yet. Nothing has been invented here.</span></div> : <div className="study-transcript-list">{filteredTranscript.map((chunk) => { const active = chunk.startMs !== null && currentMs >= chunk.startMs && (chunk.endMs === null || currentMs < chunk.endMs); return <button className={active ? "is-current" : ""} type="button" key={chunk.id} onClick={() => seek(chunk.startMs ?? 0)}><time>{formatTime(chunk.startMs ?? 0)}</time><span>{chunk.content}</span></button>; })}</div>}{filteredTranscript.length === 0 && transcript.length > 0 ? <p className="muted-copy">No transcript segment matches that search.</p> : null}</section></div>;
}

function PaperReader({ sessionId, resource, onProgress }: { sessionId: string; resource: StudySessionResource; onProgress: (value: number) => void }) {
  const initialAnchor = resource.progress.lastAnchor?.kind === "paper" ? resource.progress.lastAnchor : resource.lastAnchor?.kind === "paper" ? resource.lastAnchor : null;
  const [page, setPage] = useState(initialAnchor?.page ?? 1);
  const [sectionId, setSectionId] = useState(initialAnchor?.sectionId ?? "");
  const [progress, setProgress] = useState(resource.progress.progressPct);
  const [message, setMessage] = useState("");
  const sections = useMemo(() => [...new Set(resource.chunks.flatMap((chunk) => chunk.headingPath).filter(Boolean))], [resource.chunks]);
  async function save(nextProgress = progress, complete = false) {
    const anchor: StudyAnchor = sectionId ? { kind: "paper", page: Math.max(1, page), sectionId } : { kind: "paper", page: Math.max(1, page) };
    try {
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: resource.resourceId, progressPct: complete ? 100 : nextProgress, anchor, event: complete ? "complete" : "checkpoint", idempotencyKey: `paper-${anchor.page}-${anchor.sectionId ?? "page"}-${complete ? "complete" : nextProgress}` }) });
      if (!response.ok) throw new Error("Paper progress sync failed");
      const savedProgress = complete ? 100 : nextProgress;
      setProgress(savedProgress);
      onProgress(savedProgress);
      setMessage("Reading position saved");
    } catch {
      setMessage("Could not sync this reading position");
    }
  }
  return <div className="paper-reader-stack"><div className="paper-reader-frame">{resource.paper?.pdfSourceUrl ? <iframe title={resource.title} src={resource.paper.pdfSourceUrl} referrerPolicy="no-referrer" /> : <div className="study-preparing"><strong>Paper source unavailable</strong><span>The catalogue has metadata for this paper, but no readable PDF source is attached.</span>{resource.canonicalUrl ? <a href={resource.canonicalUrl} target="_blank" rel="noreferrer">View the paper source</a> : null}</div>}</div><section className="paper-progress-control" aria-labelledby="reading-position-title"><div><p className="study-label">Your place</p><h2 id="reading-position-title">Reading position</h2><p>Save a page or parsed section when you move through the paper.</p></div><div className="paper-progress-fields"><label>Page<input type="number" min="1" value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))} /></label>{sections.length > 0 ? <label>Section<select value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Choose a section</option>{sections.map((section) => <option key={section} value={section}>{section}</option>)}</select></label> : null}</div><label className="paper-progress-range">Progress <input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(Number(event.target.value))} /><output>{Math.round(progress)}%</output></label><div className="paper-progress-actions"><button type="button" onClick={() => void save()}>Save position</button><button className="quiet-button" type="button" onClick={() => void save(100, true)}>Mark paper complete</button></div><span className="study-inline-message" aria-live="polite">{message}</span></section></div>;
}

function SessionMaterials({ session }: { session: StudySessionView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  async function activate(resource: StudySessionResource) {
    if (resource.resourceId === session.activeResourceId) return;
    setError("");
    try {
      const response = await fetch(`/api/v1/study-sessions/${session.id}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: resource.resourceId, idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Material switch failed");
      router.push(routeFromResponse(await response.json()));
    } catch {
      setError("This material could not be activated.");
    }
  }
  return <div className="study-materials"><button className="study-materials-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Session materials <span>{session.resources.length}</span></button>{open ? <div className="study-materials-popover" role="dialog" aria-label="Session materials"><div className="study-popover-heading"><strong>Session materials</strong><button type="button" onClick={() => setOpen(false)}>Close</button></div><ul>{session.resources.map((resource) => <li key={resource.resourceId}><button className={resource.resourceId === session.activeResourceId ? "is-active" : ""} type="button" onClick={() => void activate(resource)}><span className="material-type">{resource.type === "video" ? "Video" : "Paper"}</span><span>{resource.title}</span><small>{resource.progress.progressPct > 0 ? `${Math.round(resource.progress.progressPct)}%` : resource.readiness}</small></button></li>)}</ul>{error ? <p className="study-error" role="alert">{error}</p> : null}</div> : null}</div>;
}

function StudyRail({ session, kind, onRelated }: { session: StudySessionView; kind: StudyKind; onRelated: (resource: StudySessionResource) => void }) {
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState("");
  const active = session.activeResource;
  const contextLabel = provenanceLabel(active?.introducedFrom ?? null) ?? `For this ${kind === "video" ? "lesson" : "paper"}`;
  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setMessage("Preparing the lesson context…");
    try {
      const response = await fetch(`/api/v1/study-sessions/${session.id}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, anchor: session.activeAnchor ?? undefined, idempotencyKey: crypto.randomUUID() }) });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error("Question failed");
      const body = value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : "Grounded answers are not available yet.";
      setMessage(body);
    } catch {
      setMessage("The lesson context could not be checked right now.");
    }
  }
  return <aside className="study-rail"><section className="study-rail-panel ask-panel"><p className="study-label">Contextual help</p><h2>{kind === "video" ? "Ask the lesson" : "Ask this paper"}</h2><p>{kind === "video" ? "Questions will be grounded in the transcript when it is ready." : "Questions will be grounded in this paper when parsed text is ready."}</p><form onSubmit={(event) => void ask(event)}><label className="sr-only" htmlFor="study-question">Ask a question</label><textarea id="study-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I understand here?" rows={3} /><button type="submit">Ask</button></form>{message ? <p className="study-inline-message" aria-live="polite">{message}</p> : null}</section><section className="study-rail-panel"><p className="study-label">Keep your thread</p><h2>Notes</h2><p className="muted-copy">No notes in this session yet.</p></section><section className="study-rail-panel"><p className="study-label">Concept context</p><h2>Concepts</h2>{active && active.concepts.length > 0 ? <ul className="concept-list">{active.concepts.slice(0, 8).map((concept) => <li key={concept.id}><span>{concept.name}</span>{concept.isPrimary ? <small>Primary</small> : null}</li>)}</ul> : <p className="muted-copy">Concept mappings will appear when the catalogue has them.</p>}</section><section className="study-rail-panel related-panel"><p className="study-label">{kind === "video" ? "Go deeper" : "Need another explanation?"}</p><h2>{kind === "video" ? "A paper for the next pass" : "A visual explanation"}</h2>{session.related.length > 0 ? session.related.slice(0, 2).map((resource) => <button className="related-resource" type="button" key={resource.resourceId} onClick={() => onRelated(resource)}><span className="related-context">{contextLabel}</span><strong>{resource.title}</strong><small>{kind === "video" ? "Study paper" : "Watch explanation"}</small></button>) : <p className="muted-copy">Related catalogue material will appear as the library grows.</p>}</section></aside>;
}

function PaperOutline({ resource }: { resource: StudySessionResource }) {
  const headings = [...new Set(resource.chunks.flatMap((chunk) => chunk.headingPath).filter(Boolean))];
  return <aside className="paper-outline"><p className="study-label">Paper map</p><h2>Outline</h2>{headings.length > 0 ? <ol>{headings.map((heading) => <li key={heading}>{heading}</li>)}</ol> : <p className="muted-copy">No parsed section structure is available yet.</p>}</aside>;
}

export function StudyWorkspace({ session, kind }: { session: StudySessionView; kind: StudyKind }) {
  const active = session.activeResource;
  const [progress, setProgress] = useState(active?.progress.progressPct ?? 0);
  const [navigationError, setNavigationError] = useState("");
  const router = useRouter();
  if (!active) return <main className="study-page"><div className="study-error-state"><h1>This study session has no active material.</h1><Link href="/app/sessions">Back to Sessions</Link></div></main>;
  const sourceResource = active.introducedFrom ? session.resources.find((resource) => resource.resourceId === active.introducedFrom?.resourceId) ?? null : null;
  async function openMaterial(resourceId: string, role?: "related") {
    setNavigationError("");
    try {
      const response = await fetch(`/api/v1/study-sessions/${session.id}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, ...(role ? { role } : {}), idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Material navigation failed");
      router.push(routeFromResponse(await response.json()));
    } catch {
      setNavigationError("This material could not be opened right now.");
    }
  }
  return <main className={`study-page study-page-${kind}`}><header className="study-topbar"><Link className="study-back-link" href="/app/sessions">Back to Sessions</Link><span className="study-session-state">{session.status} session</span><SessionMaterials session={session} /></header><section className="study-hero"><div><p className="study-label">{kind === "video" ? "Video Study" : "Paper Study"}</p><h1>{active.title}</h1><p className="study-hero-description">{active.description ?? "A focused LearnSpace learning context."}</p><div className="study-hero-meta">{kind === "video" && active.video?.channelTitle ? <span>{active.video.channelTitle}</span> : null}{kind === "paper" && active.paper?.authors.length ? <span>{active.paper.authors.slice(0, 3).join(", ")}</span> : null}{kind === "paper" && active.paper?.venue ? <span>{active.paper.venue}</span> : null}{kind === "paper" && active.paper?.publicationDate ? <span>{active.paper.publicationDate}</span> : null}<span>{active.readiness === "ready" ? "Learning material ready" : active.readiness === "preparing" ? "Learning context preparing" : "Material unavailable"}</span></div></div><div className="study-hero-progress"><span>{Math.round(progress)}%</span><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div><small>{active.progress.completedAt ? `Completed ${formatDate(active.progress.completedAt)}` : active.progress.lastAnchor ? "Resuming your place" : "Not started"}</small></div></section>{active.introducedFrom ? <section className="study-return-context" aria-label="Study context"><div><p className="study-label">Context</p><p>{provenanceLabel(active.introducedFrom)}</p></div>{sourceResource ? <button type="button" onClick={() => void openMaterial(sourceResource.resourceId)}>← Return to {sourceResource.type === "paper" ? "paper" : "video"}</button> : <span className="muted-copy">The source material is no longer available.</span>}</section> : null}{navigationError ? <p className="study-navigation-error" role="alert">{navigationError}</p> : null}<div className={`study-layout study-layout-${kind}`}>{kind === "paper" ? <PaperOutline resource={active} /> : null}<section className="study-main-column">{kind === "video" ? <YouTubeLessonPlayer sessionId={session.id} resource={active} onProgress={setProgress} /> : <PaperReader sessionId={session.id} resource={active} onProgress={setProgress} />}</section><StudyRail session={session} kind={kind} onRelated={(resource) => void openMaterial(resource.resourceId, "related")} /></div></main>;
}

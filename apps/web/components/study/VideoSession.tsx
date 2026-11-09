"use client";

import type { StudyAnchor, StudyProgressRequest, StudySessionResource, StudySessionView } from "@learnspace/shared";
import { Code, Crosshair, Expand, ListChecks, Maximize, Minus, NotebookPen, Plus, Shrink, Sparkles, Video, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CollapseSidebarContext } from "../application/ApplicationShell";
import { type CanvasRect, CourseGraph, layoutCourse } from "./CourseGraph";
import { SessionChat } from "./SessionChat";
import { SessionCode } from "./SessionCode";
import { SessionNotes } from "./SessionNotes";
import { SessionQuiz } from "./SessionQuiz";
import { useStudyTime } from "./useStudyTime";

type ProgressEvent = StudyProgressRequest["event"];

type YouTubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
};

type YouTubeStateEvent = { data: number };
type YouTubeReadyEvent = { target: YouTubePlayer };
type YouTubePlayerOptions = {
  height: string;
  width: string;
  videoId: string;
  playerVars: { playsinline: 1; rel: 0; modestbranding: 1; fs: 0 };
  events: { onReady: (event: YouTubeReadyEvent) => void; onStateChange: (event: YouTubeStateEvent) => void; onError: () => void };
};
type YouTubeApi = { Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer };

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type CanvasView = { x: number; y: number; zoom: number };

const CARD_WIDTH = 960;
const CARD_HEIGHT = 540;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

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

function useProgressSync(sessionId: string, resource: StudySessionResource, onComplete: () => void) {
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
    const anchor: StudyAnchor = { kind: "video", positionMs };
    try {
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: resource.resourceId, progressPct, anchor, event, idempotencyKey: `${event}-${event === "checkpoint" ? Math.floor(positionMs / 15_000) : Math.floor(positionMs / 1_000)}` }) });
      if (!response.ok) throw new Error("Progress sync failed");
      if (event === "complete") onComplete();
    } catch {
      // Progress is retried on the next checkpoint.
    }
  }, [onComplete, resource.resourceId, sessionId]);
  return { playerRef, sync };
}

function useYouTubeLesson(sessionId: string, resource: StudySessionResource, onComplete: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { playerRef, sync } = useProgressSync(sessionId, resource, onComplete);
  const syncRef = useRef(sync);
  const [playerState, setPlayerState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [playing, setPlaying] = useState(false);
  useStudyTime(sessionId, resource.resourceId, playing);
  const [currentMs, setCurrentMs] = useState(resource.lastAnchor?.kind === "video" ? resource.lastAnchor.positionMs : 0);
  syncRef.current = sync;

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
        // YouTube's own fullscreen would take only the iframe; the session's fullscreen keeps the study tools beside it.
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0 },
        events: {
          onReady: ({ target }) => {
            playerRef.current = target;
            setPlayerState("ready");
            const resumeMs = resource.lastAnchor?.kind === "video" ? resource.lastAnchor.positionMs : 0;
            if (resumeMs > 0) target.seekTo(resumeMs / 1_000, true);
          },
          onStateChange: ({ data }) => {
            setPlaying(data === 1);
            if (data === 1) {
              void syncRef.current("play", true);
            } else if (data === 2) {
              void syncRef.current("pause", true);
            } else if (data === 0) {
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

  function togglePlay() {
    const player = playerRef.current;
    if (!player) return;
    if (player.getPlayerState() === 1) player.pauseVideo();
    else player.playVideo();
  }

  return { containerRef, playerState, currentMs, seek, togglePlay };
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The whiteboard: wheel pans, ctrl/cmd + wheel zooms around the cursor, and dragging the background pans. */
/** `home` is what the canvas frames on load and on resize; `bounds` is everything on it, for zoom to fit. */
function useCanvas(onBackgroundClick: () => void, onBackgroundDoubleClick: () => void, home: CanvasRect, bounds: CanvasRect, homeMargin = 160) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const homeRef = useRef(home);
  const boundsRef = useRef(bounds);
  homeRef.current = home;
  boundsRef.current = bounds;

  // Frames a world rectangle in the viewport; the world origin sits at the viewport centre.
  const frame = useCallback((rect: CanvasRect, margin = 160) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    const zoom = clampZoom(Math.min(1, (box.width - margin) / rect.width, (box.height - margin) / rect.height));
    setView({ zoom, x: -(rect.x + rect.width / 2) * zoom, y: -(rect.y + rect.height / 2) * zoom });
  }, []);
  const homeMarginRef = useRef(homeMargin);
  homeMarginRef.current = homeMargin;
  const frameHome = useCallback(() => frame(homeRef.current, homeMarginRef.current), [frame]);
  const fit = useCallback(() => frame(boundsRef.current), [frame]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    // The world origin sits at the viewport centre, so the zoom anchor is measured from there.
    const px = clientX === undefined ? 0 : clientX - box.left - box.width / 2;
    const py = clientY === undefined ? 0 : clientY - box.top - box.height / 2;
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const scale = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  }, []);

  // Reframe whenever the pane changes size (side panel or sidebar toggles) so nothing spills out.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const box = viewport.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      frameHome();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [frameHome]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomBy(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
      else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    },
    onPointerUp: () => {
      if (dragRef.current && !dragRef.current.moved) onBackgroundClick();
      dragRef.current = null;
    },
    onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onBackgroundDoubleClick();
    },
  };

  return { viewportRef, view, setView, size, fit, frameHome, zoomBy, handlers };
}

type PanelView = "notes" | "quiz" | "code" | "ai";

const tools = [
  { view: "notes", label: "Notes", Icon: NotebookPen },
  { view: "quiz", label: "Quiz", Icon: ListChecks },
  { view: "code", label: "Code", Icon: Code },
  { view: "ai", label: "AI", Icon: Sparkles },
] as const;

/** The session's empty frame, shown while the route loads so the shell header never flashes in. */
export function VideoSessionLoading() {
  return <main className="video-session" aria-busy="true" aria-label="Loading session"><div className="session-pane"><header className="session-topbar" /><div className="session-canvas" /></div></main>;
}

const singleCard: CanvasRect = { x: -CARD_WIDTH / 2, y: -CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT };
const FULL_VIEW_MARGIN = 32;
// Room kept under a lesson that fills the pane, so it never covers the zoom toolbar in the bottom corner.
const ZOOM_BAR_SPACE = 40;

/** The largest 16:9 frame that fits the pane, centred on the world origin. */
function fullView(pane: { width: number; height: number }): CanvasRect {
  const width = Math.max(320, Math.min(pane.width - FULL_VIEW_MARGIN, ((pane.height - FULL_VIEW_MARGIN - ZOOM_BAR_SPACE) * 16) / 9));
  const height = (width * 9) / 16;
  return { x: -width / 2, y: -height / 2, width, height };
}

export function VideoSession({ session, active }: { session: StudySessionView; active: StudySessionResource }) {
  const router = useRouter();
  const [selected, setSelected] = useState(false);
  const [panel, setPanel] = useState<PanelView | null>(null);
  // Tools stay mounted once opened, so a chat or quiz survives switching between them.
  const [opened, setOpened] = useState<PanelView[]>([]);
  // A finished lesson moves the session on (the next lesson, or an empty Sessions), so reload it from the server.
  const refresh = useCallback(() => router.refresh(), [router]);
  const lesson = useYouTubeLesson(session.id, active, refresh);
  const course = session.course;
  const layout = useMemo(() => (course ? layoutCourse(course) : null), [course]);
  // Every visit opens on the whole course; double-clicking the current lesson focuses it alone, and that is not remembered.
  const [focused, setFocused] = useState(false);
  // Fullscreen takes the whole session, so the study tools open beside the video instead of being covered by it.
  const sessionRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === sessionRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void sessionRef.current?.requestFullscreen();
  }
  const fillsPane = focused || fullscreen;
  // Filling the pane, the lesson grows to fit it at 100%: resizing the player keeps it sharp, where zooming would scale its pixels.
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const focusRect = fullView(paneSize);
  const card = fillsPane ? focusRect : singleCard;
  const home = fillsPane ? { ...focusRect, height: focusRect.height + ZOOM_BAR_SPACE } : layout ? layout.bounds : singleCard;
  const canvas = useCanvas(() => setSelected(false), () => setFocused(false), home, layout?.bounds ?? card, fillsPane ? FULL_VIEW_MARGIN : 160);
  const { frameHome, size } = canvas;
  useEffect(() => setPaneSize(size), [size]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filling the pane or a new pane size is the trigger; frameHome reads the rectangle it just switched to.
  useEffect(() => frameHome(), [fillsPane, focusRect.width, focusRect.height, frameHome]);
  useEffect(() => {
    if (!focused) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFocused(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);
  const clickTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  // On the course board the lesson keeps a click layer over the player, because clicks inside YouTube's iframe never reach
  // the page: one click plays or pauses, a double-click focuses it. Focused, the layer steps aside for YouTube's controls.
  const boardPreview = Boolean(course) && !fillsPane;
  function clickLesson(event: React.MouseEvent) {
    window.clearTimeout(clickTimer.current);
    if (!boardPreview) {
      setSelected(true);
      return;
    }
    if (event.detail >= 2) {
      setFocused(true);
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      setSelected(true);
      lesson.togglePlay();
    }, 300);
  }
  const lessons = course?.sections.flatMap((section) => section.lessons) ?? [];
  const lessonNumber = lessons.findIndex((item) => item.state === "current") + 1;
  const completedCount = lessons.filter((item) => item.state === "completed").length;
  const collapse = () => setPanel(null);
  const collapseSidebar = useContext(CollapseSidebarContext);

  function openPanel(view: PanelView, focusId?: string) {
    collapseSidebar();
    setPanel(view);
    setOpened((current) => (current.includes(view) ? current : [...current, view]));
    if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }

  const player = <>
    <div className="study-player" ref={lesson.containerRef} />
    {selected && !boardPreview ? null : <button className="session-card-select" type="button" aria-label={boardPreview ? `Play or pause lesson ${lessonNumber}: ${active.title}. Double-click to focus it` : `Select ${active.title}`} title={boardPreview ? "Click to play or pause, double-click to focus" : undefined} onClick={clickLesson} />}
    {lesson.playerState === "loading" ? <div className="study-player-state">Loading the lesson player…</div> : null}
    {lesson.playerState === "unavailable" ? <div className="study-player-state"><strong>This video can&apos;t be played inside LearnSpace.</strong><span>Your StudySession is still available. Open the source to continue on YouTube.</span>{active.canonicalUrl ? <a href={active.canonicalUrl} target="_blank" rel="noreferrer">Open on YouTube</a> : null}</div> : null}
  </>;
  const { view } = canvas;
  const panelView = (target: PanelView) => (opened.includes(target) ? { hidden: panel !== target } : null);
  const notesPanel = panelView("notes");
  const quizPanel = panelView("quiz");
  const codePanel = panelView("code");
  const aiPanel = panelView("ai");
  return (
    <main ref={sessionRef} className={`video-session${panel ? " is-panel-open" : ""}`}>
      <div className="session-pane">
        <header className="session-topbar">
          <nav className="session-crumbs" aria-label="Breadcrumb">
            <Link href="/app" aria-label="Back to Home" title="Home"><Video aria-hidden="true" /></Link>
            <span aria-hidden="true">/</span>
            {course ? <><span className="session-crumb-course" title={course.title}>{course.title}</span><span aria-hidden="true">/</span></> : null}
            <h1 title={active.title}>{active.title}</h1>
          </nav>
          <div className="session-actions">
            <fieldset className="session-tools">
              <legend className="sr-only">Study tools</legend>
              {tools.map(({ view: tool, label, Icon }) => <button key={tool} className={panel === tool ? "is-active" : ""} type="button" aria-pressed={panel === tool} title={label} onClick={() => (panel === tool ? collapse() : openPanel(tool, tool === "ai" ? "study-question" : undefined))}><Icon aria-hidden="true" /><span>{label}</span></button>)}
            </fieldset>
            {course ? <span className="session-course-count" title="Lessons completed">{completedCount}/{lessons.length} done</span> : null}
            <button className="session-icon-button" type="button" aria-pressed={fullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Shrink aria-hidden="true" /> : <Expand aria-hidden="true" />}</button>
          </div>
        </header>
        <div className="session-canvas" ref={canvas.viewportRef} data-lenis-prevent {...canvas.handlers}>
          <div className="session-canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {course ? <CourseGraph course={course} focusRect={fillsPane ? focusRect : null} player={<div className={`session-card${selected ? " is-selected" : ""}`} style={{ inset: 0 }}>{player}</div>} /> : (
              <div className={`session-card${selected ? " is-selected" : ""}`} style={{ width: card.width, height: card.height, left: card.x, top: card.y }}>{player}</div>
            )}
          </div>
          <div className="session-zoom" role="toolbar" aria-label="Zoom">
            {course && !fullscreen ? focused
              ? <button type="button" aria-label="Show the whole course" title="Whole course" onClick={() => setFocused(false)}><Workflow aria-hidden="true" /></button>
              : <button type="button" aria-label="Focus the current lesson" title="Current lesson" onClick={() => setFocused(true)}><Crosshair aria-hidden="true" /></button> : null}
            <button type="button" aria-label="Zoom to fit" title="Zoom to fit" onClick={canvas.fit}><Maximize aria-hidden="true" /></button>
            <button className="session-zoom-value" type="button" aria-label="Reset zoom to 100%" title="Reset zoom" onClick={() => canvas.setView((current) => ({ ...current, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => canvas.zoomBy(1.2)}><Plus aria-hidden="true" /></button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => canvas.zoomBy(1 / 1.2)}><Minus aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      <aside className="session-panel" aria-label="Side panel" data-view={panel ?? undefined} hidden={!panel} onPointerDown={collapseSidebar}>
        {notesPanel ? <div className="session-tool-slot" {...notesPanel}><SessionNotes sessionId={session.id} onCollapse={collapse} /></div> : null}
        {quizPanel ? <div className="session-tool-slot" {...quizPanel}><SessionQuiz sessionId={session.id} onSeek={lesson.seek} onCollapse={collapse} /></div> : null}
        {codePanel ? <div className="session-tool-slot" {...codePanel}><SessionCode sessionId={session.id} onCollapse={collapse} /></div> : null}
        {aiPanel ? <div className="session-tool-slot" {...aiPanel}><SessionChat sessionId={session.id} resource={active} currentMs={lesson.currentMs} onCollapse={collapse} /></div> : null}
      </aside>
    </main>
  );
}

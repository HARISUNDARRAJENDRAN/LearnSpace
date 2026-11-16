"use client";

import type { LessonControl } from "@learnspace/shared/notes";
import type { StudyAnchor, StudyProgressRequest, StudyProgressResponse, StudySessionResource, StudySessionView, StudyTool, StudyWorkspace } from "@learnspace/shared";
import { CircleStop, Code, Crosshair, Expand, ListChecks, Maximize, Minus, NotebookPen, Plus, Shrink, Sparkles, Video, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CollapseSidebarContext } from "../application/ApplicationShell";
import { useSessions } from "../application/sessions";
import { type CanvasRect, CourseGraph, layoutCourse } from "./CourseGraph";
import { PanelResizer } from "./PanelResizer";
import { MasteryCheck } from "./MasteryCheck";
import { SessionChat } from "./SessionChat";
import { CodingWorkspace } from "../coding/CodingWorkspace";
import { useCodingProfile } from "../coding/useCodingProfile";
import { useLessonVision } from "./useLessonVision";
import { SessionNotes } from "./SessionNotes";
import { panelForSlug, slugForPanel, TOOL_PARAM } from "./tools";
import { useStudyTime } from "./useStudyTime";
import { useTranscriptCapture } from "./useTranscriptCapture";
import { useWorkspaceSave } from "./useWorkspaceSave";

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
  events: { onReady: (event: YouTubeReadyEvent) => void; onStateChange: (event: YouTubeStateEvent) => void; onError: (event: { data: number }) => void };
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
  // iframe_api defines window.YT at once as a loading stub; Player arrives with a second script, then the ready callback.
  if (window.YT?.Player) return window.YT;
  return new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
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

function useProgressSync(sessionId: string, resource: StudySessionResource, onComplete: (progress: StudyProgressResponse) => void) {
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
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: resource.resourceId, progressPct, anchor, event, idempotencyKey: `${event}-${event === "checkpoint" ? Math.floor(positionMs / 15_000) : Math.floor(positionMs / 1_000)}` }), keepalive: true });
      if (!response.ok) throw new Error("Progress sync failed");
      if (event === "complete") onComplete((await response.json()) as StudyProgressResponse);
    } catch {
      // Progress is retried on the next checkpoint.
    }
  }, [onComplete, resource.resourceId, sessionId]);
  return { playerRef, sync };
}

function useYouTubeLesson(sessionId: string, resource: StudySessionResource, onComplete: (progress: StudyProgressResponse) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { playerRef, sync } = useProgressSync(sessionId, resource, onComplete);
  const syncRef = useRef(sync);
  const [playerState, setPlayerState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [playing, setPlaying] = useState(false);
  useStudyTime(sessionId, resource.resourceId, playing);
  const [currentMs, setCurrentMs] = useState(resource.lastAnchor?.kind === "video" ? resource.lastAnchor.positionMs : 0);
  syncRef.current = sync;
  // Read when the player is ready, so a refreshed anchor never rebuilds a player that is already playing.
  const resumeRef = useRef(0);
  resumeRef.current = resource.lastAnchor?.kind === "video" ? resource.lastAnchor.positionMs : 0;

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
            const resumeMs = resumeRef.current;
            // A lesson watched to the end (its check still to pass) starts over; resuming there would end it the moment it plays.
            if (resumeMs > 0 && resumeMs < target.getDuration() * 1_000 - 5_000) target.seekTo(resumeMs / 1_000, true);
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
          onError: ({ data }) => {
            // 2 bad id, 100 removed or private, 101/150 embedding off, 153 no referrer; anything else is a playback hiccup.
            if (![2, 100, 101, 150, 153].includes(data)) return;
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
      // Leaving the lesson in the app (no visibility change) still saves where it stopped; sync reads the player before it goes.
      void syncRef.current("pause", true);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [resource.readiness, resource.video?.youtubeId, playerRef]);

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
    const handleLeave = () => void syncRef.current("pause", true);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handleLeave);
    return () => { document.removeEventListener("visibilitychange", handleVisibility); window.removeEventListener("pagehide", handleLeave); };
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

  // Read from the player itself: currentMs only ticks while the video plays.
  const now = () => { const player = playerRef.current; return player ? Math.max(0, Math.round(player.getCurrentTime() * 1_000)) : null; };
  const isPlaying = () => playerRef.current?.getPlayerState() === 1;
  return { containerRef, playerState, currentMs, seek, togglePlay, now, isPlaying, play: () => playerRef.current?.playVideo(), pause: () => playerRef.current?.pauseVideo() };
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The whiteboard: wheel pans, ctrl/cmd + wheel zooms around the cursor, and dragging the background pans.
 * `home` is what the canvas frames on load and on resize; `bounds` is everything on it, for zoom to fit. A `restored` view
 * (where the learner left this session) is shown instead of home until they move the canvas themselves; `onMoved` hears
 * every view they make.
 */
function useCanvas(onBackgroundClick: () => void, onBackgroundDoubleClick: () => void, home: CanvasRect, bounds: CanvasRect, homeMargin: number, restored: CanvasView | null, onMoved: () => void) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [view, setView] = useState<CanvasView>(restored ?? { x: 0, y: 0, zoom: 1 });
  const restoredRef = useRef(restored);
  // Once the learner places the canvas (or comes back to a place they chose), resizing the pane keeps their view.
  const placedRef = useRef(restored !== null);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;
  // The learner's own move: the restored view is done with, and the view is theirs to save.
  const release = useCallback(() => {
    restoredRef.current = null;
    placedRef.current = true;
    onMovedRef.current();
  }, []);
  const placed = useCallback(() => placedRef.current, []);
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
  const frameHome = useCallback(() => {
    if (restoredRef.current) setView(restoredRef.current);
    else frame(homeRef.current, homeMarginRef.current);
  }, [frame]);
  const fit = useCallback(() => { release(); frame(boundsRef.current); }, [frame, release]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    release();
    // The world origin sits at the viewport centre, so the zoom anchor is measured from there.
    const px = clientX === undefined ? 0 : clientX - box.left - box.width / 2;
    const py = clientY === undefined ? 0 : clientY - box.top - box.height / 2;
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const scale = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  }, [release]);

  // Reframe whenever the pane changes size (side panel or sidebar toggles) so nothing spills out, until the learner has
  // placed the canvas themselves; their view is centred on the pane, so it stays put as the pane resizes.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      const box = viewport.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      if (!placedRef.current || restoredRef.current) frameHome();
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
      else {
        release();
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomBy, release]);

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
      if (Math.abs(dx) + Math.abs(dy) > 2 && !drag.moved) {
        drag.moved = true;
        release();
      }
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

  const resetZoom = useCallback(() => { release(); setView((current) => ({ ...current, zoom: 1 })); }, [release]);
  return { viewportRef, view, size, fit, frameHome, zoomBy, resetZoom, release, placed, handlers };
}

type PanelView = StudyTool;
/** Watched this far, a video's mastery check is unlocked (the server's rule in lib/mastery/service.ts). */
const WATCHED_PCT = 95;

const tools = [
  { view: "notes", label: "Notes", Icon: NotebookPen },
  { view: "check", label: "Check", Icon: ListChecks },
  { view: "code", label: "Code", Icon: Code },
  { view: "ai", label: "AI", Icon: Sparkles },
] as const;

/**
 * Ends the session: it leaves Sessions and the sidebar, and the learner goes back to the session they were in before it (or
 * the next-video picker). Progress, notes and conversations stay with the video, so studying it again picks them up.
 */
function EndSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { remove } = useSessions();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "ending" | "error">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", onKey); };
  }, [open]);
  async function end() {
    setState("ending");
    try {
      await remove(sessionId);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      router.push("/app/sessions");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="session-end" ref={rootRef}>
      <button className="session-icon-button" type="button" aria-label="End session" title="End session" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(!open); setState("idle"); }}><CircleStop aria-hidden="true" /></button>
      {open ? (
        <div className="session-end-popover" role="dialog" aria-label="End this session">
          <p><strong>End this session?</strong> It leaves your sessions. If you&apos;ve finished it, it moves to your Library; your progress and notes stay with the video.</p>
          {state === "error" ? <p className="session-end-error" role="alert">The session couldn&apos;t be ended. Try again.</p> : null}
          <div className="session-end-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="is-danger" type="button" disabled={state === "ending"} onClick={() => void end()}>{state === "ending" ? "Ending…" : "End session"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

/** Where the learner left a session's canvas, clamped to what the server accepts. */
function savedCanvas(view: CanvasView, focused: boolean): NonNullable<StudyWorkspace["canvas"]> {
  const bound = (value: number) => Math.round(Math.min(1e6, Math.max(-1e6, value)));
  return { x: bound(view.x), y: bound(view.y), zoom: clampZoom(view.zoom), focused };
}

export function VideoSession({ session, active }: { session: StudySessionView; active: StudySessionResource }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTool = searchParams.get(TOOL_PARAM);
  const workspace = useWorkspaceSave(session.id);
  const [selected, setSelected] = useState(false);
  // A lesson watched to the end whose check is not passed yet reopens where the learner left it: on the check (its results,
  // or the next unanswered question), never by making them watch the video again to get back to it.
  const checkPending = active.type === "video" && active.progress.status !== "completed" && active.progress.progressPct >= WATCHED_PCT;
  // The tool opens from the link the learner followed (the sidebar's parts), else the pending check, else where they left it.
  const [initialPanel] = useState<PanelView | null>(() => {
    const linked = panelForSlug(urlTool);
    if (linked !== undefined) return linked;
    return checkPending ? "check" : session.workspace.panel ?? null;
  });
  const [panel, setPanel] = useState<PanelView | null>(initialPanel);
  // Tools stay mounted once opened, so a chat or check survives switching between them.
  const [opened, setOpened] = useState<PanelView[]>(initialPanel ? [initialPanel] : []);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  // The Code tool shows itself on lessons the transcript says call for coding practice; the sidebar's Code Exercises opens it anywhere.
  const codingProfile = useCodingProfile(session.id, active.resourceId);
  // Luny keeps talking while Notes is hidden; the Notes tool shows she is still on.
  const [lunyOn, setLunyOn] = useState(false);
  // Remounts the check when the video is watched, so it reloads unlocked.
  const [watched, setWatched] = useState(0);
  // A finished lesson moves the session on (the next lesson, or an empty Sessions), so reload it from the server; one with
  // a mastery check still to pass opens the check instead.
  const finished = useCallback((progress: StudyProgressResponse) => {
    if (!progress.masteryRequired) return router.refresh();
    setWatched((value) => value + 1);
    setPanel("check");
    setOpened((current) => (current.includes("check") ? current : [...current, "check"]));
  }, [router]);
  const lesson = useYouTubeLesson(session.id, active, finished);
  useTranscriptCapture(active.resourceId, Boolean(active.video?.youtubeId));
  // The video's study guide is written while the learner watches, so it is waiting when they open Notes; the server writes it once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new video is the trigger.
  useEffect(() => { void fetch(`/api/v1/study-sessions/${session.id}/notes/guide`, { method: "POST" }).catch(() => undefined); }, [session.id, active.resourceId]);
  const lessonCard = useRef<HTMLDivElement>(null);
  const vision = useLessonVision(useCallback(() => lessonCard.current, []));
  const lessonActions = useRef(lesson); lessonActions.current = lesson;
  const lessonState = useCallback(() => ({ positionMs: lessonActions.current.now(), playing: lessonActions.current.isPlaying() }), []);
  // The learner talking over the lesson wants to discuss it; Luny never talks over the video.
  const onTurn = useCallback(() => { if (lessonActions.current.isPlaying()) lessonActions.current.pause(); }, []);
  const applyControl = useCallback((control: LessonControl) => {
    if (control.seekMs !== null) lessonActions.current.seek(control.seekMs);
    if (control.playback === "play") lessonActions.current.play();
    if (control.playback === "pause") lessonActions.current.pause();
  }, []);
  useEffect(() => { if (panel !== "notes") vision.stop(); }, [panel, vision.stop]);
  const course = session.course;
  const layout = useMemo(() => (course ? layoutCourse(course) : null), [course]);
  // A session reopens on the canvas as the learner left it: the view, and whether the current lesson was focused alone.
  const restoredCanvas = session.workspace.canvas ?? null;
  const [focused, setFocusedState] = useState(restoredCanvas?.focused ?? false);
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
  const [initialView] = useState<CanvasView | null>(() => (restoredCanvas ? { x: restoredCanvas.x, y: restoredCanvas.y, zoom: restoredCanvas.zoom } : null));
  // Nothing is saved until the learner moves the canvas, so opening a session never writes to it.
  const canvasMoved = useRef(false);
  const markMoved = useCallback(() => { canvasMoved.current = true; }, []);
  const canvas = useCanvas(() => setSelected(false), () => setFocused(false), home, layout?.bounds ?? card, fillsPane ? FULL_VIEW_MARGIN : 160, initialView, markMoved);
  const { frameHome, size, release, placed } = canvas;
  const setFocused = useCallback((value: boolean) => {
    release();
    setFocusedState(value);
  }, [release]);
  const { view: currentView } = canvas;
  useEffect(() => {
    if (canvasMoved.current) workspace.save({ canvas: savedCanvas(currentView, focused) }, 1_200);
  }, [currentView, focused, workspace.save]);
  useEffect(() => setPaneSize(size), [size]);
  // Focusing or unfocusing the lesson frames it; so does a new pane size while the lesson fills it (it grows with the pane),
  // or while the learner has not placed the canvas themselves.
  const framedFill = useRef(fillsPane);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filling the pane or a new pane size is the trigger; frameHome reads the rectangle it just switched to.
  useEffect(() => {
    const toggled = framedFill.current !== fillsPane;
    framedFill.current = fillsPane;
    if (toggled || fillsPane || !placed()) frameHome();
  }, [fillsPane, focusRect.width, focusRect.height, frameHome, placed]);
  useEffect(() => {
    if (!focused) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFocused(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, setFocused]);
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
  // What the check's results show after this lesson: course progress once it is done, and the lesson Continue opens.
  const masteryNext = {
    course: course ? { completed: completedCount + (lessons.some((item) => item.resourceId === active.resourceId && item.state !== "completed") ? 1 : 0), total: lessons.length } : null,
    nextTitle: lessons.find((item) => item.state !== "completed" && item.resourceId !== active.resourceId)?.title ?? null,
  };
  const collapse = () => setPanel(null);
  const collapseSidebar = useContext(CollapseSidebarContext);

  const showPanel = useCallback((view: PanelView | null) => {
    setPanel(view);
    if (view) setOpened((current) => (current.includes(view) ? current : [...current, view]));
  }, []);

  // Practice covers the lesson, so the lesson waits for it.
  useEffect(() => { if (panel === "code" && lessonActions.current.isPlaying()) lessonActions.current.pause(); }, [panel]);

  function openPanel(view: PanelView, focusId?: string) {
    collapseSidebar();
    // Notes split the screen with the lesson, which fills its half so there is one thing to look at while talking. Luny
    // sees the lesson through this tab; the browser asks once, and it has to be asked inside this click.
    if (view === "notes") { setFocused(true); if (!vision.sharing) void vision.start(); }
    showPanel(view);
    if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }

  // A part picked in the sidebar while this session is open switches the tool in place: the lesson keeps playing.
  useEffect(() => {
    const linked = panelForSlug(urlTool);
    if (linked === undefined || linked === panelRef.current) return;
    if (linked === "notes") setFocusedState(true);
    showPanel(linked);
  }, [urlTool, showPanel]);
  // The open tool is in the address (so a reload or a shared link reopens it) and saved with the session (so coming back
  // from anywhere does). The first render is where the session already is, so it writes nothing.
  const firstPanel = useRef(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    const slug = slugForPanel(panel);
    if ((url.searchParams.get(TOOL_PARAM) ?? "canvas") !== slug) {
      if (slug === "canvas") url.searchParams.delete(TOOL_PARAM);
      else url.searchParams.set(TOOL_PARAM, slug);
      window.history.replaceState(null, "", url);
    }
    if (firstPanel.current) {
      firstPanel.current = false;
      if (panel === (session.workspace.panel ?? null)) return;
    }
    workspace.save({ panel }, 400);
  }, [panel, session.workspace.panel, workspace.save]);

  const player = <>
    <div className="study-player" ref={lesson.containerRef} />
    {selected && !boardPreview ? null : <button className="session-card-select" type="button" aria-label={boardPreview ? `Play or pause lesson ${lessonNumber}: ${active.title}. Double-click to focus it` : `Select ${active.title}`} title={boardPreview ? "Click to play or pause, double-click to focus" : undefined} onClick={clickLesson} />}
    {lesson.playerState === "loading" ? <div className="study-player-state">Loading the lesson player…</div> : null}
    {lesson.playerState === "unavailable" ? <div className="study-player-state"><strong>This video can&apos;t be played inside LearnSpace.</strong><span>Your StudySession is still available. Open the source to continue on YouTube.</span>{active.canonicalUrl ? <a href={active.canonicalUrl} target="_blank" rel="noreferrer">Open on YouTube</a> : null}</div> : null}
  </>;
  const { view } = canvas;
  const panelView = (target: PanelView) => (opened.includes(target) ? { hidden: panel !== target } : null);
  const notesPanel = panelView("notes");
  const checkPanel = panelView("check");
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
              {tools.filter(({ view: tool }) => tool !== "code" || codingProfile?.recommended || panel === "code").map(({ view: tool, label, Icon }) => <button key={tool} className={`${panel === tool ? "is-active" : ""}${tool === "notes" && lunyOn && panel !== "notes" ? " is-live" : ""}`} type="button" aria-pressed={panel === tool} title={tool === "notes" && lunyOn && panel !== "notes" ? "Notes · Luny is listening" : label} onClick={() => (panel === tool ? collapse() : openPanel(tool, tool === "ai" ? "study-question" : undefined))}><Icon aria-hidden="true" /><span>{label}</span></button>)}
            </fieldset>
            {course ? <span className="session-course-count" title="Lessons completed">{completedCount}/{lessons.length} done</span> : null}
            <button className="session-icon-button" type="button" aria-pressed={fullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Shrink aria-hidden="true" /> : <Expand aria-hidden="true" />}</button>
            {/* A finished session lives in the Library; there is nothing to end. */}
            {session.status === "completed" ? null : <EndSession sessionId={session.id} />}
          </div>
        </header>
        <div className="session-canvas" ref={canvas.viewportRef} data-lenis-prevent {...canvas.handlers} style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `calc(50% + ${view.x}px) calc(50% + ${view.y}px)` }}>
          <div className="session-canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {course ? <CourseGraph course={course} focusRect={fillsPane ? focusRect : null} player={<div ref={lessonCard} className={`session-card${selected ? " is-selected" : ""}`} style={{ inset: 0 }}>{player}</div>} /> : (
              <div ref={lessonCard} className={`session-card${selected ? " is-selected" : ""}`} style={{ width: card.width, height: card.height, left: card.x, top: card.y }}>{player}</div>
            )}
          </div>
          <div className="session-zoom" role="toolbar" aria-label="Zoom">
            {course && !fullscreen ? focused
              ? <button type="button" aria-label="Show the whole course" title="Whole course" onClick={() => setFocused(false)}><Workflow aria-hidden="true" /></button>
              : <button type="button" aria-label="Focus the current lesson" title="Current lesson" onClick={() => setFocused(true)}><Crosshair aria-hidden="true" /></button> : null}
            <button type="button" aria-label="Zoom to fit" title="Zoom to fit" onClick={canvas.fit}><Maximize aria-hidden="true" /></button>
            <button className="session-zoom-value" type="button" aria-label="Reset zoom to 100%" title="Reset zoom" onClick={canvas.resetZoom}>{Math.round(view.zoom * 100)}%</button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => canvas.zoomBy(1.2)}><Plus aria-hidden="true" /></button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => canvas.zoomBy(1 / 1.2)}><Minus aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      {/* Practice covers the session in LeetCode's layout; the lesson stays mounted, paused, underneath. */}
      {codePanel ? <div className="coding-overlay" hidden={codePanel.hidden}><CodingWorkspace key={active.resourceId} sessionId={session.id} onSeek={lesson.seek} onClose={collapse} /></div> : null}
      <aside className="session-panel" aria-label="Side panel" data-view={panel ?? undefined} hidden={!panel || panel === "code"} onPointerDown={collapseSidebar}>
        {panel === "ai" || panel === "notes" ? <PanelResizer key={panel} label={panel === "ai" ? "Resize chat" : "Resize notes"} storageKey={`learnspace:${panel === "ai" ? "chat" : "notes"}-width`} /> : null}
        {notesPanel ? <div className="session-tool-slot" {...notesPanel}><SessionNotes key={active.resourceId} sessionId={session.id} title={active.title} active={panel === "notes"} tutor={{ lesson: lessonState, capture: vision.capture, onControl: applyControl, onTurn, onSeek: lesson.seek, sharing: vision.sharing, shareError: vision.error, onShare: () => { setFocused(true); void vision.start(); }, onVoice: setLunyOn }} onCollapse={collapse} /></div> : null}
        {checkPanel ? <div className="session-tool-slot" {...checkPanel}><MasteryCheck key={`${active.resourceId}-${watched}`} sessionId={session.id} resourceId={active.resourceId} next={masteryNext} onSeek={lesson.seek} onCollapse={collapse} /></div> : null}
        {aiPanel ? <div className="session-tool-slot" {...aiPanel}><SessionChat key={active.resourceId} sessionId={session.id} resource={active} currentMs={lesson.currentMs} code={null} onSeek={lesson.seek} onCollapse={collapse} /></div> : null}
      </aside>
    </main>
  );
}

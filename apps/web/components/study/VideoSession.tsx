"use client";

import type { LessonControl } from "@learnspace/shared/notes";
import type { StudyAnchor, StudyProgressRequest, StudyProgressResponse, StudySessionResource, StudySessionView, StudyTool, StudyWorkspace } from "@learnspace/shared";
import { Code, Crosshair, Expand, ListChecks, NotebookPen, Shrink, Sparkles, Video, Workflow } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CollapseSidebarContext } from "../application/ApplicationShell";
import { type CanvasView, EndSession, savedCanvas, useCanvas, ZoomBar } from "./canvas";
import { type CanvasRect, CourseGraph, layoutCourse } from "./CourseGraph";
import { PanelResizer } from "./PanelResizer";
import { SessionChat } from "./SessionChat";
import { useCodingEligibility } from "../coding/useCodingEligibility";
import { LoadingState } from "./LoadingState";
import { useLessonVision } from "./useLessonVision";
import { panelForSlug, slugForPanel, TOOL_PARAM } from "./tools";
import { useStudyTime } from "./useStudyTime";
import { useTranscriptCapture } from "./useTranscriptCapture";
import { useWorkspaceSave } from "./useWorkspaceSave";

// Tools load when first opened, so the lesson (and links that prefetch it) don't carry the editor, checks and coding workspace up front. Chat stays eager: its opener focuses the input on the next frame.
const toolLoading = () => <LoadingState label="Opening study tool" />;
const CodingWorkspace = dynamic(() => import("../coding/CodingWorkspace").then((module) => module.CodingWorkspace), { loading: toolLoading });
const MasteryCheck = dynamic(() => import("./MasteryCheck").then((module) => module.MasteryCheck), { loading: toolLoading });
const SessionNotes = dynamic(() => import("./SessionNotes").then((module) => module.SessionNotes), { loading: toolLoading });

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

const CARD_WIDTH = 960;
const CARD_HEIGHT = 540;

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

type PanelView = StudyTool;
/** Watched this far, a video's mastery check is unlocked (the server's rule in lib/mastery/service.ts). */
const WATCHED_PCT = 95;

const tools = [
  { view: "notes", label: "Notes", Icon: NotebookPen },
  { view: "check", label: "Check", Icon: ListChecks },
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
    // A video has no project guide; a link to one opens the canvas.
    if (linked !== undefined) return linked === "guide" ? null : linked;
    return checkPending ? "check" : session.workspace.panel ?? null;
  });
  const [panel, setPanel] = useState<PanelView | null>(initialPanel);
  // Tools stay mounted once opened, so a chat or check survives switching between them.
  const [opened, setOpened] = useState<PanelView[]>(initialPanel ? [initialPanel] : []);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  // The server's coding capability controls both the tool rail and the exercise overlay.
  const codingEligible = useCodingEligibility(session.id, active.resourceId);
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
    if (control.seekMs !== null && control.seekMs !== undefined) lessonActions.current.seek(control.seekMs);
    if (control.playback === "play") lessonActions.current.play();
    if (control.playback === "pause") lessonActions.current.pause();
  }, []);
  const go = useCallback((place: StudyAnchor) => { if (place.kind === "video") lessonActions.current.seek(place.positionMs); }, []);
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

  useEffect(() => {
    if (panel === "code" && codingEligible === false) collapse();
  }, [panel, codingEligible]);

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
              {tools.filter(({ view: tool }) => tool !== "code" || codingEligible === true).map(({ view: tool, label, Icon }) => <button key={tool} className={`${panel === tool ? "is-active" : ""}${tool === "notes" && lunyOn && panel !== "notes" ? " is-live" : ""}`} type="button" aria-pressed={panel === tool} title={tool === "notes" && lunyOn && panel !== "notes" ? "Notes · Luny is listening" : label} onClick={() => (panel === tool ? collapse() : openPanel(tool, tool === "ai" ? "study-question" : undefined))}><Icon aria-hidden="true" /><span>{label}</span></button>)}
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
          <ZoomBar canvas={canvas}>
            {course && !fullscreen ? focused
              ? <button type="button" aria-label="Show the whole course" title="Whole course" onClick={() => setFocused(false)}><Workflow aria-hidden="true" /></button>
              : <button type="button" aria-label="Focus the current lesson" title="Current lesson" onClick={() => setFocused(true)}><Crosshair aria-hidden="true" /></button> : null}
          </ZoomBar>
        </div>
      </div>
      {/* Practice covers the session in LeetCode's layout; the lesson stays mounted, paused, underneath. */}
      {codePanel && codingEligible ? <div className="coding-overlay" hidden={codePanel.hidden}><CodingWorkspace key={active.resourceId} sessionId={session.id} onSeek={lesson.seek} onClose={collapse} /></div> : null}
      <aside className="session-panel" aria-label="Side panel" data-view={panel ?? undefined} hidden={!panel || panel === "code"} onPointerDown={collapseSidebar}>
        {panel === "ai" || panel === "notes" ? <PanelResizer key={panel} label={panel === "ai" ? "Resize chat" : "Resize notes"} storageKey={`learnspace:${panel === "ai" ? "chat" : "notes"}-width`} /> : null}
        {notesPanel ? <div className="session-tool-slot" {...notesPanel}><SessionNotes key={active.resourceId} sessionId={session.id} title={active.title} active={panel === "notes"} tutor={{ lesson: lessonState, capture: vision.capture, onControl: applyControl, onTurn, onGo: go, sharing: vision.sharing, shareError: vision.error, onShare: () => { setFocused(true); void vision.start(); }, onVoice: setLunyOn }} onCollapse={collapse} /></div> : null}
        {checkPanel ? <div className="session-tool-slot" {...checkPanel}><MasteryCheck key={`${active.resourceId}-${watched}`} sessionId={session.id} resourceId={active.resourceId} next={masteryNext} place={{ kind: "video", positionMs: 0 }} onGo={go} onCollapse={collapse} /></div> : null}
        {aiPanel ? <div className="session-tool-slot" {...aiPanel}><SessionChat key={active.resourceId} sessionId={session.id} resource={active} place={{ kind: "video", positionMs: lesson.currentMs }} code={null} onGo={go} onCollapse={collapse} /></div> : null}
      </aside>
    </main>
  );
}

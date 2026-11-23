"use client";

import { StudyFolderAction, StudyFolderBreadcrumb } from "../folders/StudyFolderAction";
import type { StudyAnchor, StudySessionResource, StudySessionView } from "@learnspace/shared";
import type { LessonControl } from "@learnspace/shared/notes";
import { BookOpenText, Code, Crosshair, Expand, FileText, Lightbulb, ListChecks, NotebookPen, Shrink, Sparkles, Workflow } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CollapseSidebarContext } from "../application/ApplicationShell";
import { useCodingEligibility } from "../coding/useCodingEligibility";
import { EndSession, useCanvas, ZoomBar } from "../study/canvas";
import { type CanvasRect, type CourseCard, CourseGraph, layoutCourse } from "../study/CourseGraph";
import { LoadingState } from "../study/LoadingState";
import { SessionChat } from "../study/SessionChat";
import { PanelResizer } from "../study/PanelResizer";
import { panelForSlug, slugForPanel, TOOL_PARAM } from "../study/tools";
import { useStudyTime } from "../study/useStudyTime";
import { useWorkspaceSave } from "../study/useWorkspaceSave";
import { PaperFocus, type PaperFocusHandle } from "./PaperFocus";
import type { PaperReference } from "../../lib/research/paper-content";
import { PaperReader, type PaperReaderHandle, type PaperSelection } from "./PaperReader";
import { usePaperContent } from "./usePaperContent";

const toolLoading = () => <LoadingState label="Opening study tool" />;
const CodingWorkspace = dynamic(() => import("../coding/CodingWorkspace").then((module) => module.CodingWorkspace), { loading: toolLoading });
const MasteryCheck = dynamic(() => import("../study/MasteryCheck").then((module) => module.MasteryCheck), { loading: toolLoading });
const SessionNotes = dynamic(() => import("../study/SessionNotes").then((module) => module.SessionNotes), { loading: toolLoading });
const PaperGuide = dynamic(() => import("./PaperGuide").then((module) => module.PaperGuide), { loading: toolLoading });

type PanelView = NonNullable<StudySessionView["workspace"]["panel"]>;

const tools = [
  { view: "notes", label: "Notes", Icon: NotebookPen },
  { view: "check", label: "Check", Icon: ListChecks },
  { view: "code", label: "Code", Icon: Code },
  { view: "guide", label: "Guide", Icon: Lightbulb },
  { view: "ai", label: "AI", Icon: Sparkles },
] as const;

const PANE_MARGIN = 32;
// Room under the paper for the zoom toolbar in the bottom corner.
const ZOOM_BAR_SPACE = 40;
// A paper set's board shows each paper as a US-letter page.
const PAPER_CARD: CourseCard = { width: 640, mediaHeight: 828 };
const FALLBACK_CARD: CanvasRect = { x: -480, y: -560, width: 960, height: 1120 };
// A page has to stay in view this long before it counts as read, so paging through quickly is not "reading".
const PAGE_DWELL_MS = 4_000;

/** The paper fills the pane: the reader has its own zoom, so the canvas never scales the PDF's pixels. */
function paperCard(pane: { width: number; height: number }): CanvasRect {
  if (!pane.width || !pane.height) return FALLBACK_CARD;
  const width = Math.max(320, pane.width - PANE_MARGIN);
  const height = Math.max(360, pane.height - PANE_MARGIN - ZOOM_BAR_SPACE);
  return { x: -width / 2, y: -height / 2, width, height };
}

/** Saves the reading position (page, section) as the learner moves through the paper; progress only ever grows. */
function useReadingProgress(sessionId: string, resource: StudySessionResource) {
  const best = useRef(resource.progress.progressPct);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback((anchor: Extract<StudyAnchor, { kind: "paper" }>, pageCount: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const page = anchor.page ?? 1;
      const reached = pageCount > 0 ? Math.min(100, (page / pageCount) * 100) : 0;
      best.current = Math.max(best.current, reached);
      const complete = best.current >= 100;
      void fetch(`/api/v1/study-sessions/${sessionId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: resource.resourceId, progressPct: best.current, anchor, event: complete ? "complete" : "checkpoint", idempotencyKey: `paper-${complete ? "complete" : "page"}-${page}-${Math.round(best.current)}` }),
        keepalive: true,
      }).catch(() => undefined);
    }, PAGE_DWELL_MS);
  }, [sessionId, resource.resourceId]);
}

export function PaperSession({ session, active }: { session: StudySessionView; active: StudySessionResource }) {
  const searchParams = useSearchParams();
  const urlTool = searchParams.get(TOOL_PARAM);
  const workspace = useWorkspaceSave(session.id);
  const collapseSidebar = useContext(CollapseSidebarContext);
  const paper = usePaperContent(active.resourceId);
  const blocksRef = useRef(paper.content?.blocks);
  blocksRef.current = paper.content?.blocks;
  const readerRef = useRef<PaperReaderHandle>(null);
  const focusRef = useRef<PaperFocusHandle>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  useStudyTime(session.id, active.resourceId, readerReady && active.readiness !== "unavailable", true);
  const saveProgress = useReadingProgress(session.id, active);
  const initialAnchor = active.progress.lastAnchor?.kind === "paper" ? active.progress.lastAnchor : active.lastAnchor?.kind === "paper" ? active.lastAnchor : null;
  const [page, setPage] = useState(initialAnchor?.page ?? 1);
  const sectionAt = useCallback((at: number) => [...paper.sections].reverse().find((section) => section.page <= at)?.id, [paper.sections]);
  const place = useMemo(() => {
    const sectionId = sectionAt(page);
    return sectionId ? { kind: "paper" as const, page, sectionId } : { kind: "paper" as const, page };
  }, [page, sectionAt]);
  const placeRef = useRef(place);
  placeRef.current = place;
  // The study guide is written as the paper opens, so it is waiting when the learner opens Notes; the server writes it once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new paper is the trigger.
  useEffect(() => { void fetch(`/api/v1/study-sessions/${session.id}/notes/guide`, { method: "POST" }).catch(() => undefined); }, [session.id, active.resourceId]);
  /** Opens a cited place: in Focus mode when it is open, otherwise in the PDF. */
  const go = useCallback((target: StudyAnchor) => {
    if (target.kind !== "paper") return;
    const at = { page: target.page ?? null, sectionId: target.sectionId ?? null, chunkId: target.chunkId ?? null };
    if (focusRef.current) focusRef.current.goTo(at);
    else readerRef.current?.goTo({ ...at, bbox: target.chunkId ? blocksRef.current?.find((block) => block.id === target.chunkId)?.bbox ?? null : null });
  }, []);
  // The reference list is typeset only in Focus mode, so opening a reference opens it there once it has mounted.
  const pendingReference = useRef<number | null>(null);
  const applyControl = useCallback((control: LessonControl) => {
    if (control.reference !== undefined) {
      if (focusRef.current) focusRef.current.goTo({ reference: control.reference });
      else { pendingReference.current = control.reference; setFocusMode(true); }
    } else if (control.page !== undefined || control.sectionId !== undefined || control.chunkId !== undefined) go({ kind: "paper", page: control.page, sectionId: control.sectionId, chunkId: control.chunkId });
  }, [go]);
  useEffect(() => {
    const reference = pendingReference.current;
    if (!focusMode || reference === null) return;
    pendingReference.current = null;
    const frame = window.requestAnimationFrame(() => focusRef.current?.goTo({ reference }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusMode]);
  // Luny hears where the learner is reading and whatever passage they have selected as they speak.
  const lessonState = useCallback(() => ({ positionMs: null, playing: false, paper: { anchor: placeRef.current, selection: window.getSelection()?.toString().trim().slice(0, 4_000) || null } }), []);
  const [seed, setSeed] = useState<{ text: string; at: number } | null>(null);
  const onPageChange = useCallback((next: number, pageCount: number) => {
    setReaderReady(true);
    setPage(next);
    const sectionId = sectionAt(next);
    saveProgress(sectionId ? { kind: "paper", page: next, sectionId } : { kind: "paper", page: next }, pageCount);
  }, [saveProgress, sectionAt]);

  const [initialPanel] = useState<PanelView | null>(() => panelForSlug(urlTool) ?? session.workspace.panel ?? null);
  const [panel, setPanel] = useState<PanelView | null>(initialPanel);
  const [opened, setOpened] = useState<PanelView[]>(initialPanel ? [initialPanel] : []);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const [lunyOn, setLunyOn] = useState(false);
  const codingEligible = useCodingEligibility(session.id, active.resourceId);
  const showPanel = useCallback((view: PanelView | null) => {
    setPanel(view);
    if (view) setOpened((current) => (current.includes(view) ? current : [...current, view]));
  }, []);
  const collapse = useCallback(() => setPanel(null), []);
  function openPanel(view: PanelView, focusId?: string) {
    collapseSidebar();
    showPanel(view);
    if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }
  useEffect(() => { if (panel === "code" && codingEligible === false) collapse(); }, [panel, codingEligible, collapse]);
  useEffect(() => {
    const linked = panelForSlug(urlTool);
    if (linked !== undefined && linked !== panelRef.current) showPanel(linked);
  }, [urlTool, showPanel]);
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

  function askAbout(text: string) {
    setSeed({ text, at: Date.now() });
    openPanel("ai", "study-question");
  }
  const ask = (selection: PaperSelection) => askAbout(`Explain this passage from page ${selection.page}: “${selection.text.slice(0, 700)}”`);
  const askReference = (reference: PaperReference) => askAbout(`What does reference [${reference.ordinal}]${reference.title ? `, “${reference.title}”,` : ""} contribute to this paper, and is it worth reading next?`);

  const sessionRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === sessionRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // A paper set is a board of its papers; it opens on the current paper, filling the pane, since that is what is read.
  const course = session.course;
  const layout = useMemo(() => (course ? layoutCourse(course, PAPER_CARD) : null), [course]);
  const [onBoard, setOnBoard] = useState(false);
  const fillsPane = !layout || !onBoard;
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const card = paperCard(paneSize);
  const home = fillsPane || !layout ? { ...card, height: card.height + ZOOM_BAR_SPACE } : layout.bounds;
  // The reader keeps its own page and zoom, so the board always opens framed on the paper rather than where it was left.
  const canvas = useCanvas(() => undefined, () => setOnBoard(false), home, layout?.bounds ?? card, fillsPane ? PANE_MARGIN : 160, null, () => undefined);
  const { view, size, frameHome } = canvas;
  useEffect(() => setPaneSize(size), [size]);
  // The paper grows with the pane, so a new pane size reframes it; so does moving between the paper and the board.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new card size or view is the trigger.
  useEffect(() => { frameHome(); }, [card.width, card.height, fillsPane, frameHome]);
  const papers = course?.sections.flatMap((section) => section.lessons) ?? [];
  const doneCount = papers.filter((item) => item.state === "completed").length;
  const reader = <PaperReader ref={readerRef} resourceId={active.resourceId} title={active.title} initialPage={initialAnchor?.page ?? 1} sections={paper.sections} onPageChange={onPageChange} onAsk={ask} />;

  const panelView = (target: PanelView) => (opened.includes(target) ? { hidden: panel !== target } : null);
  const notesPanel = panelView("notes");
  const checkPanel = panelView("check");
  const codePanel = panelView("code");
  const aiPanel = panelView("ai");
  const guidePanel = panelView("guide");
  return (
    <main ref={sessionRef} className={`video-session paper-session${panel ? " is-panel-open" : ""}`}>
      <div className="session-pane">
        <header className="session-topbar">
          <nav className="session-crumbs" aria-label="Breadcrumb">
            <StudyFolderBreadcrumb><Link href="/app/research" aria-label="Back to Research" title="Research"><FileText aria-hidden="true" /></Link></StudyFolderBreadcrumb>
            <span aria-hidden="true">/</span>
            {session.course ? <><span className="session-crumb-course" title={session.course.title}>{session.course.title}</span><span aria-hidden="true">/</span></> : null}
            <h1 title={active.title}>{active.title}</h1>
          </nav>
          <div className="session-actions">
            <fieldset className="session-tools">
              <legend className="sr-only">Study tools</legend>
              {tools.filter(({ view: tool }) => tool !== "code" || codingEligible === true).map(({ view: tool, label, Icon }) => <button key={tool} className={`${panel === tool ? "is-active" : ""}${tool === "notes" && lunyOn && panel !== "notes" ? " is-live" : ""}`} type="button" aria-pressed={panel === tool} title={tool === "notes" && lunyOn && panel !== "notes" ? "Notes · Luny is listening" : label} onClick={() => (panel === tool ? collapse() : openPanel(tool, tool === "ai" ? "study-question" : undefined))}><Icon aria-hidden="true" /><span>{label}</span></button>)}
            </fieldset>
            <StudyFolderAction session={session} />
            {course ? <span className="session-course-count" title="Papers read">{doneCount}/{papers.length} read</span> : null}
            <button className="session-icon-button" type="button" aria-pressed={focusMode} aria-label="Focus mode" title="Focus mode: the paper re-typeset for reading" onClick={() => setFocusMode(true)}><BookOpenText aria-hidden="true" /></button>
            <button className="session-icon-button" type="button" aria-pressed={fullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void sessionRef.current?.requestFullscreen())}>{fullscreen ? <Shrink aria-hidden="true" /> : <Expand aria-hidden="true" />}</button>
            {session.status === "completed" ? null : <EndSession sessionId={session.id} mode="research" />}
          </div>
        </header>
        <div className="session-canvas" ref={canvas.viewportRef} data-lenis-prevent {...canvas.handlers} style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `calc(50% + ${view.x}px) calc(50% + ${view.y}px)` }}>
          <div className="session-canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {course ? <CourseGraph course={course} card={PAPER_CARD} focusRect={fillsPane ? card : null} player={<div className="session-card paper-session-card" style={{ inset: 0 }}>{reader}</div>} /> : (
              <div className="session-card paper-session-card" style={{ width: card.width, height: card.height, left: card.x, top: card.y }}>{reader}</div>
            )}
          </div>
          <ZoomBar canvas={canvas}>
            {course ? onBoard
              ? <button type="button" aria-label="Read the current paper" title="Current paper" onClick={() => setOnBoard(false)}><Crosshair aria-hidden="true" /></button>
              : <button type="button" aria-label="Show every paper in the set" title="Whole set" onClick={() => setOnBoard(true)}><Workflow aria-hidden="true" /></button> : null}
          </ZoomBar>
        </div>
      </div>
      {focusMode ? <PaperFocus ref={focusRef} content={paper.content} failed={paper.failed} onClose={() => setFocusMode(false)} onAsk={ask} onAskReference={askReference} /> : null}
      {codePanel && codingEligible ? <div className="coding-overlay" hidden={codePanel.hidden}><CodingWorkspace key={active.resourceId} sessionId={session.id} onSeek={() => undefined} onClose={collapse} /></div> : null}
      <aside className="session-panel" aria-label="Side panel" data-view={panel ?? undefined} hidden={!panel || panel === "code"} onPointerDown={collapseSidebar}>
        {panel === "ai" || panel === "notes" ? <PanelResizer key={panel} label={panel === "ai" ? "Resize chat" : "Resize notes"} storageKey={`learnspace:${panel === "ai" ? "chat" : "notes"}-width`} /> : null}
        {notesPanel ? <div className="session-tool-slot" {...notesPanel}><SessionNotes key={active.resourceId} sessionId={session.id} title={active.title} material="paper" active={panel === "notes"} tutor={{ lesson: lessonState, capture: () => null, onControl: applyControl, onTurn: () => undefined, onGo: go, sharing: false, shareError: null, onShare: () => undefined, onVoice: setLunyOn }} onCollapse={collapse} /></div> : null}
        {checkPanel ? <div className="session-tool-slot" {...checkPanel}><MasteryCheck key={active.resourceId} sessionId={session.id} resourceId={active.resourceId} next={{ course: course ? { completed: doneCount + (papers.some((item) => item.resourceId === active.resourceId && item.state !== "completed") ? 1 : 0), total: papers.length } : null, nextTitle: papers.find((item) => item.state !== "completed" && item.resourceId !== active.resourceId)?.title ?? null }} place={place} onGo={go} onCollapse={collapse} /></div> : null}
        {guidePanel ? <div className="session-tool-slot" {...guidePanel}><PaperGuide key={active.resourceId} sessionId={session.id} onGo={go} onCollapse={collapse} /></div> : null}
        {aiPanel ? <div className="session-tool-slot" {...aiPanel}><SessionChat key={active.resourceId} sessionId={session.id} resource={active} place={place} seed={seed} code={null} onGo={go} onCollapse={collapse} /></div> : null}
      </aside>
      <span className="sr-only" aria-live="polite">Page {page}</span>
    </main>
  );
}

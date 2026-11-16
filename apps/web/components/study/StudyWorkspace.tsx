"use client";

import Link from "next/link";
import type { StudyAnchor, StudySessionResource, StudySessionView } from "@learnspace/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatClock } from "../../lib/tutor/scope";
import { useStudyTime } from "./useStudyTime";
import { PaperReader as PaperView } from "../research/PaperReader";

type StudyKind = "video" | "paper";

function routeFromResponse(value: unknown): string {
  if (!value || typeof value !== "object" || !("route" in value) || typeof value.route !== "string") throw new Error("Study route missing");
  return value.route;
}

export async function openMaterialRoute(sessionId: string, resourceId: string, role?: "related"): Promise<string> {
  const response = await fetch(`/api/v1/study-sessions/${sessionId}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, ...(role ? { role } : {}), idempotencyKey: crypto.randomUUID() }) });
  if (!response.ok) throw new Error("Material navigation failed");
  return routeFromResponse(await response.json());
}

// One clock for the whole session, so a citation in a 25-hour course reads 8:40:14, not 520:14.
export const formatTime = formatClock;

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

function PaperReader({ sessionId, resource, onProgress }: { sessionId: string; resource: StudySessionResource; onProgress: (value: number) => void }) {
  const initialAnchor = resource.progress.lastAnchor?.kind === "paper" ? resource.progress.lastAnchor : resource.lastAnchor?.kind === "paper" ? resource.lastAnchor : null;
  const [page, setPage] = useState(initialAnchor?.page ?? 1);
  const [sectionId, setSectionId] = useState(initialAnchor?.sectionId ?? "");
  const [progress, setProgress] = useState(resource.progress.progressPct);
  const [message, setMessage] = useState("");
  const [sourceLoaded, setSourceLoaded] = useState(false);
  useStudyTime(sessionId, resource.resourceId, sourceLoaded && resource.readiness !== "unavailable", true);
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
  return <div className="paper-reader-stack"><div className="paper-reader-frame"><PaperView resourceId={resource.resourceId} title={resource.title} initialPage={initialAnchor?.page ?? 1} sections={[]} onPageChange={(next) => { setPage(next); setSourceLoaded(true); }} /></div><section className="paper-progress-control" aria-labelledby="reading-position-title"><div><p className="study-label">Your place</p><h2 id="reading-position-title">Reading position</h2><p>Save a page or parsed section when you move through the paper.</p></div><div className="paper-progress-fields"><label>Page<input type="number" min="1" value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))} /></label>{sections.length > 0 ? <label>Section<select value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Choose a section</option>{sections.map((section) => <option key={section} value={section}>{section}</option>)}</select></label> : null}</div><label className="paper-progress-range">Progress <input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(Number(event.target.value))} /><output>{Math.round(progress)}%</output></label><div className="paper-progress-actions"><button type="button" onClick={() => void save()}>Save position</button><button className="quiet-button" type="button" onClick={() => void save(100, true)}>Mark paper complete</button></div><span className="study-inline-message" aria-live="polite">{message}</span></section></div>;
}

export function SessionMaterials({ session }: { session: StudySessionView }) {
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

export function StudyRail({ session, kind, onRelated }: { session: StudySessionView; kind: StudyKind; onRelated: (resource: StudySessionResource) => void }) {
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
  return <aside className="study-rail">{kind === "paper" ? <><section className="study-rail-panel ask-panel"><p className="study-label">Contextual help</p><h2>Ask this paper</h2><p>Questions will be grounded in this paper when parsed text is ready.</p><form onSubmit={(event) => void ask(event)}><label className="sr-only" htmlFor="study-question">Ask a question</label><textarea id="study-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I understand here?" rows={3} /><button type="submit">Ask</button></form>{message ? <p className="study-inline-message" aria-live="polite">{message}</p> : null}</section><section className="study-rail-panel"><p className="study-label">Keep your thread</p><h2>Notes</h2><p className="muted-copy">No notes in this session yet.</p></section></> : null}<section className="study-rail-panel"><p className="study-label">Concept context</p><h2>Concepts</h2>{active && active.concepts.length > 0 ? <ul className="concept-list">{active.concepts.slice(0, 8).map((concept) => <li key={concept.id}><span>{concept.name}</span>{concept.isPrimary ? <small>Primary</small> : null}</li>)}</ul> : <p className="muted-copy">Concept mappings will appear when the catalogue has them.</p>}</section><section className="study-rail-panel related-panel"><p className="study-label">{kind === "video" ? "Go deeper" : "Need another explanation?"}</p><h2>{kind === "video" ? "A paper for the next pass" : "A visual explanation"}</h2>{session.related.length > 0 ? session.related.slice(0, 2).map((resource) => <button className="related-resource" type="button" key={resource.resourceId} onClick={() => onRelated(resource)}><span className="related-context">{contextLabel}</span><strong>{resource.title}</strong><small>{kind === "video" ? "Study paper" : "Watch explanation"}</small></button>) : <p className="muted-copy">Related catalogue material will appear as the library grows.</p>}</section></aside>;
}

function PaperOutline({ resource }: { resource: StudySessionResource }) {
  const headings = [...new Set(resource.chunks.flatMap((chunk) => chunk.headingPath).filter(Boolean))];
  return <aside className="paper-outline"><p className="study-label">Paper map</p><h2>Outline</h2>{headings.length > 0 ? <ol>{headings.map((heading) => <li key={heading}>{heading}</li>)}</ol> : <p className="muted-copy">No parsed section structure is available yet.</p>}</aside>;
}

export function StudyWorkspace({ session }: { session: StudySessionView }) {
  const active = session.activeResource;
  const [progress, setProgress] = useState(active?.progress.progressPct ?? 0);
  const [navigationError, setNavigationError] = useState("");
  const router = useRouter();
  if (!active) return <main className="study-page"><div className="study-error-state"><h1>This study session has no active material.</h1><Link href="/app">Back to Home</Link></div></main>;
  const sourceResource = active.introducedFrom ? session.resources.find((resource) => resource.resourceId === active.introducedFrom?.resourceId) ?? null : null;
  async function openMaterial(resourceId: string, role?: "related") {
    setNavigationError("");
    try {
      router.push(await openMaterialRoute(session.id, resourceId, role));
    } catch {
      setNavigationError("This material could not be opened right now.");
    }
  }
  return <main className="study-page study-page-paper"><header className="study-topbar"><Link className="study-back-link" href="/app">Back to Home</Link><span className="study-session-state">{session.status} session</span><SessionMaterials session={session} /></header><section className="study-hero"><div><p className="study-label">Paper Study</p><h1>{active.title}</h1><p className="study-hero-description">{active.description ?? "A focused LearnSpace learning context."}</p><div className="study-hero-meta">{active.paper?.authors.length ? <span>{active.paper.authors.slice(0, 3).join(", ")}</span> : null}{active.paper?.venue ? <span>{active.paper.venue}</span> : null}{active.paper?.publicationDate ? <span>{active.paper.publicationDate}</span> : null}<span>{active.readiness === "ready" ? "Learning material ready" : active.readiness === "preparing" ? "Learning context preparing" : "Material unavailable"}</span></div></div><div className="study-hero-progress"><span>{Math.round(progress)}%</span><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div><small>{active.progress.completedAt ? `Completed ${formatDate(active.progress.completedAt)}` : active.progress.lastAnchor ? "Resuming your place" : "Not started"}</small></div></section>{active.introducedFrom ? <section className="study-return-context" aria-label="Study context"><div><p className="study-label">Context</p><p>{provenanceLabel(active.introducedFrom)}</p></div>{sourceResource ? <button type="button" onClick={() => void openMaterial(sourceResource.resourceId)}>← Return to {sourceResource.type === "paper" ? "paper" : "video"}</button> : <span className="muted-copy">The source material is no longer available.</span>}</section> : null}{navigationError ? <p className="study-navigation-error" role="alert">{navigationError}</p> : null}<div className="study-layout study-layout-paper"><PaperOutline resource={active} /><section className="study-main-column"><PaperReader sessionId={session.id} resource={active} onProgress={setProgress} /></section><StudyRail session={session} kind="paper" onRelated={(resource) => void openMaterial(resource.resourceId, "related")} /></div></main>;
}

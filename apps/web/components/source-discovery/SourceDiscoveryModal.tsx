"use client";

import type { SourceDiscoveryCandidate, SourceDiscoveryMode, SourceDiscoverySearchResponse, SourcePreview, SourceRankingIntent } from "@learnspace/shared";
import { ArrowRight, FileText, Link2, LoaderCircle, Search, Video, X } from "lucide-react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { StartStudyButton } from "../study/StudyActions";

type ModalState = "idle" | "searching" | "results" | "resolving_url" | "preview" | "mode_mismatch" | "error";

type Props = {
  mode: SourceDiscoveryMode;
  isOpen: boolean;
  onClose: () => void;
  onSwitchMode: (mode: SourceDiscoveryMode) => void;
  triggerRef: RefObject<HTMLElement | null>;
};

type ErrorBody = { error?: { code?: string; message?: string; detectedMode?: SourceDiscoveryMode } };

function messageFrom(body: ErrorBody): string {
  return body.error?.message ?? "Something went wrong. Please try again.";
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

// Worker pickup (30s) + agent timeout (120s) + a small response margin.
const sourceDiscoveryPollBudgetMs = 165_000;

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs) return null;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear().toString();
}

export function SourceDiscoveryModal({ mode, isOpen, onClose, onSwitchMode, triggerRef }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const directRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const [query, setQuery] = useState("");
  const [directUrl, setDirectUrl] = useState("");
  const [directOpen, setDirectOpen] = useState(false);
  const [state, setState] = useState<ModalState>("idle");
  const [candidates, setCandidates] = useState<SourceDiscoveryCandidate[]>([]);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectedMode, setDetectedMode] = useState<SourceDiscoveryMode | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [rankingIntent, setRankingIntent] = useState<SourceRankingIntent>("best_match");
  const research = mode === "research";

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setDirectUrl("");
      setDirectOpen(false);
      setState("idle");
      setCandidates([]);
      setPreview(null);
      setError(null);
      setDetectedMode(null);
      setRunId(null);
      setRankingIntent("best_match");
      triggerRef.current?.focus();
      return;
    }
    setState("idle");
    setCandidates([]);
    setPreview(null);
    setError(null);
    setDetectedMode(null);
    setRunId(null);
    setRankingIntent("best_match");
    requestRef.current?.abort();
    requestRef.current = null;
    requestVersion.current += 1;
    const background = document.querySelector<HTMLElement>(".application-page");
    const previousAriaHidden = background ? background.getAttribute("aria-hidden") : null;
    const previousInert = background?.hasAttribute("inert") ?? false;
    const previousOverflow = document.body.style.overflow;
    background?.setAttribute("aria-hidden", "true");
    background?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      requestRef.current?.abort();
      requestRef.current = null;
      requestVersion.current += 1;
      document.body.style.overflow = previousOverflow;
      if (background) {
        if (previousAriaHidden === null) background.removeAttribute("aria-hidden");
        else background.setAttribute("aria-hidden", previousAriaHidden);
        if (!previousInert) background.removeAttribute("inert");
      }
    };
  }, [isOpen, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!runId || candidates.length === 0) return;
    for (const [position, candidate] of candidates.entries()) {
      if (!candidate.resourceId) continue;
      void fetch("/api/v1/discovery/impressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, resourceId: candidate.resourceId, position, surface: "source_picker", traceId: crypto.randomUUID() }),
      }).catch(() => undefined);
    }
  }, [candidates, runId]);

  async function readError(response: Response): Promise<ErrorBody> {
    try {
      return await response.json() as ErrorBody;
    } catch {
      return {};
    }
  }

  async function resolveUrl(value: string) {
    const url = value.trim();
    if (!url) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const version = ++requestVersion.current;
    setState("resolving_url");
    setError(null);
    setPreview(null);
    setDetectedMode(null);
    try {
      const response = await fetch("/api/v1/source-discovery/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, url, correlationId: crypto.randomUUID() }),
        signal: controller.signal,
      });
      const body = await (response.ok ? response.json() as Promise<{ preview?: SourcePreview }> : readError(response));
      if (version !== requestVersion.current) return;
      if (!response.ok) {
        const errorBody = body as ErrorBody;
        if (errorBody.error?.code === "SOURCE_MODE_MISMATCH") {
          setDetectedMode(errorBody.error.detectedMode ?? null);
          setError(messageFrom(errorBody));
          setState("mode_mismatch");
        } else {
          setError(messageFrom(errorBody));
          setState("error");
        }
        return;
      }
      const resolved = (body as { preview?: SourcePreview }).preview;
      if (!resolved) throw new Error("Preview missing");
      setPreview(resolved);
      setState("preview");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (version === requestVersion.current) {
        setError("We couldn't resolve that source. Check the URL and try again.");
        setState("error");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function pollRun(run: string, controller: AbortController, version: number) {
    const deadline = Date.now() + sourceDiscoveryPollBudgetMs;
    let waitMs = 1_000;
    while (Date.now() < deadline) {
      await delay(Math.min(waitMs, Math.max(0, deadline - Date.now())), controller.signal);
      const response = await fetch(`/api/v1/source-discovery/runs/${run}`, { signal: controller.signal });
      if (!response.ok) throw new Error(messageFrom(await readError(response)));
      const result = await response.json() as SourceDiscoverySearchResponse;
      if (version !== requestVersion.current) return;
      setCandidates(result.candidates);
      if (result.status === "completed") {
        setState("results");
        return;
      }
      waitMs = Math.min(8_000, waitMs * 2);
    }
    throw new Error(research ? "We couldn't finish comparing the papers. Try again." : "We couldn't finish finding strong videos. Try again.");
  }

  async function submitSearch(event?: FormEvent) {
    event?.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (isUrl(value)) {
      await resolveUrl(value);
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const version = ++requestVersion.current;
    setState("searching");
    setError(null);
    setPreview(null);
    setCandidates([]);
    setRunId(null);
    try {
      const response = await fetch("/api/v1/source-discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, query: value, rankingIntent, correlationId: crypto.randomUUID() }),
        signal: controller.signal,
      });
      const body = await (response.ok ? response.json() as Promise<SourceDiscoverySearchResponse> : readError(response));
      if (version !== requestVersion.current) return;
      if (!response.ok) {
        const errorBody = body as ErrorBody;
        if (errorBody.error?.code === "SOURCE_MODE_MISMATCH") {
          setDetectedMode(errorBody.error.detectedMode ?? null);
          setError(messageFrom(errorBody));
          setState("mode_mismatch");
        } else {
          setError(messageFrom(errorBody));
          setState("error");
        }
        return;
      }
      const result = body as SourceDiscoverySearchResponse;
      if (result.status === "preview" && result.preview) {
        setPreview(result.preview);
        setState("preview");
        return;
      }
      setRunId(result.runId);
      setCandidates(result.candidates);
      if (result.status === "completed") {
        setState("results");
        return;
      }
      if (result.runId) await pollRun(result.runId, controller, version);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (version === requestVersion.current) {
        setError(caught instanceof Error ? caught.message : "We couldn't search right now. Try again.");
        setState("error");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function switchMode() {
    if (!detectedMode) return;
    onSwitchMode(detectedMode);
  }

  if (!isOpen) return null;

  const headingEnd = research ? "the best papers" : "the best videos";
  const directLabel = research ? "arXiv / DOI" : "YouTube URL";
  const startLabel = research ? "Start researching" : "Start learning";
  const emptyTitle = research ? "or add a paper directly" : "or add a video directly";
  const emptySubtitle = research ? "Already have a paper in mind?" : "Already know what you want to study?";

  const content = (
    <div className="source-discovery-overlay" role="presentation">
      <button className="source-discovery-backdrop" type="button" onClick={onClose} aria-label="Close source discovery" />
      <section ref={dialogRef} className="source-discovery-dialog" data-source-discovery-dialog role="dialog" aria-modal="true" aria-labelledby="source-discovery-title">
        <button className="source-discovery-close" type="button" onClick={onClose} aria-label="Close source discovery"><X aria-hidden="true" /></button>
        <header className="source-discovery-header">
          <h2 id="source-discovery-title">{research ? "Research any topic from" : "Learn any topic from"}<br /><span>{headingEnd}</span></h2>
        </header>
        <div className="source-discovery-body">
          <form className="source-discovery-search" onSubmit={(event) => void submitSearch(event)}>
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={research ? "What do you want to research?" : "What do you want to learn?"} aria-label={research ? "What do you want to research?" : "What do you want to learn?"} autoComplete="off" />
            <div className="source-discovery-search-footer">
              <fieldset className="source-discovery-pills" aria-label="Search source and ranking">
                <span className="source-discovery-pill">{research ? <FileText aria-hidden="true" /> : <Video aria-hidden="true" />} {research ? "Papers" : "YouTube"}</span>
                <label className="source-discovery-pill source-discovery-select"><span className="sr-only">Ranking</span><select value={rankingIntent} onChange={(event) => setRankingIntent(event.target.value as SourceRankingIntent)}><option value="best_match">Best match</option>{research ? <><option value="foundational">Foundational</option><option value="recent">Recent</option></> : <><option value="beginner_friendly">Beginner friendly</option><option value="in_depth">In-depth</option><option value="practical">Practical</option></>}</select></label>
              </fieldset>
              <button className="source-discovery-submit" type="submit" aria-label={research ? "Search papers" : "Search videos"} disabled={state === "searching" || state === "resolving_url"}><Search aria-hidden="true" /></button>
            </div>
          </form>

          <div className={`source-discovery-lower ${state === "results" || state === "searching" ? "is-results" : ""}`}>
            {state === "searching" && candidates.length === 0 ? <div className="source-discovery-loading" aria-live="polite"><LoaderCircle className="source-discovery-spinner" aria-hidden="true" /><p>{research ? "Finding relevant papers…" : "Finding the strongest videos…"}</p><span>{research ? "Comparing candidate papers…" : "Checking topic relevance and ranking learning resources…"}</span></div> : null}
            {(state === "results" || (state === "searching" && candidates.length > 0)) ? <div className="source-discovery-results" aria-live="polite">{candidates.length > 0 ? <>{candidates.map((candidate) => <ResultRow key={candidate.resourceId ?? candidate.canonicalUrl ?? candidate.title} candidate={candidate} mode={mode} startLabel={startLabel} onStart={onClose} />)}{state === "searching" ? <div className="source-discovery-more" aria-live="polite"><LoaderCircle className="source-discovery-spinner" aria-hidden="true" /> Finding a few more strong matches…</div> : null}</> : <div className="source-discovery-empty-results"><p>{research ? "We couldn't find strong research papers for that topic." : "We couldn't find strong learning videos for that topic."}</p><span>Try making the topic more specific.</span></div>}</div> : null}
            {state === "preview" && preview ? <Preview preview={preview} label={startLabel} onStart={onClose} /> : null}
            {state === "mode_mismatch" ? <div className="source-discovery-message" role="alert"><div className="source-discovery-message-icon"><Link2 aria-hidden="true" /></div><p>{error}</p><span>{detectedMode === "research" ? "Research papers are opened in Research mode." : "Videos are studied in Learn mode."}</span><button type="button" onClick={switchMode}>Switch to {detectedMode === "research" ? "Research" : "Learn"} <ArrowRight aria-hidden="true" /></button></div> : null}
            {state === "error" ? <div className="source-discovery-message" role="alert"><div className="source-discovery-message-icon">{research ? <FileText aria-hidden="true" /> : <Video aria-hidden="true" />}</div><p>{error}</p><button type="button" onClick={() => void submitSearch()}>Try again</button></div> : null}
            {state === "idle" && !directOpen ? <div className="source-discovery-empty"><h3>{emptyTitle}</h3><p>{emptySubtitle}</p><button className="source-discovery-direct-trigger" type="button" onClick={() => { setDirectOpen(true); window.requestAnimationFrame(() => directRef.current?.focus()); }}>{directLabel}</button></div> : null}
            {state === "resolving_url" ? <div className="source-discovery-loading" aria-live="polite"><LoaderCircle className="source-discovery-spinner" aria-hidden="true" /><p>Resolving your source…</p><span>Checking the provider and preparing a preview…</span></div> : null}
            {directOpen && state !== "preview" && state !== "mode_mismatch" && state !== "error" && state !== "resolving_url" ? <div className="source-discovery-direct-form"><h3>{emptyTitle}</h3><p>{emptySubtitle}</p><div className="source-discovery-url-input"><Link2 aria-hidden="true" /><input ref={directRef} value={directUrl} onChange={(event) => setDirectUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void resolveUrl(directUrl); } }} placeholder={research ? "Paste an arXiv or DOI URL" : "Paste a YouTube URL"} aria-label={directLabel} type="url" /><button type="button" onClick={() => void resolveUrl(directUrl)} aria-label="Resolve source"><ArrowRight aria-hidden="true" /></button></div></div> : null}
          </div>
        </div>
      </section>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(content, document.body);
}

function ResultRow({ candidate, mode, startLabel, onStart }: { candidate: SourceDiscoveryCandidate; mode: SourceDiscoveryMode; startLabel: string; onStart: () => void }) {
  const duration = formatDuration(candidate.durationMs);
  const sourceProps = candidate.sourceOrigin === "external_refresh" && candidate.canonicalUrl
    ? { sourceUrl: candidate.canonicalUrl, sourceMode: mode }
    : candidate.resourceId
    ? { resourceId: candidate.resourceId }
    : candidate.canonicalUrl
      ? { sourceUrl: candidate.canonicalUrl, sourceMode: mode }
      : {};
  return <article className="source-discovery-result"><div className="source-discovery-thumbnail">{candidate.thumbnailUrl ? <Image src={candidate.thumbnailUrl} alt="" width={128} height={72} unoptimized /> : mode === "research" ? <FileText aria-hidden="true" /> : <Video aria-hidden="true" />}</div><div className="source-discovery-result-copy"><h3>{candidate.title}</h3><p>{[candidate.author, duration, formatDate(candidate.publishedAt)].filter(Boolean).join(" · ")}</p><span>{candidate.reason}</span></div><StartStudyButton {...sourceProps} {...(candidate.recommendationRunId === undefined ? {} : { recommendationRunId: candidate.recommendationRunId })} origin={mode === "research" ? "research" : "discover"} label={startLabel} className="source-discovery-start" onClick={onStart} /></article>;
}

function Preview({ preview, label, onStart }: { preview: SourcePreview; label: string; onStart: () => void }) {
  const metadata = preview.mode === "research" ? [preview.authors.length > 0 ? preview.authors.slice(0, 2).join(", ") : null, preview.year?.toString(), preview.venue ?? (preview.arxivId ? "arXiv" : null)].filter(Boolean).join(" · ") : [preview.author, formatDuration(preview.durationMs)].filter(Boolean).join(" · ");
  return <div className="source-discovery-preview"><div className="source-discovery-preview-media">{preview.thumbnailUrl ? <Image src={preview.thumbnailUrl} alt="" width={180} height={101} unoptimized /> : preview.mode === "research" ? <FileText aria-hidden="true" /> : <Video aria-hidden="true" />}</div><div className="source-discovery-preview-copy"><span className="source-discovery-kicker">Review source</span><h3>{preview.title}</h3><p>{metadata}</p>{preview.description ? <span>{preview.description}</span> : null}</div><StartStudyButton resourceId={preview.resourceId} origin={preview.mode === "research" ? "research" : "discover"} label={label} className="source-discovery-start" onClick={onStart} /></div>;
}

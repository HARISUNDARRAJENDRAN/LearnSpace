"use client";

import type { StudyOrigin } from "@learnspace/shared";
import type { GlobalSearchResult } from "../../lib/search/service";
import { ArrowUpRight, BrainCircuit, FileText, FolderOpen, LoaderCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { StartStudyButton } from "../study/StudyActions";

type SearchPaletteProps = { isOpen: boolean; mode: "learn" | "research"; onClose: () => void };
type SearchGroup = { kind: GlobalSearchResult["kind"]; label: string };

const searchGroups: SearchGroup[] = [
  { kind: "resource", label: "Resources" },
  { kind: "session", label: "Sessions" },
  { kind: "library", label: "Library" },
  { kind: "concept", label: "Concepts" },
];

function studyType(type: GlobalSearchResult["resourceType"]): "video" | "paper" | null {
  return type === "video" ? "video" : type === "paper" || type === "pdf" ? "paper" : null;
}

function originFor(mode: SearchPaletteProps["mode"]): StudyOrigin {
  return mode === "research" ? "research" : "discover";
}

export function SearchPalette({ isOpen, mode, onClose }: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setResults([]);
    setError(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      void fetch(`/api/v1/search?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Search failed");
          return response.json() as Promise<{ results?: GlobalSearchResult[] }>;
        })
        .then((payload) => setResults(Array.isArray(payload.results) ? payload.results : []))
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setResults([]);
            setError(true);
          }
          return reason;
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen, query]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="application-search-backdrop" role="presentation">
      <section className="application-search-dialog" role="dialog" aria-modal="true" aria-labelledby="application-search-title">
        <h2 id="application-search-title" className="sr-only">Search LearnSpace</h2>
        <div className="application-search-field">
          <Search aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resources, sessions, library…" aria-label="Search LearnSpace" autoComplete="off" />
          {loading ? <LoaderCircle className="application-search-spinner" aria-label="Searching" /> : null}
          <button className="application-search-close" type="button" aria-label="Close search" onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        <div className="application-search-results" aria-live="polite">
          {query.trim().length < 2 ? <p className="application-search-empty">Type at least 2 characters to search. <span>⌘K</span></p> : error ? <p className="application-search-empty">Search is unavailable right now.</p> : !loading && results.length === 0 ? <p className="application-search-empty">No matches found.</p> : searchGroups.map((group) => {
            const groupResults = results.filter((result) => result.kind === group.kind);
            if (groupResults.length === 0) return null;
            return <div className="application-search-group" key={group.kind}><p className="application-search-group-label">{group.label}</p>{groupResults.map((result) => <SearchResult key={`${result.kind}-${result.id}`} result={result} mode={mode} onClose={onClose} />)}</div>;
          })}
        </div>
      </section>
    </div>
  );
}

function SearchResult({ result, mode, onClose }: { result: GlobalSearchResult; mode: SearchPaletteProps["mode"]; onClose: () => void }) {
  const type = studyType(result.resourceType);
  const canStudy = result.kind !== "session" && Boolean(result.resourceId && type);
  return (
    <article className="application-search-result">
      <div className="application-search-result-icon" aria-hidden="true">{result.kind === "concept" ? <BrainCircuit /> : result.kind === "library" ? <FolderOpen /> : <FileText />}</div>
      <div className="application-search-result-main">
        {result.href ? <Link className="application-search-result-title" href={result.href} onClick={onClose}>{result.title}</Link> : <p className="application-search-result-title">{result.title}</p>}
        <p className="application-search-result-subtitle">{result.subtitle}</p>
      </div>
      {canStudy ? <StartStudyButton resourceId={result.resourceId as string} origin={originFor(mode)} label={type === "paper" ? "Study paper" : "Start learning"} className="application-search-result-action" onClick={onClose} /> : result.href ? <Link className="application-search-result-link" href={result.href} onClick={onClose}>Open <ArrowUpRight aria-hidden="true" /></Link> : null}
    </article>
  );
}

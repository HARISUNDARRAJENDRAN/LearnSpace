"use client";

import type { GlobalSearchResult } from "../../lib/search/service";
import { BrainCircuit, Clock3, FileText, FolderOpen, History, LoaderCircle, PlayCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type RefObject } from "react";
import type { RecentSession } from "./AppSidebar";

type Mode = "learn" | "research";
type Option = { key: string; title: string; subtitle: string; kind: GlobalSearchResult["kind"] | "recent" | "session-recent"; thumbnailUrl?: string | null; activate: () => void };

const groups: { kind: GlobalSearchResult["kind"]; label: string }[] = [
  { kind: "collection", label: "Courses" },
  { kind: "lesson", label: "Lessons" },
  { kind: "resource", label: "Resources" },
  { kind: "session", label: "Your sessions" },
  { kind: "library", label: "Your library" },
  { kind: "concept", label: "Concepts" },
];
const examples = ["derivatives", "organic chemistry", "Khan Academy", "operating systems", "JEE physics"];
const recentKey = "learnspace:recent-searches";

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function remember(query: string) {
  try {
    localStorage.setItem(recentKey, JSON.stringify([query, ...readRecent().filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 5)));
  } catch {}
}

function OptionIcon({ option }: { option: Option }) {
  if (option.thumbnailUrl) return <img className="header-search-thumb" src={option.thumbnailUrl} alt="" loading="lazy" />;
  const Icon = option.kind === "recent" ? History : option.kind === "session-recent" || option.kind === "session" ? Clock3 : option.kind === "concept" ? BrainCircuit : option.kind === "library" || option.kind === "collection" ? FolderOpen : option.kind === "lesson" ? PlayCircle : FileText;
  return <span className="header-search-icon"><Icon aria-hidden="true" /></span>;
}

export function HeaderSearch({ inputRef, mode, recentSessions }: { inputRef: RefObject<HTMLInputElement | null>; mode: Mode; recentSessions: RecentSession[] }) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      void fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Search failed");
          return response.json() as Promise<{ results?: GlobalSearchResult[] }>;
        })
        .then((payload) => { setResults(Array.isArray(payload.results) ? payload.results : []); setActive(0); })
        .catch(() => { if (!controller.signal.aborted) { setResults([]); setError(true); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmed]);

  function close() {
    setOpen(false);
    inputRef.current?.blur();
  }

  function go(href: string) {
    if (trimmed.length >= 2) remember(trimmed);
    close();
    setQuery("");
    router.push(href);
  }

  async function study(result: GlobalSearchResult) {
    if (trimmed.length >= 2) remember(trimmed);
    const response = await fetch("/api/v1/study-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: result.resourceId, origin: mode === "research" ? "research" : "discover", idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }) });
    // Sessions holds one thing at a time, so a new start waits for the current session.
    if (response.status === 409) return setBlocked(true);
    const body = response.ok ? await response.json() as { route?: unknown } : null;
    if (typeof body?.route !== "string") return setError(true);
    close();
    setQuery("");
    router.push(body.route);
  }

  const sections: { label: string; options: Option[] }[] = trimmed.length >= 2
    ? groups.map(({ kind, label }) => ({
      label,
      options: results.filter((result) => result.kind === kind).map((result) => ({
        key: `${result.kind}-${result.id}`,
        title: result.title,
        subtitle: result.subtitle,
        kind: result.kind,
        thumbnailUrl: result.thumbnailUrl ?? null,
        activate: () => result.href ? go(result.href) : result.resourceId ? void study(result) : undefined,
      })),
    }))
    : [
      { label: "Recent searches", options: recent.map((item) => ({ key: `recent-${item}`, title: item, subtitle: "", kind: "recent" as const, activate: () => { setQuery(item); inputRef.current?.focus(); } })) },
      { label: "Jump back in", options: recentSessions.filter((session) => session.route).slice(0, 3).map((session) => ({ key: `session-${session.id}`, title: session.title ?? "Untitled session", subtitle: "Study session", kind: "session-recent" as const, activate: () => go(session.route!) })) },
    ];
  const visible = sections.filter((section) => section.options.length);
  const options = visible.flatMap((section) => section.options);
  const current = options[Math.min(active, options.length - 1)];
  const optionId = (key: string) => `${listId}-${key.replaceAll(/[^a-zA-Z0-9-]/g, "")}`;
  const activeId = open && current ? optionId(current.key) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: closes the results once focus leaves the search; nothing here is clicked.
    <div className={`header-search${open ? " is-open" : ""}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label className="header-search-field">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search LearnSpace"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          placeholder={mode === "research" ? "Search papers and sessions" : "Search lessons, courses, channels"}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onFocus={() => { setRecent(readRecent()); setOpen(true); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (options.length) setActive((index) => (Math.min(index, options.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
            } else if (event.key === "Enter" && open && current) {
              event.preventDefault();
              current.activate();
            } else if (event.key === "Escape") {
              if (query) setQuery("");
              else close();
            }
          }}
        />
        {loading ? <LoaderCircle className="header-search-spinner" aria-label="Searching" /> : query ? <button className="header-search-clear" type="button" aria-label="Clear search" onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X aria-hidden="true" /></button> : <kbd>/</kbd>}
      </label>
      {open ? (
        <div className="header-search-panel">
          <div id={listId} role="listbox" aria-label="Search results">
            {visible.map((section) => (
              // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this labels a set of listbox options.
              <div key={section.label} role="group" aria-labelledby={optionId(section.label)}>
                <p className="header-search-group" id={optionId(section.label)}>{section.label}</p>
                {section.options.map((option) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard (arrows and Enter) through aria-activedescendant.
                  <div
                    key={option.key}
                    id={optionId(option.key)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={option === current}
                    className={`header-search-option${option.thumbnailUrl ? " has-thumb" : ""}`}
                    onMouseMove={() => setActive(options.indexOf(option))}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={option.activate}
                  >
                    <OptionIcon option={option} />
                    <span className="header-search-copy"><strong>{option.title}</strong>{option.subtitle ? <small>{option.subtitle}</small> : null}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div aria-live="polite">
            {blocked ? <p className="header-search-empty">Finish your current session first. It&apos;s waiting in <a href="/app/sessions">Sessions</a>.</p> : null}
            {trimmed.length >= 2 ? (
              error ? <p className="header-search-empty">Search is unavailable right now.</p>
                : !loading && !results.length ? <p className="header-search-empty">No matches for “{trimmed}”. Try a topic, a unit or a channel name.</p> : null
            ) : (
              <div className="header-search-examples">
                <p className="header-search-group">Try</p>
                <div>{examples.map((example) => <button key={example} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery(example)}>{example}</button>)}</div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

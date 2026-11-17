"use client";

import { BrainCircuit, Clock3, FileText, FolderOpen, History, LoaderCircle, PlayCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { isSearchResultAllowed, type SearchMode } from "../../lib/search/contract";
import type { GlobalSearchResult } from "../../lib/search/service";
import { useSessions } from "./sessions";

type Option = { key: string; title: string; subtitle: string; kind: GlobalSearchResult["kind"] | "recent" | "session-recent" | "web-search"; thumbnailUrl?: string | null; activate: () => void };

const groups: Record<SearchMode, { kind: GlobalSearchResult["kind"]; label: string }[]> = {
  learn: [
  { kind: "collection", label: "Courses" },
  { kind: "lesson", label: "Lessons" },
  { kind: "resource", label: "Resources" },
  { kind: "session", label: "Learn sessions" },
  { kind: "library", label: "Your library" },
  { kind: "concept", label: "Concepts" },
  ],
  research: [
    { kind: "resource", label: "Papers" },
    { kind: "author", label: "Authors" },
    { kind: "concept", label: "Research topics" },
    { kind: "session", label: "Research sessions" },
    { kind: "library", label: "Saved papers" },
  ],
};
const examples: Record<SearchMode, string[]> = {
  learn: ["derivatives", "organic chemistry", "Khan Academy", "operating systems", "JEE physics"],
  research: ["transformer attention", "diffusion models", "graph neural networks", "climate adaptation", "retrieval augmented generation"],
};
const recentKey = (mode: SearchMode) => `learnspace:recent-searches:${mode}`;

function readRecent(mode: SearchMode): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(mode)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function remember(query: string, mode: SearchMode) {
  try {
    localStorage.setItem(recentKey(mode), JSON.stringify([query, ...readRecent(mode).filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 5)));
  } catch {}
}

function OptionIcon({ option }: { option: Option }) {
  if (option.thumbnailUrl) return <img className="header-search-thumb" src={option.thumbnailUrl} alt="" loading="lazy" />;
  const Icon = option.kind === "recent" ? History : option.kind === "session-recent" || option.kind === "session" ? Clock3 : option.kind === "concept" ? BrainCircuit : option.kind === "library" || option.kind === "collection" ? FolderOpen : option.kind === "lesson" ? PlayCircle : FileText;
  return <span className="header-search-icon"><Icon aria-hidden="true" /></span>;
}

export function HeaderSearch({ inputRef, mode }: { inputRef: RefObject<HTMLInputElement | null>; mode: SearchMode }) {
  const { sessions } = useSessions();
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [resultsMode, setResultsMode] = useState<SearchMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [recentMode, setRecentMode] = useState<SearchMode | null>(null);
  const requestToken = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const currentMode = useRef(mode);
  const currentQuery = useRef(query);
  currentMode.current = mode;
  currentQuery.current = query;
  const trimmed = query.trim();

  useEffect(() => {
    requestController.current?.abort();
    requestToken.current += 1;
    setResults([]);
    setResultsMode(mode);
    setRecent(readRecent(mode));
    setRecentMode(mode);
    setError(false);
    setActive(0);
  }, [mode]);

  useEffect(() => {
    const token = ++requestToken.current;
    const requestMode = mode;
    const requestQuery = trimmed;
    requestController.current?.abort();
    if (trimmed.length < 2) {
      setResults([]);
      setResultsMode(mode);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      void fetch(`/api/v1/search?mode=${requestMode}&q=${encodeURIComponent(requestQuery)}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Search failed");
          return response.json() as Promise<{ mode?: SearchMode; results?: GlobalSearchResult[] }>;
        })
        .then((payload) => {
          if (controller.signal.aborted || token !== requestToken.current || currentMode.current !== requestMode || currentQuery.current.trim() !== requestQuery || payload.mode !== requestMode) return;
          setResults(Array.isArray(payload.results) ? payload.results : []);
          setResultsMode(requestMode);
          setActive(0);
        })
        .catch(() => { if (!controller.signal.aborted && token === requestToken.current && currentMode.current === requestMode) { setResults([]); setResultsMode(requestMode); setError(true); } })
        .finally(() => { if (!controller.signal.aborted && token === requestToken.current) setLoading(false); });
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (requestController.current === controller) requestController.current = null;
    };
  }, [mode, trimmed]);

  function close() {
    setOpen(false);
    inputRef.current?.blur();
  }

  function go(href: string) {
    if (trimmed.length >= 2) remember(trimmed, mode);
    close();
    setQuery("");
    router.push(href);
  }

  async function study(result: GlobalSearchResult) {
    const requestMode = mode;
    if (trimmed.length >= 2) remember(trimmed, mode);
    const response = await fetch("/api/v1/study-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: result.resourceId, origin: requestMode === "research" ? "research" : "discover", idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }) });
    const body = response.ok ? await response.json() as { route?: unknown } : null;
    if (currentMode.current !== requestMode) return;
    if (typeof body?.route !== "string") return setError(true);
    close();
    setQuery("");
    router.push(body.route);
  }

  const visibleResults = resultsMode === mode ? results.filter((result) => isSearchResultAllowed(mode, result)) : [];
  const sections: { label: string; options: Option[] }[] = trimmed.length >= 2
    ? [
      ...groups[mode].map(({ kind, label }) => ({
      label,
      options: visibleResults.filter((result) => result.kind === kind).map((result) => ({
        key: `${result.kind}-${result.id}`,
        title: result.title,
        subtitle: result.subtitle,
        kind: result.kind,
        thumbnailUrl: result.thumbnailUrl ?? null,
        activate: () => result.href ? go(result.href) : result.resourceId ? void study(result) : undefined,
      })),
      })),
      ...(mode === "research" ? [{ label: "Search the web", options: [{ key: "search-web", title: "Search the web for papers", subtitle: "Find papers from the web", kind: "web-search" as const, activate: () => document.querySelector<HTMLButtonElement>('.application-header-create[aria-label="Start research"]')?.click() }] }] : []),
    ]
    : [
      { label: "Recent searches", options: (recentMode === mode ? recent : []).map((item) => ({ key: `recent-${item}`, title: item, subtitle: "", kind: "recent" as const, activate: () => { setQuery(item); inputRef.current?.focus(); } })) },
      { label: "Jump back in", options: sessions.filter((session) => session.route?.startsWith(mode === "research" ? "/app/study/paper/" : "/app/study/video/")).toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)).slice(0, 3).map((session) => ({ key: `session-${session.id}`, title: session.title ?? "Untitled session", subtitle: mode === "research" ? "Research session" : "Learn session", kind: "session-recent" as const, activate: () => { if (session.route) go(session.route); } })) },
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
          onFocus={() => { setRecent(readRecent(mode)); setRecentMode(mode); setOpen(true); }}
          onChange={(event) => { requestToken.current += 1; requestController.current?.abort(); requestController.current = null; setResults([]); setResultsMode(mode); setLoading(false); setQuery(event.target.value); setOpen(true); }}
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
            {trimmed.length >= 2 ? (
              error ? <p className="header-search-empty">Search is unavailable right now.</p>
                : !loading && !visibleResults.length ? <p className="header-search-empty">{mode === "research" ? `No papers, authors, topics, or sessions match “${trimmed}”.` : `No lessons, courses, or learning resources match “${trimmed}”.`}</p> : null
            ) : (
              <div className="header-search-examples">
                <p className="header-search-group">Try</p>
                <div>{examples[mode].map((example) => <button key={example} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery(example)}>{example}</button>)}</div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import type { ResearchAuthorSummary } from "@learnspace/shared";
import { Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AuthorAvatar } from "./ResearchAuthor";
import { FollowAuthorButton } from "./ResearchAuthorControls";

type Topic = { id: string; name: string };
type View = "topics" | "authors";
export type RefineData = { topics: Topic[]; followed: ResearchAuthorSummary[]; suggested: ResearchAuthorSummary[] };

const MAX_TOPICS = 20;

/** Looks topics up in the concept catalogue as the reader types. */
function useTopicSearch(query: string) {
  const [results, setResults] = useState<Topic[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/onboarding/concepts?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => (response.ok ? response.json() as Promise<{ concepts: Topic[] }> : { concepts: [] }))
        .then((body) => setResults(body.concepts.map(({ id, name }) => ({ id, name }))))
        .catch(() => undefined);
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);
  return results;
}

function AuthorRow({ author }: { author: ResearchAuthorSummary }) {
  return <li className="research-refine-author">
    <AuthorAvatar name={author.name} />
    <span><strong>{author.name}</strong><small>{author.paperCount} {author.paperCount === 1 ? "paper" : "papers"} in the catalogue</small></span>
    <FollowAuthorButton authorId={author.authorId} followed={author.followed} compact />
  </li>;
}

function RefineDialog({ data, initial, onClose }: { data: RefineData; initial: View; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>(initial);
  const [topics, setTopics] = useState(data.topics);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const results = useTopicSearch(query).filter((result) => !topics.some((topic) => topic.id === result.id)).slice(0, 8);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const changed = topics.map(({ id }) => id).join() !== data.topics.map(({ id }) => id).join();

  async function save() {
    setState("saving");
    const response = await fetch("/api/v1/research/topics", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conceptIds: topics.map(({ id }) => id) }) }).catch(() => null);
    if (!response?.ok) { setState("error"); return; }
    router.refresh();
    dialog.current?.close();
  }

  return (
    // A click on the backdrop closes the dialog; Escape already does, natively.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the dialog's own Escape.
    <dialog ref={dialog} className="research-refine" aria-labelledby="research-refine-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <header className="research-refine-head">
        <h2 id="research-refine-title">Refine recommendations</h2>
        <button className="research-refine-close" type="button" aria-label="Close" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
      </header>
      <div className="research-refine-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "topics"} onClick={() => setView("topics")}>Topics</button>
        <button type="button" role="tab" aria-selected={view === "authors"} onClick={() => setView("authors")}>Authors</button>
      </div>
      {view === "topics" ? <div className="research-refine-body" role="tabpanel">
        <p className="research-refine-note">Your feed, foundational picks and learning paths follow these topics.</p>
        <ul className="research-refine-chips" aria-label="Your topics">
          {topics.map((topic) => <li key={topic.id}><span>{topic.name}</span><button type="button" aria-label={`Remove ${topic.name}`} onClick={() => setTopics(topics.filter(({ id }) => id !== topic.id))}><X aria-hidden="true" /></button></li>)}
        </ul>
        {topics.length < MAX_TOPICS ? <>
          <label className="research-refine-search"><Search aria-hidden="true" /><span className="sr-only">Add a topic</span><input type="search" value={query} placeholder="Add a topic…" onChange={(event) => setQuery(event.target.value)} /></label>
          <ul className="research-refine-results" aria-label="Topics to add">
            {results.map((result) => <li key={result.id}><button type="button" onClick={() => { setTopics([...topics, result]); setQuery(""); }}><Plus aria-hidden="true" />{result.name}</button></li>)}
          </ul>
        </> : <p className="research-refine-note">That&apos;s the most topics a feed can follow.</p>}
      </div> : <div className="research-refine-body" role="tabpanel">
        <h3>Following</h3>
        {data.followed.length ? <ul className="research-refine-authors">{data.followed.map((author) => <AuthorRow key={author.authorId} author={author} />)}</ul> : <p className="research-refine-note">You aren&apos;t following anyone yet.</p>}
        {data.suggested.length ? <><h3>Suggested for your topics</h3><ul className="research-refine-authors">{data.suggested.map((author) => <AuthorRow key={author.authorId} author={author} />)}</ul></> : null}
      </div>}
      {view === "topics" ? <footer className="research-refine-foot">
        {state === "error" ? <p role="alert">Your topics couldn&apos;t be saved. Try again.</p> : null}
        <button type="button" className="research-refine-secondary" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="research-refine-primary" disabled={!changed || topics.length === 0 || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save topics"}</button>
      </footer> : null}
    </dialog>
  );
}

/** A button that opens Refine recommendations on topics or authors. */
export function RefineRecommendations({ data, view, className, label, children }: { data: RefineData; view: View; className: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>{children}</button>
    {open ? <RefineDialog data={data} initial={view} onClose={() => setOpen(false)} /> : null}
  </>;
}

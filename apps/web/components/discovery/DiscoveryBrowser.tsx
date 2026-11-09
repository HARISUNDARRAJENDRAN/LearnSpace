"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ListVideo, Plus, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CurriculumCategory, CurriculumItem } from "../../lib/discovery/curriculum";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";

function TheatreCard({ item, step, selected, onSelect }: { item: CurriculumItem; step: number; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" className="discover-theatre-card" aria-current={selected ? "step" : undefined} onClick={onSelect}>
        <span className="discover-theatre-thumb">
          {item.thumbnailUrl ? <YouTubeThumbnail src={item.thumbnailUrl} fallbackSrc={item.thumbnailFallbackUrl} alt="" fill loading="lazy" sizes="320px" /> : <ListVideo aria-hidden="true" />}
          <span className="discover-theatre-number">{String(step).padStart(2, "0")}</span>
        </span>
        <strong>{item.title}</strong>
        {item.track ? <small>{item.track}</small> : null}
      </button>
    </li>
  );
}

function AddToLibraryButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "adding" | "error">("idle");
  async function add() {
    setState("adding");
    try {
      const response = await fetch("/api/v1/library/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      if (!response.ok) throw new Error("Adding the course failed");
      router.push("/app/library");
    } catch {
      setState("error");
    }
  }
  return <>
    <button type="button" className="discover-theatre-add" onClick={() => void add()} disabled={state === "adding"}><Plus aria-hidden="true" />{state === "adding" ? "Adding…" : "Add this to Library"}</button>
    {state === "error" ? <p className="discover-theatre-error" role="alert">This course could not be added. Try again.</p> : null}
  </>;
}

function ImportToSessionsButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "importing" | "error">("idle");
  const [message, setMessage] = useState("");
  async function importCourse() {
    setState("importing");
    try {
      const response = await fetch("/api/v1/study-sessions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "This course could not be imported. Try again.");
      router.push("/app/sessions");
      // Refresh the shell too: with a session in progress the header's add button steps aside.
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This course could not be imported. Try again.");
      setState("error");
    }
  }
  return <>
    <button type="button" className="discover-theatre-add discover-theatre-import" onClick={() => void importCourse()} disabled={state === "importing"}><Workflow aria-hidden="true" />{state === "importing" ? "Importing…" : "Import to Sessions"}</button>
    {state === "error" ? <p className="discover-theatre-error" role="alert">{message}</p> : null}
  </>;
}

export function DiscoveryBrowser({ category, initialStep, canImport }: { category: CurriculumCategory; initialStep: number; canImport: boolean }) {
  const lessons = category.items.filter((item) => item.url);
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), lessons.length));
  const hero = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const item = lessons[step - 1]!;

  // biome-ignore lint/correctness/useExhaustiveDependencies: step is the trigger; the effect reads the DOM it just rendered.
  useEffect(() => {
    // Scroll only the row that holds the open lesson; scrollIntoView would also move the page.
    const current = list.current?.querySelector<HTMLElement>("[aria-current]");
    if (!current || !list.current) return;
    const [card, frame] = [current.getBoundingClientRect(), list.current.getBoundingClientRect()];
    if (card.left < frame.left || card.right > frame.right) list.current.scrollLeft += card.left - frame.left - (frame.width - card.width) / 2;
  }, [step]);

  function select(target: number) {
    setStep(target);
    // Keep the open step in the URL so a refresh, a shared link or a search result lands on the same lesson.
    window.history.replaceState(null, "", `?step=${target}`);
    if (hero.current && hero.current.getBoundingClientRect().top < 0) hero.current.scrollIntoView({ block: "start" });
  }

  return (
    <main className="discover-course-page" aria-labelledby="discover-page-heading">
      <div ref={hero} className="discover-theatre-hero">
        <div className="discover-theatre-backdrop" aria-hidden="true">
          {item.thumbnailUrl ? <YouTubeThumbnail key={item.id} src={item.thumbnailUrl} fallbackSrc={item.thumbnailFallbackUrl} alt="" fill sizes="100vw" /> : null}
        </div>
        <Link className="discover-theatre-back" href="/app/discover"><ArrowLeft aria-hidden="true" />Discover</Link>
        <div className="discover-theatre-copy">
          <h1 id="discover-page-heading">{category.name}</h1>
          <h2>{item.title}</h2>
          <div className="discover-theatre-actions">
            {canImport ? <ImportToSessionsButton slug={category.slug} /> : null}
            <AddToLibraryButton slug={category.slug} />
          </div>
        </div>
      </div>
      <section className="discover-theatre-row" aria-label="Course units">
        <h3>Course units<span>{lessons.length}</span></h3>
        <ol ref={list}>{lessons.map((entry, index) => <TheatreCard key={entry.id} item={entry} step={index + 1} selected={index + 1 === step} onSelect={() => select(index + 1)} />)}</ol>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ListVideo, Play, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CurriculumArea, CurriculumCategory } from "../../lib/discovery/curriculum";
import { browseItems } from "../../lib/discovery/browse";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";

export function DiscoveryBrowser({ areas, category, intelligencePanel }: { areas: CurriculumArea[]; category: CurriculumCategory; intelligencePanel: ReactNode }) {
  const [format, setFormat] = useState("");
  const [stage, setStage] = useState("");
  const [sort, setSort] = useState("curated");
  const [limit, setLimit] = useState(24);
  const filterMenu = useRef<HTMLDetailsElement>(null);
  const resources = category.items.filter((item) => item.url);
  const items = browseItems([{ name: areas[0]?.name ?? "", categories: [category] }], { topic: "", format, stage, sort });
  const notes = category.items.filter((item) => !item.url);
  const levels = [...new Set(resources.map((item) => item.learningStage).filter((value): value is string => Boolean(value)))];

  useEffect(() => {
    const closeOnOutsideTap = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterMenu.current?.contains(event.target) && filterMenu.current) filterMenu.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && filterMenu.current) filterMenu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOnOutsideTap);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideTap);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <main className="discovery-canvas discovery-curriculum discover-browser discover-playlist-page" aria-labelledby="discover-page-heading">
      <nav className="discover-playlist-nav" aria-label="Playlist navigation">
        <Link className="discovery-category-back" href="/app/discover" aria-label="Back to Discover"><ArrowLeft aria-hidden="true" /></Link>
        <div><Link href="/app/discover" aria-current="page">Browse</Link><Link href="/app/discover#discover-for-you-heading">For you</Link><Link href="/app/library">My library</Link></div>
      </nav>

      <header className="discover-playlist-hero">
        <div className="discover-playlist-summary">
          <h1 id="discover-page-heading">{category.name}</h1>
          <p className="discover-playlist-description">A curated route through {category.name.toLocaleLowerCase()}. Find your next lesson and learn at your own pace.</p>
          <div className="discover-playlist-actions">
            {resources[0]?.url ? <a className="discover-start" href={resources[0].url} target="_blank" rel="noreferrer"><Play aria-hidden="true" /> Start learning<span className="sr-only"> on YouTube (new tab)</span></a> : null}
          </div>
        </div>
      </header>

      <section id="playlist-lessons" className="discover-playlist-lessons" aria-label="Playlist lessons">
          <div className="discover-playlist-tools">
            <details ref={filterMenu} className="discover-playlist-filter-menu">
              <summary><SlidersHorizontal aria-hidden="true" /> Filter &amp; sort</summary>
              <div className="discover-filters">
                <label>Format<select aria-label="Format" value={format} onChange={(event) => { setFormat(event.target.value); setLimit(24); }}><option value="">All formats</option><option value="video">Videos</option><option value="playlist">YouTube playlists</option></select></label>
                <label>Level<select aria-label="Level" value={stage} onChange={(event) => { setStage(event.target.value); setLimit(24); }}><option value="">All levels</option>{levels.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label>Sort<select aria-label="Sort resources" value={sort} onChange={(event) => { setSort(event.target.value); setLimit(24); }}><option value="curated">Playlist order</option><option value="title">Title A–Z</option><option value="creator">Creator A–Z</option></select></label>
                {format || stage ? <button type="button" className="discover-reset" onClick={() => { setFormat(""); setStage(""); setSort("curated"); }}>Clear filters</button> : null}
              </div>
            </details>
          </div>
          <div className="discover-playlist-columns" aria-hidden="true"><span>Lesson</span><span>Creator</span><span>Format</span><span>Level</span><span /></div>
          <ol className="discover-playlist-items">
            {items.slice(0, limit).map((item) => (
              <li className="discover-playlist-row discovery-curriculum-card" key={item.id}>
                <a className="discover-lesson-title" href={item.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} on YouTube (new tab)`}>
                  <span className="discover-lesson-thumbnail">{item.thumbnailUrl ? <YouTubeThumbnail src={item.thumbnailUrl} fallbackSrc={item.thumbnailFallbackUrl} alt="" fill loading="lazy" sizes="36px" /> : <ListVideo aria-hidden="true" />}</span>
                  <strong>{item.title}</strong>
                </a>
                <span className="discover-lesson-creator" title={item.channel ?? ""}>{item.channel ?? "Independent creator"}</span>
                <span className="discover-lesson-format">{item.resourceType}</span>
                <span className="discover-lesson-level" title={item.learningStage ?? ""}>{item.learningStage ?? "All levels"}</span>
                <a className="discover-lesson-open" href={item.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} on YouTube (new tab)`}><ArrowUpRight aria-hidden="true" /></a>
              </li>
            ))}
          </ol>
          {items.length === 0 ? <div className="discover-empty"><h3>No matching lessons</h3><p>Choose another format or level.</p><button type="button" onClick={() => { setFormat(""); setStage(""); }}>Reset filters</button></div> : null}
          {limit < items.length ? <div className="discover-load-more"><button type="button" onClick={() => setLimit((value) => value + 24)}>Show more resources</button><span>Showing {Math.min(limit, items.length)} of {items.length}</span></div> : null}
          {notes.length > 0 ? <details className="discover-notes"><summary>About this collection</summary>{notes.map((item) => <p key={item.id}>{item.coverageNotes || item.title}</p>)}</details> : null}
      </section>

      {intelligencePanel}
    </main>
  );
}

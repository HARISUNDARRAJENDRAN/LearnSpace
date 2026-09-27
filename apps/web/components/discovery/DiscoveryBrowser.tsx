"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ListVideo, Play, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { CurriculumArea, CurriculumCategory } from "../../lib/discovery/curriculum";
import { browseItems } from "../../lib/discovery/browse";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";
import { CurriculumCard, DiscoveryCollections } from "./DiscoveryCurriculum";

export function DiscoveryBrowser({ areas, category }: { areas: CurriculumArea[]; category?: CurriculumCategory }) {
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState("");
  const [stage, setStage] = useState("");
  const [sort, setSort] = useState("curated");
  const [tab, setTab] = useState("explore");
  const [limit, setLimit] = useState(24);
  const filters = { topic, format, stage, sort };
  const items = browseItems(areas, filters);
  const stages = [...new Set(areas.flatMap((area) => area.categories.flatMap((entry) => entry.items.map((item) => item.learningStage))).filter((value): value is string => Boolean(value)))];
  const matchingSlugs = new Set(items.map((item) => item.categorySlug));
  const filteredAreas = areas.map((area) => ({ ...area, categories: area.categories.filter((entry) => matchingSlugs.has(entry.slug)) })).filter((area) => area.categories.length > 0);
  const collectionCount = filteredAreas.reduce((total, area) => total + area.categories.length, 0);
  const featured = areas.flatMap((area) => area.categories.slice(0, 1)).slice(0, 4);
  const cover = category?.items.find((item) => item.thumbnailUrl);
  const first = category?.items.find((item) => item.url);
  const notes = category?.items.filter((item) => !item.url) ?? [];
  const filtered = Boolean(topic || format || stage);

  function resetFilters() {
    setTopic(""); setFormat(""); setStage(""); setSort("curated"); setLimit(24);
  }

  return (
    <main className={`discovery-canvas discovery-curriculum discover-browser${category ? " discover-playlist-page" : ""}`} aria-labelledby="discover-page-heading">
      {category ? (
        <aside className="discover-playlist-summary">
          <Link className="discovery-category-back" href="/app/discover"><ArrowLeft aria-hidden="true" /> All learning playlists</Link>
          <div className="discover-playlist-cover">
            {cover?.thumbnailUrl ? <YouTubeThumbnail src={cover.thumbnailUrl} fallbackSrc={cover.thumbnailFallbackUrl} alt="" fill loading="lazy" sizes="(max-width: 800px) 90vw, 340px" /> : <ListVideo aria-hidden="true" />}
            <span><ListVideo aria-hidden="true" /> LEARNING PLAYLIST</span>
          </div>
          <p className="discover-eyebrow">{areas[0]?.name}</p>
          <h1 id="discover-page-heading">{category.name}</h1>
          <p className="discover-playlist-description">A curated route through {category.name.toLocaleLowerCase()}. Pick a lesson or work through the collection at your own pace.</p>
          <p className="discover-playlist-count">{category.items.filter((item) => item.url).length} resources · Curated by LearnSpace</p>
          {first?.url ? <a className="discover-start" href={first.url} target="_blank" rel="noreferrer"><Play aria-hidden="true" /> Start learning <span className="sr-only">on YouTube (new tab)</span></a> : null}
          <p className="discover-external-note">Videos and playlists open on YouTube.</p>
          {notes.length > 0 ? <details className="discover-notes"><summary>About this collection</summary>{notes.map((item) => <p key={item.id}>{item.coverageNotes || item.title}</p>)}</details> : null}
        </aside>
      ) : <h1 id="discover-page-heading" className="sr-only">Discover</h1>}

      <div className="discover-feed">
        {!category ? <fieldset className="discover-topics"><legend className="sr-only">Learning areas</legend>
          <button type="button" aria-pressed={!topic} onClick={() => { setTopic(""); setLimit(24); }}>All</button>
          {areas.map((area) => <button key={area.name} type="button" aria-pressed={topic === area.name} onClick={() => { setTopic(area.name); setLimit(24); }}>{area.name}</button>)}
        </fieldset> : null}

        {!category && tab === "explore" && !filtered ? <section className="discover-featured" aria-label="Featured learning playlists">
          <div className="discover-section-heading"><h2>Find your next learning playlist</h2><button type="button" onClick={() => setTab("collections")}>View all <ArrowRight aria-hidden="true" /></button></div>
          <DiscoveryCollections areas={[{ name: "Featured playlists", categories: featured }]} />
        </section> : null}

        <div className="discover-results-heading">
          <div><h2>{category ? "In this playlist" : tab === "collections" ? "Learning playlists" : filtered ? "Your results" : "Recommended for you"}</h2><p aria-live="polite">{tab === "collections" ? `${collectionCount} playlists` : `${items.length} resources`}{!filtered && !category && tab === "explore" ? " · Handpicked across your learning areas" : ""}</p></div>
          {!category && tab === "collections" ? <button type="button" className="discover-collection-back" onClick={() => setTab("explore")}><ArrowLeft aria-hidden="true" /> Back to recommendations</button> : <label className="discover-sort"><SlidersHorizontal aria-hidden="true" /><span className="sr-only">Sort resources</span><select value={sort} onChange={(event) => { setSort(event.target.value); setLimit(24); }}><option value="curated">{category ? "Playlist order" : "Curated order"}</option><option value="title">Title A–Z</option><option value="creator">Creator A–Z</option></select></label>}
        </div>
        <div className="discover-filters">
          <label>Format<select value={format} onChange={(event) => { setFormat(event.target.value); setLimit(24); }}><option value="">All formats</option><option value="video">Videos</option><option value="playlist">YouTube playlists</option></select></label>
          <label>Level<select value={stage} onChange={(event) => { setStage(event.target.value); setLimit(24); }}><option value="">All levels</option>{stages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          {filtered ? <button type="button" className="discover-reset" onClick={resetFilters}><X aria-hidden="true" /> Clear filters</button> : null}
        </div>

        {items.length === 0 ? <div className="discover-empty"><ListVideo aria-hidden="true" /><h3>No matches yet</h3><p>Try another area, format, or level, or reset your filters.</p><button type="button" onClick={resetFilters}>Reset filters</button></div> : tab === "collections" ? <DiscoveryCollections areas={filteredAreas} /> : (
          <>
            <div className={category ? "discover-playlist-items" : "home-recommendation-grid discover-video-grid"}>
              {items.slice(0, limit).map((item, index) => <div className="discover-resource" key={item.id}>
                {category ? <span className="discover-resource-index">{index + 1}</span> : null}
                <CurriculumCard item={item} />
                {!category ? <Link className="discover-resource-topic" href={`/app/discover/${item.categorySlug}`}>{item.categoryName} <ArrowRight aria-hidden="true" /></Link> : null}
              </div>)}
            </div>
            {limit < items.length ? <div className="discover-load-more"><button type="button" onClick={() => setLimit((value) => value + 24)}>Show more resources</button><span>Showing {Math.min(limit, items.length)} of {items.length}</span></div> : null}
          </>
        )}
      </div>
    </main>
  );
}

"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, FileText, Play } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { HomeSession } from "../../lib/home/service";
import { youtubeThumbnailSources } from "../../lib/home/thumbnail";
import { YouTubeThumbnail } from "./YouTubeThumbnail";

export function ContinueLearning({ sessions }: { sessions: HomeSession[] }) {
  const [filter, setFilter] = useState("All");
  const list = useRef<HTMLElement>(null);
  const items = sessions.filter((item) => filter === "All" || (filter === "Completed" ? item.completed : !item.completed));
  function changeFilter(value: string) {
    setFilter(value);
    list.current?.scrollTo({ left: 0 });
  }
  return <section className="home-continue" aria-labelledby="home-continue-title">
    <div className="home-section-heading"><h2 id="home-continue-title">Continue Learning</h2><Link href="/app/sessions">View All <ArrowUpRight aria-hidden="true" /></Link></div>
    <div className="home-continue-controls">
      <fieldset className="home-filters"><legend className="sr-only">Learning status</legend>{["All", "In Progress", "Completed"].map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{value}</button>)}</fieldset>
      <div className="home-carousel-controls"><button type="button" aria-label="Previous learning cards" onClick={() => list.current?.scrollBy({ left: -list.current.clientWidth })}><ChevronLeft aria-hidden="true" /></button><button type="button" aria-label="Next learning cards" onClick={() => list.current?.scrollBy({ left: list.current.clientWidth })}><ChevronRight aria-hidden="true" /></button></div>
    </div>
    <section className="home-session-list" ref={list} aria-live="polite" tabIndex={items.length > 3 ? 0 : undefined} aria-label="Learning and research sessions">
      {items.map((item, index) => {
        const thumbnails = youtubeThumbnailSources(item.youtubeId);
        const progress = Math.round(item.progressPct);
        return <Link className="home-session-card" key={item.id} href={`/app/study/${item.type}/${item.id}`} title={item.title}>
          <div className={`home-session-media home-session-media--${item.type}`}>
            {item.type === "video" ? <YouTubeThumbnail src={thumbnails?.primary ?? ""} fallbackSrc={thumbnails?.fallback ?? null} alt="" fill loading={index < 3 ? "eager" : "lazy"} sizes="(max-width: 600px) 70vw, (max-width: 1050px) 30vw, 20vw" /> : <div className="home-paper-preview" aria-hidden="true"><span>{item.source}</span><strong>{item.title}</strong><p>{item.description ?? "Open this paper to continue reading."}</p></div>}
            <span className="home-card-progress">{progress}%</span>
          </div>
          <h3>{item.title}</h3>
          <div className="home-session-meta">{item.type === "video" ? <Play aria-hidden="true" /> : <FileText aria-hidden="true" />}<span>{item.type === "video" ? "Learn" : "Research"} · {item.source}</span></div>
          <progress value={progress} max={100} aria-label={`Progress for ${item.title}`} />
        </Link>;
      })}
      {items.length === 0 ? <div className="home-empty"><strong>{sessions.length === 0 ? "Your learning starts here." : `No ${filter.toLowerCase()} sessions yet.`}</strong><p>Videos and research papers you study will appear here.</p><Link href="/app/discover">Explore Discover <ArrowUpRight aria-hidden="true" /></Link></div> : null}
    </section>
  </section>;
}

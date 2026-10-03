"use client";

import type { DiscoveryCard, DiscoveryHomeResponse, DiscoverySurface } from "@learnspace/shared";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bookmark, Play } from "lucide-react";
import { StartStudyButton } from "../study/StudyActions";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return null;
  const minutes = Math.round(durationMs / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function DiscoveryCardView({ card, surface }: { card: DiscoveryCard; surface: DiscoverySurface }) {
  const ref = useRef<HTMLElement>(null);
  const isContinue = card.reasonCodes.includes("continue_learning");

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let sent = false;
    let attempts = 0;
    const controller = new AbortController();
    async function send() {
      if (sent || !visible || document.visibilityState !== "visible") return;
      attempts += 1;
      try {
        const response = await fetch("/api/v1/discovery/impressions", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ runId: card.runId, resourceId: card.resourceId, position: card.position, surface, visibleDurationMs: 1000 }),
        });
        if (!response.ok) throw new Error("Impression not recorded");
        sent = true;
      } catch {
        if (!controller.signal.aborted && attempts < 2 && visible) timer = setTimeout(() => void send(), 3000);
      }
    }
    function schedule() {
      clearTimeout(timer);
      if (visible && !sent && document.visibilityState === "visible") timer = setTimeout(() => void send(), 1000);
    }
    const observer = new IntersectionObserver((entries) => { visible = (entries[0]?.intersectionRatio ?? 0) >= .5; schedule(); }, { threshold: .5 });
    observer.observe(element);
    document.addEventListener("visibilitychange", schedule);
    return () => { clearTimeout(timer); controller.abort(); observer.disconnect(); document.removeEventListener("visibilitychange", schedule); };
  }, [card.position, card.resourceId, card.runId, surface]);

  return (
    <article className="discovery-card" ref={ref}>
      {card.thumbnailUrl ? <YouTubeThumbnail className="discovery-card-image" src={card.thumbnailUrl} alt="" width={640} height={400} loading="lazy" /> : <div className="discovery-card-art" aria-hidden="true"><Play /></div>}
      <div className="discovery-card-content">
        <div className="discovery-card-meta">{card.author ? <span>{card.author}</span> : null}{formatDuration(card.durationMs) ? <span>{formatDuration(card.durationMs)}</span> : null}</div>
        <h3>{card.title}</h3>
        <p className="discovery-card-reason">{card.reason}</p>
        <div className="discovery-card-actions">
          <StartStudyButton resourceId={card.resourceId} origin="discover" recommendationRunId={card.runId} label={isContinue ? "Continue" : "Start learning"} className="discovery-start-button" />
          <button className="discovery-bookmark-button" type="button" aria-label={`Bookmark ${card.title} (coming soon)`} title="Bookmarking coming soon" disabled><Bookmark aria-hidden="true" size={18} strokeWidth={1.8} /></button>
        </div>
      </div>
    </article>
  );
}

export function DiscoveryFeed({ feed, surface = "discover", full = false, topicNavigation }: { feed: DiscoveryHomeResponse | null; surface?: DiscoverySurface; full?: boolean; topicNavigation?: ReactNode }) {
  const recommendations = feed?.sections.recommendedVideos ?? [];
  const cards = full ? recommendations : recommendations.slice(0, 6);
  const Heading = full ? "h1" : "h2";
  const context = feed?.personalization === "learning" ? "Shaped by what you've been learning" : feed?.personalization === "interests" ? "Selected for your interests" : "Find your next lesson";
  return (
    <section className={`discover-recommended-feed${full ? " discover-recommended-feed--full" : ""}`} aria-labelledby="discover-recommended-heading">
      <div className="discovery-section-heading"><div><Heading id="discover-recommended-heading">Recommended for you</Heading><p className="discover-recommendation-context">{context}</p></div>{!full ? <Link href="/app/discover/for-you" className="discover-recommendations-link" aria-label="See all recommendations" title="See all recommendations" prefetch={false}><ArrowRight aria-hidden="true" /></Link> : null}</div>
      {topicNavigation}
      {cards.length ? <div className={`discovery-card-grid${full ? " discovery-recommendations-full-grid" : " discovery-recommendations-grid"}`}>{cards.map((card) => <DiscoveryCardView key={`${card.runId}-${card.resourceId}-${card.position}`} card={card} surface={surface} />)}</div> : <p className="discover-recommendation-empty">{feed ? "Explore a collection below while we find more lessons that fit you." : "Recommendations are unavailable right now. Explore a collection below."}</p>}
    </section>
  );
}

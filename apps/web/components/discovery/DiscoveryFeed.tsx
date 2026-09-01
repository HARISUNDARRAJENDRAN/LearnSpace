"use client";

import type { DiscoveryAction, DiscoveryCard, DiscoveryHomeResponse, DiscoverySurface } from "@learnspace/shared";
import { useEffect, useRef, useState } from "react";

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  const minutes = Math.round(durationMs / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function DiscoveryCardView({ card, surface, onDismiss }: { card: DiscoveryCard; surface: DiscoverySurface; onDismiss: (resourceId: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [action, setAction] = useState<DiscoveryAction | null>(null);
  const [message, setMessage] = useState("");
  const isContinue = card.reasonCodes.includes("continue_learning");

  useEffect(() => {
    if (!ref.current || !card.runId || isContinue || typeof IntersectionObserver === "undefined") return;
    let sent = false;
    const observer = new IntersectionObserver((entries) => {
      if (sent || !entries[0]?.isIntersecting) return;
      sent = true;
      void fetch("/api/v1/discovery/impressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: card.runId, resourceId: card.resourceId, position: card.position, surface }),
      });
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [card.position, card.resourceId, card.runId, isContinue, surface]);

  async function interact(nextAction: DiscoveryAction) {
    setAction(nextAction);
    setMessage("");
    try {
      const response = await fetch("/api/v1/discovery/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: card.resourceId, runId: card.runId, action: nextAction, correlationId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error("interaction failed");
      setMessage(nextAction === "save" ? "Saved to your library" : nextAction === "dismiss" ? "Removed from recommendations" : "Opening resource");
      if (nextAction === "dismiss") onDismiss(card.resourceId);
    } catch {
      setMessage("Could not save that action");
    } finally {
      setAction(null);
    }
  }

  const date = formatDate(card.publishedAt);
  const duration = formatDuration(card.durationMs);
  return (
    <article className="discovery-card" ref={ref}>
      {card.thumbnailUrl ? <img className="discovery-card-image" src={card.thumbnailUrl} alt="" loading="lazy" /> : <div className={`discovery-card-art discovery-card-art-${card.type}`} aria-hidden="true"><span>{card.type === "paper" ? "Research" : "Watch"}</span></div>}
      <div className="discovery-card-content">
        <div className="discovery-card-meta"><span>{card.type === "paper" ? "Paper" : "Video"}</span>{card.author ? <span>{card.author}</span> : null}{duration ? <span>{duration}</span> : null}{date ? <span>{date}</span> : null}</div>
        <h3>{card.title}</h3>
        {card.description ? <p>{card.description}</p> : null}
        <p className="discovery-card-reason">{card.reason}</p>
        <div className="discovery-card-actions">
          {card.url ? <a className="discovery-open-link" href={card.url} target="_blank" rel="noreferrer" onClick={() => void interact("open")}>Open <span aria-hidden="true">↗</span></a> : null}
          <button type="button" onClick={() => void interact("save")} disabled={action !== null}>{action === "save" ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => void interact("dismiss")} disabled={action !== null}>{action === "dismiss" ? "Removing…" : "Dismiss"}</button>
        </div>
        <span className="sr-only" aria-live="polite">{message}</span>
      </div>
    </article>
  );
}

function Section({ title, description, cards, surface, onDismiss }: { title: string; description: string; cards: DiscoveryCard[]; surface: DiscoverySurface; onDismiss: (resourceId: string) => void }) {
  const sectionId = `section-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section className="discovery-section" aria-labelledby={sectionId}>
      <div className="discovery-section-heading"><div><p className="application-eyebrow">LearnSpace</p><h2 id={sectionId}>{title}</h2></div><p>{description}</p></div>
      {cards.length > 0 ? <div className="discovery-card-grid">{cards.map((card) => <DiscoveryCardView key={`${card.runId}-${card.resourceId}-${card.position}`} card={card} surface={surface} onDismiss={onDismiss} />)}</div> : <div className="discovery-empty"><span className="discovery-empty-mark" aria-hidden="true">○</span><p>Nothing here yet.</p><span>As your library and learning sessions grow, this space will follow along.</span></div>}
    </section>
  );
}

export function DiscoveryFeed({ feed, surface, firstName }: { feed: DiscoveryHomeResponse; surface: DiscoverySurface; firstName: string }) {
  const [dismissedResourceIds, setDismissedResourceIds] = useState<Set<string>>(() => new Set());
  const dismiss = (resourceId: string) => setDismissedResourceIds((current) => new Set(current).add(resourceId));
  const visible = (cards: DiscoveryCard[]) => cards.filter((card) => !dismissedResourceIds.has(card.resourceId));
  return (
    <main className="discovery-page">
      <div className="discovery-page-intro"><div><p className="application-eyebrow">Your learning space</p><h1>Good to see you, {firstName}.</h1><p>A considered place for the next thing worth learning.</p></div><div className="discovery-feed-status" data-stale={feed.stale ? "true" : "false"}>{feed.stale ? "Showing your last good feed" : "Personalized from your interests"}</div></div>
      {feed.sections.interests.length > 0 ? <section className="discovery-interests" aria-labelledby="interest-heading"><div><p className="application-eyebrow">Your starting point</p><h2 id="interest-heading">Explore your interests</h2></div><div className="discovery-interest-list">{feed.sections.interests.map((interest) => <span className="discovery-interest-chip" key={interest.id}>{interest.name}</span>)}</div></section> : null}
      <Section title="Continue learning" description="Your active sessions, when you have one in motion." cards={visible(feed.sections.continueLearning)} surface={surface} onDismiss={dismiss} />
      <Section title="Recommended videos" description="A short list shaped by your concepts, level, and learning style." cards={visible(feed.sections.recommendedVideos)} surface={surface} onDismiss={dismiss} />
      <Section title="Research worth reading" description="Current and foundational papers, ranked separately from videos." cards={visible(feed.sections.researchPapers)} surface={surface} onDismiss={dismiss} />
      <Section title="Fresh for you" description="Recently added resources that clear the quality floor." cards={visible(feed.sections.freshForYou)} surface={surface} onDismiss={dismiss} />
    </main>
  );
}

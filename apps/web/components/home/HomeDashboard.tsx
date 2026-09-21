import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, MoreHorizontal, Play, Sparkles } from "lucide-react";
import type { DiscoveryCard, DiscoveryHomeResponse } from "@learnspace/shared";
import type { LearnHomeData } from "../../lib/home/service";
import { StartStudyButton } from "../study/StudyActions";
import { YouTubeThumbnail } from "./YouTubeThumbnail";
import { youtubeThumbnailFallback, youtubeThumbnailSources } from "../../lib/home/thumbnail";

type HomeSession = Awaited<ReturnType<typeof import("../../lib/study/service").listStudySessions>>[number];

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return "Self-paced";
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function CompletionGauge({ progress }: { progress: number }) {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="home-progress-gauge" role="img" aria-label={`${value}% complete`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <circle className="home-progress-track" cx="50" cy="50" r={radius} />
        <circle className="home-progress-value" cx="50" cy="50" r={radius} strokeDasharray={`${(circumference * value) / 100} ${circumference}`} transform="rotate(-90 50 50)" />
      </svg>
      <span className="home-progress-copy">{value}%</span>
    </div>
  );
}

function ContinueLearningCard({ item }: { item: LearnHomeData["continueWatching"] }) {
  if (!item) {
    return (
      <div className="home-continue-empty">
        <span className="home-empty-icon" aria-hidden="true"><BookOpen /></span>
        <div>
          <p className="home-card-kicker">A clear desk</p>
          <h3>Your next lesson is waiting.</h3>
          <p>Start a topic and LearnSpace will remember exactly where you left off.</p>
        </div>
        <Link className="home-outline-link" href="/app/discover">Explore lessons <ArrowRight aria-hidden="true" /></Link>
      </div>
    );
  }

  const title = item.title.replace(/\s*[-–—|]\s*YouTube\s*$/i, "").split(/\s+[-–—]\s+|\s*\|\s*/)[0]?.trim() || item.title;
  return (
    <article className="home-continue-card">
      <div className="home-continue-media">
        {item.thumbnailUrl ? <YouTubeThumbnail src={item.thumbnailUrl} fallbackSrc={item.thumbnailFallbackUrl} alt="" fill priority sizes="(max-width: 920px) 100vw, 42vw" /> : <div className="home-media-placeholder" aria-hidden="true"><Play /></div>}
      </div>
      <CompletionGauge progress={item.progressPct} />
      <div className="home-continue-details">
        <h3 title={item.title}>{title}</h3>
        <div className="home-continue-actions">
          <span className="home-resume-control"><Play aria-hidden="true" /><StartStudyButton resourceId={item.resourceId} origin="home" label="Resume" className="home-primary-action" /></span>
          <details className="home-hero-menu">
            <summary aria-label="More lesson options"><MoreHorizontal aria-hidden="true" /></summary>
            <div><a href={`https://www.youtube.com/watch?v=${item.youtubeId}`} target="_blank" rel="noopener noreferrer">View on YouTube</a></div>
          </details>
        </div>
      </div>
    </article>
  );
}

function HistoryItem({ session }: { session: HomeSession }) {
  const resource = session.activeResource;
  const type = resource?.type === "paper" ? "Research" : "Learning";
  const youtubeId = resource?.type === "video" ? resource.youtubeId : null;
  const thumbnail = youtubeThumbnailSources(youtubeId);
  return (
    <Link className="home-history-item" href={session.route ?? "/app/sessions"}>
      <span className="home-history-thumb" aria-hidden="true">
        {thumbnail ? <YouTubeThumbnail src={thumbnail.primary} fallbackSrc={thumbnail.fallback} alt="" fill sizes="58px" /> : <span className={`home-history-icon home-history-icon-${resource?.type ?? "session"}`}>{resource?.type === "paper" ? "P" : "V"}</span>}
      </span>
      <span className="home-history-copy">
        <strong>{resource?.title ?? session.title}</strong>
        <small>{type} · {formatRelativeTime(session.lastActiveAt)}</small>
      </span>
      <span className="home-history-play" aria-hidden="true">
        {resource?.type === "video" ? <Play className="home-history-play-icon" /> : <ArrowRight />}
      </span>
    </Link>
  );
}

function RecommendationCard({ card }: { card: DiscoveryCard }) {
  return (
    <article className="home-recommendation-card">
      <div className="home-recommendation-media">
        {card.thumbnailUrl ? <YouTubeThumbnail src={card.thumbnailUrl} fallbackSrc={youtubeThumbnailFallback(card.thumbnailUrl)} alt="" fill sizes="(max-width: 640px) 100vw, (max-width: 1040px) 50vw, 25vw" /> : <div className="home-media-placeholder" aria-hidden="true"><Sparkles /></div>}
        <span className="home-recommendation-play" aria-hidden="true"><Play /></span>
        <StartStudyButton resourceId={card.resourceId} origin="home" recommendationRunId={card.runId} label={`Play ${card.title}`} className="home-recommendation-action" />
      </div>
      <div className="home-recommendation-copy">
        <h3>{card.title}</h3>
        <div className="home-card-meta">{card.author ? <span>{card.author}</span> : null}<span>{formatDuration(card.durationMs)}</span></div>
        <p>{card.reason}</p>
      </div>
    </article>
  );
}

export function HomeDashboard({ home, feed, sessions }: { home: LearnHomeData; feed: DiscoveryHomeResponse; sessions: HomeSession[] }) {
  const recentSessions = sessions.slice(0, 5);
  const recommendations = feed.sections.recommendedVideos.slice(0, 4);
  return (
    <main className="home-canvas home-dashboard" aria-labelledby="home-dashboard-title">
      <h1 id="home-dashboard-title" className="sr-only">Your learning Home</h1>

      <div className="home-dashboard-grid">
        <section className="home-dashboard-section" aria-labelledby="continue-learning-heading">
          <div className="home-section-heading"><h2 id="continue-learning-heading">Continue Learning</h2></div>
          <ContinueLearningCard item={home.continueWatching} />
        </section>

        <section className="home-history-section" aria-labelledby="recent-history-heading">
          <div className="home-history">
            <div className="home-history-heading"><h2 id="recent-history-heading">Recent History</h2><Link href="/app/sessions">View all</Link></div>
            {recentSessions.length > 0 ? <div className="home-history-list">{recentSessions.map((session) => <HistoryItem key={session.id} session={session} />)}</div> : <div className="home-history-empty"><Clock3 aria-hidden="true" /><p>Your learning history will appear here.</p></div>}
          </div>
        </section>
      </div>

      <section className="home-recommendations" aria-labelledby="you-might-like-heading">
        <div className="home-section-heading"><h2 id="you-might-like-heading">You Might Like</h2><Link href="/app/discover">See all <ArrowRight aria-hidden="true" /></Link></div>
        {recommendations.length > 0 ? <div className="home-recommendation-grid">{recommendations.map((card) => <RecommendationCard key={`${card.runId}-${card.resourceId}`} card={card} />)}</div> : <div className="home-recommendations-empty"><Sparkles aria-hidden="true" /><p>Recommendations will take shape as your learning space grows.</p><Link className="home-outline-link" href="/app/discover">Browse Discover <ArrowRight aria-hidden="true" /></Link></div>}
      </section>
    </main>
  );
}

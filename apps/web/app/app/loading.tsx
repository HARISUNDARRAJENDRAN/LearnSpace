import type { ReactNode } from "react";

function SkeletonCard({ area, children }: { area: string; children: ReactNode }) {
  return <section className={`analytics-card analytics-${area} home-skeleton-card`} aria-hidden="true">
    <header className="analytics-card-header">
      <span className="analytics-heading-icon" />
      <span className="home-skeleton-block home-skeleton-heading" />
    </header>
    {children}
  </section>;
}

export default function ApplicationLoading() {
  return <main className="home-dashboard home-dashboard-loading" aria-label="Loading Home dashboard" aria-busy="true">
    <div className="home-analytics-grid">
      <SkeletonCard area="overview">
        <div className="home-loading-overview">
          <div className="home-loading-metric"><span className="home-skeleton-block home-skeleton-badge" /><span className="home-skeleton-block home-skeleton-metric" /><span className="home-skeleton-block home-skeleton-copy" /></div>
          <div className="home-loading-bars">{[58, 68, 100, 78].map((height) => <span className="home-skeleton-block" style={{ height: `${height}%` }} key={height} />)}</div>
        </div>
      </SkeletonCard>
      <SkeletonCard area="distribution">
        <div className="home-loading-bubbles"><span className="home-skeleton-block is-large" /><span className="home-skeleton-block is-medium" /><span className="home-skeleton-block is-small" /><span className="home-skeleton-block is-tiny" /></div>
        <div className="home-loading-stats">{[0, 1, 2, 3].map((item) => <span className="home-skeleton-block" key={item} />)}</div>
      </SkeletonCard>
      <SkeletonCard area="progress">
        <div className="home-loading-progress"><span className="home-skeleton-block home-loading-donut" /><div>{[0, 1, 2].map((item) => <span className="home-skeleton-block" key={item} />)}</div></div>
      </SkeletonCard>
      <SkeletonCard area="continue">
        <div className="home-loading-continue"><span className="home-skeleton-block home-loading-media" /><span className="home-skeleton-block home-skeleton-title" /><span className="home-skeleton-block home-skeleton-meta" /><span className="home-skeleton-block home-skeleton-progress" /></div>
      </SkeletonCard>
      <SkeletonCard area="trends">
        <div className="home-loading-trend-legend">{[0, 1, 2].map((item) => <span className="home-skeleton-block" key={item} />)}</div>
        <div className="home-skeleton-block home-loading-trend-plot" />
      </SkeletonCard>
    </div>
  </main>;
}

import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Play,
} from "lucide-react";
import type { DiscoveryHomeResponse } from "@learnspace/shared";
import type { CurriculumArea, CurriculumCategory } from "../../lib/discovery/curriculum";
import { hasBrowsableResources } from "../../lib/discovery/browse";
import { categoryVisual } from "../../lib/discovery/category-visual";
import type { PopularResource } from "../../lib/discovery/popular";
import { StartStudyButton } from "../study/StudyActions";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";
import { youtubeThumbnailSources } from "../../lib/home/thumbnail";
import { DiscoveryFeed } from "./DiscoveryFeed";

type SectionSpec = {
  id: string;
  title: string;
  subtitle: string;
  areaSlug: string;
};

const areaSubtitles: Record<string, string> = {
  "Technology & Computing": "Build in-demand skills for the future.",
  "Science & Mathematics": "Explore how the world works.",
  "Business & Entrepreneurship": "Turn ideas into impact.",
  "Career & Professional Development": "Invest in your future.",
  "Design, Creativity & Making": "Bring ideas to life.",
  "Humanities, Society & Ideas": "Understand people, society and the bigger picture.",
  "Health, Lifestyle & Wellbeing": "A healthier, happier, more balanced you.",
  "Personalized Discovery": "Explore topics selected for your learning journey.",
};

function resourceCount(category: CurriculumCategory): number {
  return category.items.filter((item) => item.url).length;
}

function SectionHeading({ section }: { section: SectionSpec }) {
  return (
    <div className="discover-section-heading">
      <div>
        <h2 id={`discover-${section.id}`}>{section.title}</h2>
        <p>{section.subtitle}</p>
      </div>
      <Link href={`/app/discover?area=${section.areaSlug}`} className="discover-view-all">View all <ArrowRight aria-hidden="true" /></Link>
    </div>
  );
}

function DiscoverCategoryCard({ category }: { category: CurriculumCategory }) {
  const visual = categoryVisual(category.slug);
  return (
    <Link
      className="discover-category-card"
      href={`/app/discover/${category.slug}`}
      aria-label={`${category.name}, ${resourceCount(category)} resources`}
      style={{
        "--category-hue": `${visual.hue}deg`,
        "--category-hue-end": `${visual.endHue}deg`,
        "--category-angle": `${visual.angle}deg`,
        "--category-focus-x": `${visual.x}%`,
        "--category-focus-y": `${visual.y}%`,
      } as CSSProperties}
    >
      <span className={`discover-category-art discovery-curriculum-category-gradient discovery-curriculum-category-gradient-style-${visual.style}`} aria-hidden="true" />
      <span className="discover-category-details">
        <span className="discover-category-copy">
          <strong>{category.name}</strong>
          <small>{resourceCount(category)} resources</small>
        </span>
        <ArrowRight className="discover-category-arrow" aria-hidden="true" />
      </span>
    </Link>
  );
}

function CategorySection({ section, categories }: { section: SectionSpec; categories: CurriculumCategory[] }) {
  if (categories.length === 0) return null;
  return (
    <section className="discover-category-section" aria-labelledby={`discover-${section.id}`}>
      <SectionHeading section={section} />
      <div className="discover-category-grid">
        {categories.map((category) => <DiscoverCategoryCard key={category.slug} category={category} />)}
      </div>
    </section>
  );
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes}:00`;
}

function formatViews(views: number): string {
  return `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(views)} views`;
}

function relativeDate(value: Date | null): string {
  if (!value) return "Recently";
  const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 30) return `${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? "week" : "weeks"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} ${Math.floor(days / 30) === 1 ? "month" : "months"} ago`;
  return `${Math.floor(days / 365)} ${Math.floor(days / 365) === 1 ? "year" : "years"} ago`;
}

function PopularResourceCard({ resource }: { resource: PopularResource }) {
  const thumbnails = youtubeThumbnailSources(resource.youtubeId);
  const duration = formatDuration(resource.durationMs);
  return (
    <article className="discover-popular-card">
      <div className="discover-popular-media">
        {thumbnails ? <YouTubeThumbnail src={thumbnails.primary} fallbackSrc={thumbnails.fallback} alt="" fill loading="lazy" sizes="(max-width: 560px) 100vw, (max-width: 1000px) 50vw, 25vw" /> : <span className="discover-popular-placeholder"><Play aria-hidden="true" /></span>}
        {duration ? <span className="discover-popular-duration">{duration}</span> : null}
        <StartStudyButton resourceId={resource.resourceId} origin="discover" label={`Play ${resource.title}`} className="discover-popular-action" />
      </div>
      <h3>{resource.title}</h3>
      <div className="discover-popular-provider"><Play aria-hidden="true" /><span>{resource.channelTitle ?? "YouTube"}</span></div>
      <p>{formatViews(resource.viewCount)} <span aria-hidden="true">·</span> {relativeDate(resource.publishedAt ?? resource.metricsCapturedAt)}</p>
    </article>
  );
}

function PopularResources({ resources, unavailable, expanded }: { resources: PopularResource[]; unavailable: boolean; expanded: boolean }) {
  return (
    <section id="popular-resources" className="discover-popular-section" aria-labelledby="discover-popular-heading">
      <div className="discover-section-heading">
        <div>
          <h2 id="discover-popular-heading">Popular resources</h2>
          <p>Popular videos with recently updated view counts.</p>
        </div>
        <Link href="/app/discover?view=popular#popular-resources" className="discover-view-all">{expanded ? "All resources" : "View all"} <ArrowRight aria-hidden="true" /></Link>
      </div>
      {unavailable ? (
        <p className="discover-inline-state">Popular resources are temporarily unavailable. <Link href="/app/discover#popular-resources">Retry</Link></p>
      ) : resources.length > 0 ? (
        <div className="discover-popular-grid">{resources.map((resource) => <PopularResourceCard key={resource.resourceId} resource={resource} />)}</div>
      ) : (
        <p className="discover-inline-state">Fresh view-count data is not available yet.</p>
      )}
    </section>
  );
}

function AllAreaCategories({ area }: { area: CurriculumArea }) {
  return (
    <>
      <Link className="discover-back-link" href="/app/discover">← Back to Discover</Link>
      <section className="discover-all-area" aria-labelledby="discover-all-area-heading">
        <div className="discover-section-heading">
          <div><h2 id="discover-all-area-heading">{area.name}</h2><p>Browse every learning category in this area.</p></div>
        </div>
        <div className="discover-all-category-list">
          {area.categories.filter(hasBrowsableResources).map((category) => (
            <Link className="discover-all-category" href={`/app/discover/${category.slug}`} key={category.slug}>
              <span>{category.name}</span><small>{resourceCount(category)} resources</small><ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

export function DiscoverLanding({
  areas,
  feed,
  popular = [],
  popularUnavailable = false,
  expandedPopular = false,
  selectedArea = null,
}: {
  areas: CurriculumArea[];
  feed?: DiscoveryHomeResponse;
  popular?: PopularResource[];
  popularUnavailable?: boolean;
  expandedPopular?: boolean;
  selectedArea?: CurriculumArea | null;
}) {
  const sections = areas.map((area, index) => ({
    id: `discover-area-${index}`,
    title: area.name,
    subtitle: areaSubtitles[area.name] ?? "Explore curated learning resources.",
    areaSlug: area.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    categories: area.categories.filter(hasBrowsableResources),
  }));
  const resolvedFeed = feed ?? {
    runId: null,
    generatedAt: new Date().toISOString(),
    stale: true,
    sections: { continueLearning: [], recommendedVideos: [], researchPapers: [], freshForYou: [], interests: [] },
  };

  return (
    <main className="discovery-canvas discovery-curriculum discover-home">
      {selectedArea ? (
        <AllAreaCategories area={selectedArea} />
      ) : (
        <>
          {sections.slice(0, 4).map((section) => <CategorySection section={section} categories={section.categories} key={section.id} />)}
          <div className="discover-section-pair">
            {sections.slice(4, 6).map((section) => <CategorySection section={section} categories={section.categories} key={section.id} />)}
          </div>
          {sections.slice(6).map((section) => <CategorySection section={section} categories={section.categories} key={section.id} />)}
          <DiscoveryFeed feed={resolvedFeed} surface="discover" />
          <PopularResources resources={popular} unavailable={popularUnavailable} expanded={expandedPopular} />
        </>
      )}
    </main>
  );
}

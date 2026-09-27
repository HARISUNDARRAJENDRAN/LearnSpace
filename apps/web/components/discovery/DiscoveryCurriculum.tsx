import Link from "next/link";
import type { CSSProperties } from "react";
import { ListVideo, Play } from "lucide-react";
import { YouTubeThumbnail } from "../home/YouTubeThumbnail";
import type { CurriculumArea, CurriculumItem } from "../../lib/discovery/curriculum";
import { hasBrowsableResources } from "../../lib/discovery/browse";
import { categoryVisual } from "../../lib/discovery/category-visual";

function headingId(prefix: string, value: string): string {
  return `${prefix}-${value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
}

function resourceLabel(resourceType: string): string {
  if (resourceType === "dynamic-rule") return "Curated rule";
  return resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
}

export function CurriculumCard({ item }: { item: CurriculumItem }) {
  return (
    <article className="home-recommendation-card discovery-curriculum-card">
      <div className="home-recommendation-media discovery-curriculum-media">
        {item.thumbnailUrl ? (
          <YouTubeThumbnail
            src={item.thumbnailUrl}
            fallbackSrc={item.thumbnailFallbackUrl}
            alt=""
            fill
            loading="lazy"
            sizes="(max-width: 640px) 100vw, (max-width: 1040px) 50vw, 25vw"
          />
        ) : (
          <div className={`home-media-placeholder discovery-curriculum-placeholder discovery-curriculum-placeholder-${item.resourceType}`} aria-hidden="true">
            <ListVideo aria-hidden="true" />
            <span>{item.track || item.title}</span>
          </div>
        )}
        <span className="discover-media-badge">{resourceLabel(item.resourceType)}</span>
        {item.url ? <a className="discover-media-play" href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} on YouTube (new tab)`}><Play aria-hidden="true" /></a> : null}
      </div>
      <div className="home-recommendation-copy discovery-curriculum-copy">
        <div className="home-card-meta discovery-curriculum-meta">
          <span>{resourceLabel(item.resourceType)}</span>
          {item.learningStage ? <span>{item.learningStage}</span> : null}
          {item.curriculumRole ? <span>{item.curriculumRole}</span> : null}
        </div>
        <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
        {item.channel ? <p>{item.channel}</p> : null}
        {item.track ? <p className="discovery-curriculum-track">{item.track}</p> : null}
        {item.coverageNotes ? <p className="discovery-curriculum-notes">{item.coverageNotes}</p> : null}
        {item.url ? (
          <a className="discovery-curriculum-link" href={item.url} target="_blank" rel="noreferrer">
            {item.resourceType === "playlist" ? "Open playlist" : "Watch on YouTube"} <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="discovery-curriculum-dynamic">Personalized surface</span>
        )}
      </div>
    </article>
  );
}

export function DiscoveryCollections({ areas }: { areas: CurriculumArea[] }) {
  return (
    <div className="discovery-curriculum-areas">
        {areas.map((area) => {
          const areaId = headingId("discover-area", area.name);
          const areaResourceCount = area.categories.reduce((total, category) => total + category.items.filter((item) => item.url).length, 0);
          return (
            <section className="discovery-curriculum-area" key={area.name} aria-labelledby={areaId}>
              <div className="discovery-curriculum-area-heading">
                <div>
                  <h2 id={areaId}>{area.name}</h2>
                </div>
                <span>{areaResourceCount} resources</span>
              </div>

              <div className="discovery-curriculum-categories">
                {area.categories.filter(hasBrowsableResources).map((category) => {
                  const visual = categoryVisual(category.slug);
                  const cover = category.items.find((item) => item.thumbnailUrl);
                  const coverUrl = cover?.thumbnailUrl;
                  return (
                    <Link
                      className="discovery-curriculum-category-link"
                      key={category.slug}
                      href={`/app/discover/${category.slug}`}
                      aria-label={category.name}
                      style={{
                        "--category-hue": `${visual.hue}deg`,
                        "--category-hue-end": `${visual.endHue}deg`,
                        "--category-angle": `${visual.angle}deg`,
                        "--category-focus-x": `${visual.x}%`,
                        "--category-focus-y": `${visual.y}%`,
                      } as CSSProperties}
                    >
                      <span className={`discovery-curriculum-category-gradient discovery-curriculum-category-gradient-style-${visual.style}${coverUrl ? " discovery-curriculum-category-gradient--thumbnail" : ""}`} aria-hidden="true">
                        {coverUrl ? <YouTubeThumbnail src={coverUrl} fallbackSrc={cover?.thumbnailFallbackUrl} alt="" fill sizes="(max-width: 640px) 50vw, (max-width: 1040px) 33vw, 33vw" /> : null}
                        <span className="discover-category-title-overlay">{category.name}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}

import Link from "next/link";
import type { DiscoveryHomeResponse } from "@learnspace/shared";
import { DiscoveryFeed } from "./DiscoveryFeed";
import type { CurriculumArea } from "../../lib/discovery/curriculum";
import { hasBrowsableResources } from "../../lib/discovery/browse";
import { DiscoverTopics } from "./DiscoverTopics";

// Areas named "School · …" and "University · …" belong to that stage; the rest are self-directed interests.
const levels = [
  { key: "school", label: "School", prefix: "School · " },
  { key: "university", label: "University", prefix: "University · " },
  { key: "interests", label: "Skills & interests", prefix: "" },
] as const;
const levelOf = (name: string) => levels.find((level) => level.prefix && name.startsWith(level.prefix)) ?? levels[2];

export function DiscoverLanding({
  areas,
  feed,
  recommendationsEnabled = true,
  selectedArea = null,
  level = "school",
}: {
  areas: CurriculumArea[];
  feed?: DiscoveryHomeResponse | null;
  recommendationsEnabled?: boolean;
  selectedArea?: CurriculumArea | null;
  level?: string;
}) {
  const sections = areas.map((area, index) => ({
    name: selectedArea ? area.name : area.name.slice(levelOf(area.name).prefix.length),
    level: levelOf(area.name).key as string,
    tone: index % 7,
    slug: area.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    categories: area.categories.filter(hasBrowsableResources).map((category) => ({
      slug: category.slug,
      name: category.name,
      count: category.items.filter((item) => item.url).length,
    })),
  })).filter((section) => section.categories.length > 0);
  const current = sections.some((section) => section.level === level) ? level : sections[0]?.level;

  return (
    <main className="discovery-canvas discovery-curriculum discover-home">
      {selectedArea ? <Link className="discover-back-link" href="/app/discover">← Back to Discover</Link> : null}
      {!selectedArea && recommendationsEnabled ? <DiscoveryFeed key={feed?.runId ?? "unavailable"} feed={feed ?? null} /> : null}
      {selectedArea ? null : (
        <nav className="discover-level-switch" aria-label="Learning stage">
          {levels.map((option) => {
            const count = sections.filter((section) => section.level === option.key).reduce((total, section) => total + section.categories.length, 0);
            return count ? <Link key={option.key} href={`/app/discover?level=${option.key}`} scroll={false} aria-current={current === option.key ? "page" : undefined}>{option.label}<span>{count}</span></Link> : null;
          })}
        </nav>
      )}
      <DiscoverTopics sections={selectedArea ? sections.filter((section) => section.name === selectedArea.name) : sections.filter((section) => section.level === current)} shelves={!selectedArea} />
    </main>
  );
}

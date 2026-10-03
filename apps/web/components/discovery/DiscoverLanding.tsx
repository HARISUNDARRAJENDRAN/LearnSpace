import Link from "next/link";
import type { DiscoveryHomeResponse } from "@learnspace/shared";
import { DiscoveryFeed } from "./DiscoveryFeed";
import type { CurriculumArea } from "../../lib/discovery/curriculum";
import { hasBrowsableResources } from "../../lib/discovery/browse";
import { DiscoverTopics } from "./DiscoverTopics";

export function DiscoverLanding({
  areas,
  feed,
  recommendationsEnabled = true,
  selectedArea = null,
}: {
  areas: CurriculumArea[];
  feed?: DiscoveryHomeResponse | null;
  recommendationsEnabled?: boolean;
  selectedArea?: CurriculumArea | null;
}) {
  const sections = areas.map((area, index) => ({
    name: area.name,
    tone: index,
    slug: area.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    categories: area.categories.filter(hasBrowsableResources).map((category, index) => ({
      index,
      slug: category.slug,
      name: category.name,
      count: category.items.filter((item) => item.url).length,
    })),
  })).filter((section) => section.categories.length > 0);

  return (
    <main className="discovery-canvas discovery-curriculum discover-home">
      {selectedArea ? <Link className="discover-back-link" href="/app/discover">← Back to Discover</Link> : null}
      {!selectedArea && recommendationsEnabled ? <DiscoveryFeed key={feed?.runId ?? "unavailable"} feed={feed ?? null} /> : null}
      <DiscoverTopics sections={selectedArea ? sections.filter((section) => section.name === selectedArea.name) : sections} />
    </main>
  );
}

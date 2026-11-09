import MiniSearch, { type SearchOptions } from "minisearch";
import { hasBrowsableResources } from "../discovery/browse";
import { getCurriculum } from "../discovery/curriculum";
import type { GlobalSearchResult } from "./service";

type Entry = {
  id: string;
  kind: "collection" | "lesson";
  title: string;
  track: string;
  channel: string;
  category: string;
  area: string;
  href: string;
  subtitle: string;
  thumbnailUrl: string | null;
  step: number;
  url: string;
};

const fold = (term: string) => term.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Typo tolerance only on longer words, so "ai" or "os" stay exact.
const searchOptions: SearchOptions = {
  boost: { title: 3, category: 2.5, track: 2, channel: 1.5 },
  prefix: true,
  fuzzy: (term) => term.length > 3 ? 0.2 : false,
  combineWith: "AND",
  // Courses first, then earlier steps: a learner searching a topic usually wants where it starts.
  boostDocument: (_id, _term, stored) => stored?.kind === "collection" ? 1.6 : 1 + 0.6 / Math.sqrt(Number(stored?.step) || 1),
};

async function buildIndex() {
  const areas = await getCurriculum();
  const index = new MiniSearch<Entry>({
    fields: ["title", "track", "channel", "category", "area"],
    storeFields: ["kind", "title", "href", "subtitle", "thumbnailUrl", "step", "url"],
    processTerm: fold,
    searchOptions,
  });
  index.addAll(areas.flatMap((area) => area.categories.filter(hasBrowsableResources).flatMap((category) => {
    const lessons = category.items.filter((item) => item.url);
    return [
      { id: `collection:${category.slug}`, kind: "collection" as const, title: category.name, track: [...new Set(lessons.map((item) => item.track).filter(Boolean))].join(" "), channel: "", category: category.name, area: area.name, href: `/app/discover/${category.slug}`, subtitle: `${area.name} · ${lessons.length} lessons`, thumbnailUrl: null, step: 0, url: "" },
      ...lessons.map((item, index) => ({
        id: `lesson:${category.slug}:${index + 1}`,
        kind: "lesson" as const,
        title: item.title,
        track: item.track ?? "",
        channel: item.channel ?? "",
        category: category.name,
        area: area.name,
        href: `/app/discover/${category.slug}?step=${index + 1}`,
        subtitle: [category.name, `Step ${index + 1}`, item.track, item.channel].filter(Boolean).join(" · "),
        // mqdefault exists for every video (maxres does not) and is 16:9 at a size that suits a small row.
        thumbnailUrl: item.thumbnailFallbackUrl?.replace("/hqdefault.", "/mqdefault.") ?? null,
        step: index + 1,
        url: item.url!,
      })),
    ];
  })));
  return index;
}

// Built once per server instance; the curriculum is static data shipped with the build.
const index = buildIndex();

export async function searchCurriculum(query: string): Promise<GlobalSearchResult[]> {
  const curriculum = await index;
  // Every word must match; when none match together, fall back to the best partial matches.
  const all = curriculum.search(query);
  const hits = all.length ? all : curriculum.search(query, { combineWith: "OR" });
  // A video filed under several courses shows once, under its best-matching course.
  const seen = new Set<string>();
  const unique = hits.filter((hit) => !hit.url || (!seen.has(hit.url) && seen.add(hit.url)));
  const pick = (kind: Entry["kind"], limit: number) => unique.filter((hit) => hit.kind === kind).slice(0, limit).map((hit): GlobalSearchResult => ({
    id: hit.id,
    kind,
    title: hit.title,
    subtitle: hit.subtitle,
    href: hit.href,
    resourceId: null,
    resourceType: null,
    thumbnailUrl: hit.thumbnailUrl,
  }));
  return [...pick("collection", 4), ...pick("lesson", 8)];
}

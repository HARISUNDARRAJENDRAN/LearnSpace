import type { CurriculumArea, CurriculumCategory, CurriculumItem } from "./curriculum";

export type BrowseItem = CurriculumItem & { categoryName: string; categorySlug: string; areaName: string };

export function hasBrowsableResources(category: CurriculumCategory): boolean {
  return category.items.some((item) => item.url);
}

export function browseItems(areas: CurriculumArea[], filters: { topic: string; format: string; stage: string; sort: string }): BrowseItem[] {
  const categories = areas.flatMap((area) => area.categories.map((category) => category.items.map((item) => ({ ...item, categoryName: category.name, categorySlug: category.slug, areaName: area.name }))));
  // Interleave categories so the opening feed covers more than the first subject.
  const items: BrowseItem[] = [];
  const longest = Math.max(0, ...categories.map((category) => category.length));
  for (let index = 0; index < longest; index += 1) {
    for (const category of categories) {
      const item = category[index];
      if (item?.url) items.push(item);
    }
  }
  const result = items.filter((item) => (
    (!filters.topic || item.areaName === filters.topic)
    && (!filters.format || item.resourceType === filters.format)
    && (!filters.stage || item.learningStage === filters.stage)
  ));
  if (filters.sort === "title") result.sort((a, b) => a.title.localeCompare(b.title));
  if (filters.sort === "creator") result.sort((a, b) => (a.channel ?? "").localeCompare(b.channel ?? "") || a.title.localeCompare(b.title));
  return result;
}

import type { CurriculumCategory } from "./curriculum";

export function hasBrowsableResources(category: CurriculumCategory): boolean {
  return category.items.some((item) => item.url);
}

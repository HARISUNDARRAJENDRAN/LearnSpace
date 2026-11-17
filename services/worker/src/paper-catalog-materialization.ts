import type { CurriculumItem, CurriculumTrack, ResearchCurriculum } from "@learnspace/shared";

export type CatalogSection = {
  title: string;
  position: number;
  metadata: { concepts: Array<{ id: string; title: string; why: string; keyConcepts: string[] }> };
  papers: Array<{ arxivId: string; position: number; itemId: string }>;
};

export function curriculumPaperMetadata(curriculum: ResearchCurriculum): Map<string, { itemIds: string[]; trackIds: string[] }> {
  const associations = new Map<string, { itemIds: string[]; trackIds: string[] }>();
  for (const item of curriculum.items) if (item.type === "paper") associations.set(item.arxivId, { itemIds: [item.id], trackIds: [] });
  for (const track of curriculum.tracks) for (const module of track.modules) for (const itemId of module.itemIds) {
    const item = curriculum.items.find((candidate) => candidate.id === itemId);
    if (item?.type !== "paper") continue;
    const value = associations.get(item.arxivId)!;
    if (!value.itemIds.includes(item.id)) value.itemIds.push(item.id);
    if (!value.trackIds.includes(track.id)) value.trackIds.push(track.id);
    associations.set(item.arxivId, value);
  }
  return associations;
}

export function curriculumTrackSections(track: CurriculumTrack, items: CurriculumItem[]): CatalogSection[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return track.modules.map((module, position) => {
    const moduleItems = module.itemIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
    return {
      title: module.title,
      position,
      metadata: { concepts: moduleItems.flatMap((item) => item.type === "concept" ? [{ id: item.id, title: item.title, why: item.why, keyConcepts: item.keyConcepts }] : []) },
      papers: moduleItems.filter((item) => item.type === "paper").map((item, paperPosition) => ({ arxivId: item.arxivId, position: paperPosition, itemId: item.id })),
    };
  });
}


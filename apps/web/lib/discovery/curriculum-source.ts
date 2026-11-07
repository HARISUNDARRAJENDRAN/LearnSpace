import { resolve } from "node:path";
import { canonicalYoutubeId, datasetRows } from "@learnspace/shared/youtube-dataset";
import { youtubeThumbnailSources } from "../home/thumbnail";
import type { CurriculumArea, CurriculumCategory } from "./curriculum";

const curriculumPath = resolve(process.cwd(), "public/data/learnspace_youtube_curriculum_master.csv");

function field(row: Record<string, string>, name: string): string | null {
  const value = row[name]?.trim();
  return value || null;
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function loadCurriculumFromCsv(): Promise<CurriculumArea[]> {
  const areas = new Map<string, { name: string; categories: Map<string, CurriculumCategory> }>();
  let rowIndex = 0;

  for await (const row of datasetRows(curriculumPath)) {
    const areaName = field(row, "top_level_category") ?? "Other";
    const categoryName = field(row, "category_name") ?? "Other";
    const categorySlug = field(row, "category_slug");
    if (!categorySlug) throw new Error(`Curriculum row ${rowIndex + 2} is missing its canonical category slug`);
    const resourceType = field(row, "resource_type") ?? "resource";
    const videoUrl = field(row, "video_url") ?? (resourceType === "video" ? field(row, "youtube_url") : null);
    const playlistUrl = field(row, "playlist_url") ?? (resourceType === "playlist" ? field(row, "youtube_url") : null);
    const url = resourceType === "playlist"
      ? playlistUrl ?? videoUrl ?? field(row, "youtube_url")
      : videoUrl ?? field(row, "youtube_url") ?? playlistUrl;
    const thumbnail = youtubeThumbnailSources(canonicalYoutubeId(videoUrl));
    const areaKey = slugify(areaName);
    const area = areas.get(areaKey) ?? { name: areaName, categories: new Map<string, CurriculumCategory>() };
    const category = area.categories.get(categorySlug) ?? { slug: categorySlug, name: categoryName, items: [] };

    category.items.push({
      id: `${categorySlug}-${rowIndex}`,
      title: field(row, "title") ?? "Untitled resource",
      channel: field(row, "channel"),
      url,
      resourceType,
      curriculumRole: field(row, "curriculum_role"),
      learningStage: field(row, "learning_stage"),
      track: field(row, "track"),
      coverageNotes: field(row, "coverage_notes"),
      publishedOrUpdated: field(row, "published_or_updated"),
      language: field(row, "language"),
      thumbnailUrl: thumbnail?.primary ?? null,
      thumbnailFallbackUrl: thumbnail?.fallback ?? null,
    });

    area.categories.set(categorySlug, category);
    areas.set(areaKey, area);
    rowIndex += 1;
  }

  return [...areas.values()].map((area) => ({
    name: area.name,
    categories: [...area.categories.values()],
  }));
}

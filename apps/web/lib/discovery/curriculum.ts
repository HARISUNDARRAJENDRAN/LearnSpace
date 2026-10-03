import { resolve } from "node:path";
import { canonicalYoutubeId, datasetRows } from "@learnspace/shared/youtube-dataset";
import { youtubeThumbnailSources, youtubeThumbnailSourcesFromUrl } from "../home/thumbnail";

const curriculumPath = resolve(process.cwd(), "public/data/learnspace_youtube_curriculum_master.csv");

export type CurriculumItem = {
  id: string;
  title: string;
  channel: string | null;
  url: string | null;
  resourceType: string;
  curriculumRole: string | null;
  learningStage: string | null;
  track: string | null;
  coverageNotes: string | null;
  publishedOrUpdated?: string | null;
  language?: string | null;
  thumbnailUrl: string | null;
  thumbnailFallbackUrl: string | null;
};

export type CurriculumCategory = {
  slug: string;
  name: string;
  items: CurriculumItem[];
};

export type CurriculumArea = {
  name: string;
  categories: CurriculumCategory[];
};

function field(row: Record<string, string>, name: string): string | null {
  const value = row[name]?.trim();
  return value || null;
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function loadCurriculum(): Promise<CurriculumArea[]> {
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

let curriculumPromise: Promise<CurriculumArea[]> | null = null;

export function getCurriculum(): Promise<CurriculumArea[]> {
  curriculumPromise ??= loadCurriculum().catch((error) => {
    curriculumPromise = null;
    throw error;
  });
  return curriculumPromise;
}

export async function getCurriculumCategoryBySlug(slug: string): Promise<{ area: CurriculumArea; category: CurriculumCategory } | null> {
  for (const area of await getCurriculum()) {
    const category = area.categories.find((item) => item.slug === slug);
    if (category) return { area, category };
  }
  return null;
}

export async function withPlaylistThumbnailFallbacks(category: CurriculumCategory): Promise<CurriculumCategory> {
  return {
    ...category,
    items: await Promise.all(category.items.map(async (item) => {
      if (item.resourceType !== "playlist" || item.thumbnailUrl || !item.url) return item;
      try {
        const playlist = new URL(item.url);
        const playlistId = playlist.searchParams.get("list");
        if (playlist.protocol !== "https:" || playlist.hostname !== "www.youtube.com" || playlist.pathname !== "/playlist" || !playlistId) return item;
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${playlistId}`)}&format=json`;
        const response = await fetch(oembedUrl, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(4_000) });
        if (!response.ok) return item;
        const thumbnailUrl = (await response.json() as { thumbnail_url?: unknown }).thumbnail_url;
        if (typeof thumbnailUrl !== "string") return item;
        const sources = youtubeThumbnailSourcesFromUrl(thumbnailUrl);
        return { ...item, thumbnailUrl: sources?.primary ?? thumbnailUrl, thumbnailFallbackUrl: sources?.fallback ?? item.thumbnailFallbackUrl };
      } catch {
        return item;
      }
    })),
  };
}

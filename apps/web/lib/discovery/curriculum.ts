import { youtubeThumbnailSourcesFromUrl } from "../home/thumbnail";
import generated from "./generated/curriculum.json";

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

// Parsed from the curriculum CSV at build time (scripts/generate-category-intelligence.ts), so no server instance parses it.
const curriculum = generated as CurriculumArea[];

export async function getCurriculum(): Promise<CurriculumArea[]> {
  return curriculum;
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

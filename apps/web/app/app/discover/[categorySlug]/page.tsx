import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryBrowser } from "../../../../components/discovery/DiscoveryBrowser";
import { CategoryIntelligencePanel } from "../../../../components/discovery/CategoryIntelligencePanel";
import { getCategoryIntelligence } from "../../../../lib/discovery/category-intelligence";
import { hasBrowsableResources } from "../../../../lib/discovery/browse";
import { getCurriculum, getCurriculumCategoryBySlug, withPlaylistThumbnailFallbacks } from "../../../../lib/discovery/curriculum";

export const dynamic = "force-dynamic";
export const dynamicParams = false;

type Props = { params: Promise<{ categorySlug: string }> };

export async function generateStaticParams() {
  const areas = await getCurriculum();
  return areas.flatMap((area) => area.categories.filter(hasBrowsableResources).map(({ slug }) => ({ categorySlug: slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categorySlug } = await params;
  try {
    const resolved = await getCurriculumCategoryBySlug(categorySlug);
    return { title: resolved ? `${resolved.category.name} | Discover | LearnSpace` : "Not Found | Discover | LearnSpace" };
  } catch {
    return { title: "Discover | LearnSpace" };
  }
}

export default async function DiscoverCategoryPage({ params }: Props) {
  const { categorySlug } = await params;
  const resolved = await getCurriculumCategoryBySlug(categorySlug);
  if (!resolved || !hasBrowsableResources(resolved.category)) notFound();

  const { area, category } = resolved;
  return <DiscoveryBrowser key={category.slug} areas={[{ name: area.name, categories: [category] }]} category={await withPlaylistThumbnailFallbacks(category)} intelligencePanel={<CategoryIntelligencePanel analysis={getCategoryIntelligence(category)} />} />;
}

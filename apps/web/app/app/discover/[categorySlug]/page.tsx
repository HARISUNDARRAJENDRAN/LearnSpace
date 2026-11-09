import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryBrowser } from "../../../../components/discovery/DiscoveryBrowser";
import { hasBrowsableResources } from "../../../../lib/discovery/browse";
import { getCurriculum, getCurriculumCategoryBySlug, withPlaylistThumbnailFallbacks } from "../../../../lib/discovery/curriculum";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { findCurrentStudySession, isCourseImportable } from "../../../../lib/study/service";

export const dynamic = "force-dynamic";
export const dynamicParams = false;

type Props = { params: Promise<{ categorySlug: string }>; searchParams: Promise<{ step?: string }> };

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

export default async function DiscoverCategoryPage({ params, searchParams }: Props) {
  const { categorySlug } = await params;
  const { step } = await searchParams;
  const resolved = await getCurriculumCategoryBySlug(categorySlug);
  if (!resolved || !hasBrowsableResources(resolved.category)) notFound();

  const { category } = resolved;
  const auth = await requireCompletedSession();
  // Sessions holds one course at a time, so importing is offered only while it is empty.
  const [current, importable, withThumbnails] = await Promise.all([findCurrentStudySession(auth.user.id), isCourseImportable(category.slug, auth.user.id), withPlaylistThumbnailFallbacks(category)]);
  return <DiscoveryBrowser key={category.slug} initialStep={Number(step) || 1} category={withThumbnails} canImport={!current && importable} />;
}

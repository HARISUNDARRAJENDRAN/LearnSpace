import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DiscoverLanding } from "../../../components/discovery/DiscoverLanding";
import { AuthError } from "../../../lib/auth/errors";
import { getCurrentSession } from "../../../lib/auth/session";
import { hasBrowsableResources } from "../../../lib/discovery/browse";
import { getPopularResourcesThisWeek } from "../../../lib/discovery/popular";
import { getHomeFeed } from "../../../lib/discovery/service";
import { getCurriculum } from "../../../lib/discovery/curriculum";
import type { DiscoveryHomeResponse } from "@learnspace/shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discover | LearnSpace" };

type DiscoverSearchParams = Promise<{ area?: string; view?: string }>;

function emptyFeed(): DiscoveryHomeResponse {
  return {
    runId: null,
    generatedAt: new Date().toISOString(),
    stale: true,
    sections: { continueLearning: [], recommendedVideos: [], researchPapers: [], freshForYou: [], interests: [] },
  };
}

export default async function DiscoverPage({ searchParams }: { searchParams: DiscoverSearchParams }) {
  const params = await searchParams;
  const areas = await getCurriculum();
  const selectedArea = areas
    .map((area) => ({ ...area, categories: area.categories.filter(hasBrowsableResources) }))
    .find((area) => area.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === params.area && area.categories.length > 0) ?? null;
  if (selectedArea) {
    return <DiscoverLanding areas={areas} selectedArea={selectedArea} />;
  }

  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/app/discover");

  const expandedPopular = params.view === "popular";
  const [feedResult, popularResult] = await Promise.allSettled([
    getHomeFeed(session.user.id, "discover"),
    getPopularResourcesThisWeek(session.user.id, expandedPopular ? 20 : 4),
  ]);

  if (feedResult.status === "rejected") {
    if (feedResult.reason instanceof AuthError) throw feedResult.reason;
    console.error("[discover] recommendations unavailable", feedResult.reason);
  }
  if (popularResult.status === "rejected") {
    if (popularResult.reason instanceof AuthError) throw popularResult.reason;
    console.error("[discover] popular resources unavailable", popularResult.reason);
  }

  return (
    <DiscoverLanding
      areas={areas}
      feed={feedResult.status === "fulfilled" ? feedResult.value : emptyFeed()}
      popular={popularResult.status === "fulfilled" ? popularResult.value : []}
      popularUnavailable={popularResult.status === "rejected"}
      expandedPopular={expandedPopular}
    />
  );
}

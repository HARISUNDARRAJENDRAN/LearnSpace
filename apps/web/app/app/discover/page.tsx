import { after } from "next/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DiscoverLanding } from "../../../components/discovery/DiscoverLanding";
import { getCurrentSession } from "../../../lib/auth/session";
import { isApplicationPrefetch, recordFirstApplicationVisit } from "../../../lib/onboarding/service";
import { hasBrowsableResources } from "../../../lib/discovery/browse";
import { adaptiveDiscoveryEnabled, getHomeFeed } from "../../../lib/discovery/service";
import { AuthError } from "../../../lib/auth/errors";
import { getCurriculum } from "../../../lib/discovery/curriculum";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discover | LearnSpace" };

type DiscoverSearchParams = Promise<{ area?: string }>;

export default async function DiscoverPage({ searchParams }: { searchParams: DiscoverSearchParams }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/app/discover");
  if (!isApplicationPrefetch(await headers())) await recordFirstApplicationVisit(session.user.id);
  const params = await searchParams;
  const enabled = adaptiveDiscoveryEnabled();
  const [areas, feed] = await Promise.all([
    getCurriculum(),
    !params.area && enabled ? getHomeFeed(session.user.id, "discover", { scheduleRefresh: (work) => after(work) }).catch((error: unknown) => {
      if (error instanceof AuthError) throw error;
      console.error("[discover] recommendations unavailable", error);
      return null;
    }) : Promise.resolve(null),
  ]);
  const selectedArea = areas
    .map((area) => ({ ...area, categories: area.categories.filter(hasBrowsableResources) }))
    .find((area) => area.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === params.area && area.categories.length > 0) ?? null;
  if (selectedArea) {
    return <DiscoverLanding areas={areas} selectedArea={selectedArea} />;
  }

  return <DiscoverLanding areas={areas} feed={feed} recommendationsEnabled={enabled} />;
}

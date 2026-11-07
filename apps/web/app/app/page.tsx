import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { HomeDashboard } from "../../components/home/HomeDashboard";
import { getCurrentSession } from "../../lib/auth/session";
import { loadHomeData } from "../../lib/home/load";
import { isApplicationPrefetch, recordFirstApplicationVisit } from "../../lib/onboarding/service";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  // A prefetched parent layout can be reused on navigation; claim the real
  // page entry too so prefetch never consumes or bypasses the first visit.
  if (!isApplicationPrefetch(await headers())
    && await recordFirstApplicationVisit(currentSession.user.id)) redirect("/app/discover");
  const { home } = await loadHomeData(currentSession.user.id);
  return <HomeDashboard home={home} />;
}

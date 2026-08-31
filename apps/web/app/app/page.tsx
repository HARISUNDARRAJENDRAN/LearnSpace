import { redirect } from "next/navigation";
import { DiscoveryFeed } from "../../components/discovery/DiscoveryFeed";
import { getCurrentSession } from "../../lib/auth/session";
import { getHomeFeed } from "../../lib/discovery/service";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  const firstName = currentSession.user.displayName?.trim().split(/\s+/)[0] || "there";
  return <DiscoveryFeed feed={await getHomeFeed(currentSession.user.id)} surface="home" firstName={firstName} />;
}

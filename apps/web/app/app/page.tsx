import { redirect } from "next/navigation";
import { HomeDashboard } from "../../components/home/HomeDashboard";
import { getCurrentSession } from "../../lib/auth/session";
import { getHomeFeed } from "../../lib/discovery/service";
import { getLearnHome } from "../../lib/home/service";
import { listStudySessions } from "../../lib/study/service";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  const [home, feed, sessions] = await Promise.all([
    getLearnHome(currentSession.user.id),
    getHomeFeed(currentSession.user.id),
    listStudySessions(currentSession.user.id),
  ]);
  return <HomeDashboard home={home} feed={feed} sessions={sessions} />;
}

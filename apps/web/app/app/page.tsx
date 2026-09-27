import { redirect } from "next/navigation";
import { HomeDashboard } from "../../components/home/HomeDashboard";
import { getCurrentSession } from "../../lib/auth/session";
import { loadHomeData } from "../../lib/home/load";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  const data = await loadHomeData(currentSession.user.id);
  return <HomeDashboard {...data} />;
}

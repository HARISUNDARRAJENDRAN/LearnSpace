import { redirect } from "next/navigation";
import { ApplicationShell } from "../../components/application/ApplicationShell";
import { getCurrentSession, publicUser } from "../../lib/auth/session";
import { getOnboardingState } from "../../lib/onboarding/service";
import { listStudySessions } from "../../lib/study/service";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  if (!(await getOnboardingState(currentSession.user.id)).completed) redirect("/onboarding");
  const recentSessions = (await listStudySessions(currentSession.user.id)).slice(0, 12).map((session) => ({
    id: session.id,
    title: session.title,
    mode: session.mode,
    route: session.route,
    activeResource: session.activeResource ? { type: session.activeResource.type } : null,
  }));
  return <ApplicationShell user={publicUser(currentSession.user)} recentSessions={recentSessions}>{children}</ApplicationShell>;
}

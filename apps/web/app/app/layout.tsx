import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ApplicationShell } from "../../components/application/ApplicationShell";
import { getCurrentSession, publicUser } from "../../lib/auth/session";
import { getAuthenticatedDestination, getOnboardingState, isApplicationPrefetch, recordFirstApplicationVisit } from "../../lib/onboarding/service";
import { findCurrentStudySession, listStudySessions } from "../../lib/study/service";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  if (!(await getOnboardingState(currentSession.user.id)).completed) redirect("/onboarding");
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-learnspace-pathname") ?? "/app";
  const prefetch = isApplicationPrefetch(requestHeaders);
  if (prefetch) {
    const destination = await getAuthenticatedDestination(currentSession.user.id, pathname);
    if (destination !== pathname) redirect(destination);
  }
  if (!prefetch
    && await recordFirstApplicationVisit(currentSession.user.id)
    && pathname !== "/app/discover") redirect("/app/discover");
  const [sessions, current] = await Promise.all([listStudySessions(currentSession.user.id), findCurrentStudySession(currentSession.user.id)]);
  const recentSessions = sessions.slice(0, 12).map((session) => ({
    id: session.id,
    title: session.title,
    mode: session.mode,
    route: session.route,
    activeResource: session.activeResource ? { type: session.activeResource.type } : null,
  }));
  return <ApplicationShell user={publicUser(currentSession.user)} recentSessions={recentSessions} hasCurrentSession={Boolean(current)}>{children}</ApplicationShell>;
}

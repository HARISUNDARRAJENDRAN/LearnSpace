import { redirect } from "next/navigation";
import { ApplicationShell } from "../../components/application/ApplicationShell";
import { getCurrentSession, publicUser } from "../../lib/auth/session";
import { getOnboardingState } from "../../lib/onboarding/service";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  if (!(await getOnboardingState(currentSession.user.id)).completed) redirect("/onboarding");
  return <ApplicationShell user={publicUser(currentSession.user)}>{children}</ApplicationShell>;
}

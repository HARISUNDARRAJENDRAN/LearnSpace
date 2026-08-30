import { redirect } from "next/navigation";
import { ApplicationShell } from "../../components/application/ApplicationShell";
import { getCurrentSession, publicUser } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) {
    redirect("/login?next=/app");
  }

  return <ApplicationShell user={publicUser(currentSession.user)} />;
}

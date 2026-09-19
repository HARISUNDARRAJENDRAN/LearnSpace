import { redirect } from "next/navigation";
import { getCurrentSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) redirect("/login?next=/app");
  return <main className="home-canvas" aria-label="Home" />;
}

import { redirect } from "next/navigation";
import { AuthForm } from "../../../components/auth/AuthForm";
import { AuthShell } from "../../../components/auth/AuthShell";
import { safeRedirectPath } from "../../../lib/auth/validation";
import { first, type SearchParams } from "../../../lib/search-params";
import { getCurrentSession } from "../../../lib/auth/session";
import { getAuthenticatedDestination } from "../../../lib/onboarding/service";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(first(params.next));
  const session = await getCurrentSession();
  if (session) redirect(await getAuthenticatedDestination(session.user.id, next));
  return (
    <AuthShell
      title="Sign In or Join Now!"
      subtitle="login or create your LearnSpace account."
    >
      <AuthForm mode="register" next={next} />
    </AuthShell>
  );
}

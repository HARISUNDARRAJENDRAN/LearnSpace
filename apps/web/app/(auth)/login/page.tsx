import { redirect } from "next/navigation";
import { AuthForm } from "../../../components/auth/AuthForm";
import { AuthShell } from "../../../components/auth/AuthShell";
import { safeRedirectPath } from "../../../lib/auth/validation";
import { first, type SearchParams } from "../../../lib/search-params";
import { getCurrentSession } from "../../../lib/auth/session";
import { getAuthenticatedDestination } from "../../../lib/onboarding/service";

function loginError(code: string | undefined): string | undefined {
  const messages: Record<string, string> = {
    "google-unavailable": "Google sign-in is not configured yet.",
    "google-invalid-callback": "Google sign-in could not be verified. Please try again.",
    "google-cancelled": "Google sign-in was cancelled.",
    "google-email-unverified": "Your Google email must be verified before continuing.",
    "google-failed": "Google sign-in failed. Please try again.",
  };
  return code ? messages[code] : undefined;
}

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(first(params.next));
  const session = await getCurrentSession();
  if (session) redirect(await getAuthenticatedDestination(session.user.id, next));
  const initialError = loginError(first(params.error));
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to pick up where you left off."
    >
      <AuthForm
        mode="login"
        next={next}
        {...(initialError ? { initialError } : {})}
        verified={first(params.verified) === "1"}
        reset={first(params.reset) === "1"}
      />
    </AuthShell>
  );
}

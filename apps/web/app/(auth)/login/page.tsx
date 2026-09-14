import { AuthForm } from "../../../components/auth/AuthForm";
import { AuthShell } from "../../../components/auth/AuthShell";
import { safeRedirectPath } from "../../../lib/auth/validation";
import { first, type SearchParams } from "../../../lib/search-params";

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
  const initialError = loginError(first(params.error));
  return (
    <AuthShell
      title="Sign In or Join Now!"
      subtitle="login or create your LearnSpace account."
    >
      <AuthForm
        mode="login"
        next={safeRedirectPath(first(params.next))}
        {...(initialError ? { initialError } : {})}
        verified={first(params.verified) === "1"}
        reset={first(params.reset) === "1"}
      />
    </AuthShell>
  );
}

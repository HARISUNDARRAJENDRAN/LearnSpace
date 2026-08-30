import { AuthForm } from "../../../components/auth/AuthForm";
import { AuthShell } from "../../../components/auth/AuthShell";
import { safeRedirectPath } from "../../../lib/auth/validation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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
      title="Welcome back."
      subtitle="Return to the ideas, notes, and questions you are growing."
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

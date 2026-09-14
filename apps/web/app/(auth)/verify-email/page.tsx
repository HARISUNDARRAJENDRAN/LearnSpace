import { AuthShell } from "../../../components/auth/AuthShell";
import { VerifyEmailClient } from "../../../components/auth/VerifyEmailClient";
import { safeRedirectPath } from "../../../lib/auth/validation";
import { first, type SearchParams } from "../../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const developmentLink = first(params.devLink);
  const status = first(params.status);
  return (
    <AuthShell
      title="Check your inbox."
      subtitle="One small step, then your learning space is ready."
    >
      <VerifyEmailClient
        email={first(params.email) ?? ""}
        next={safeRedirectPath(first(params.next))}
        {...(developmentLink ? { developmentLink } : {})}
        {...(status ? { status } : {})}
      />
    </AuthShell>
  );
}

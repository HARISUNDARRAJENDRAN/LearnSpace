import { AuthShell } from "../../../components/auth/AuthShell";
import { VerifyEmailClient } from "../../../components/auth/VerifyEmailClient";
import { safeRedirectPath } from "../../../lib/auth/validation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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

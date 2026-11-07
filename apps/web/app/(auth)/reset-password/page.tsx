import { AuthShell } from "../../../components/auth/AuthShell";
import { ResetPasswordForm } from "../../../components/auth/ResetPasswordForm";
import { first, type SearchParams } from "../../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Use at least 8 characters, then keep learning."
    >
      <ResetPasswordForm token={first(params.token) ?? ""} />
    </AuthShell>
  );
}

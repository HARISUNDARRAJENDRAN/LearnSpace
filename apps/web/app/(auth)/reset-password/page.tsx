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
      title="Choose a new password."
      subtitle="Set a fresh password and continue learning securely."
    >
      <ResetPasswordForm token={first(params.token) ?? ""} />
    </AuthShell>
  );
}

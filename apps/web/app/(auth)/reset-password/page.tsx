import { AuthShell } from "../../../components/auth/AuthShell";
import { ResetPasswordForm } from "../../../components/auth/ResetPasswordForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

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
      <ResetPasswordForm token={first(params.token)} />
    </AuthShell>
  );
}

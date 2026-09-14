import { AuthForm } from "../../../components/auth/AuthForm";
import { AuthShell } from "../../../components/auth/AuthShell";
import { safeRedirectPath } from "../../../lib/auth/validation";
import { first, type SearchParams } from "../../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Sign In or Join Now!"
      subtitle="login or create your LearnSpace account."
    >
      <AuthForm mode="register" next={safeRedirectPath(first(params.next))} />
    </AuthShell>
  );
}

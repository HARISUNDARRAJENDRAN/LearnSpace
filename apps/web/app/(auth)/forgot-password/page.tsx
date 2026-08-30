import { AuthShell } from "../../../components/auth/AuthShell";
import { ForgotPasswordForm } from "../../../components/auth/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Find your way back."
      subtitle="We will send a private link to reset your LearnSpace password."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "../../../components/auth/AuthShell";
import { SharedFolderImportClient } from "../../../components/folders/SharedFolderImportClient";
import { getCurrentSession } from "../../../lib/auth/session";
import { isValidShareToken } from "../../../lib/folders/share";
import { getOnboardingState } from "../../../lib/onboarding/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared Folder · LearnSpace",
  robots: { index: false, follow: false },
};

export default async function SharedFolderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isValidShareToken(token)) {
    return (
      <AuthShell
        title="Link unavailable"
        subtitle="This shared folder link is invalid or has expired."
      >
        <p className="auth-switch">
          <a href="/app">Go to LearnSpace</a>
        </p>
      </AuthShell>
    );
  }

  const sharePath = `/share/${token}`;
  const session = await getCurrentSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(sharePath)}`);
  }

  const onboarding = await getOnboardingState(session.user.id);
  if (!onboarding.completed) {
    redirect(`/onboarding?next=${encodeURIComponent(sharePath)}`);
  }

  return (
    <AuthShell
      title="Opening shared folder"
      subtitle="Creating your own copy in LearnSpace."
    >
      <SharedFolderImportClient token={token} />
    </AuthShell>
  );
}

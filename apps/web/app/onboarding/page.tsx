import { redirect } from "next/navigation";
import { OnboardingFlow } from "../../components/onboarding/OnboardingFlow";
import { getCurrentSession } from "../../lib/auth/session";
import { getAuthenticatedDestination, getOnboardingState } from "../../lib/onboarding/service";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const currentSession = await getCurrentSession();
  if (!currentSession) {
    redirect("/login?next=/onboarding");
  }

  const state = await getOnboardingState(currentSession.user.id);
  if (state.completed) {
    redirect(await getAuthenticatedDestination(currentSession.user.id));
  }

  const firstName = currentSession.user.displayName?.trim().split(/\s+/)[0] || "learner";
  return <OnboardingFlow firstName={firstName} initialState={state} />;
}

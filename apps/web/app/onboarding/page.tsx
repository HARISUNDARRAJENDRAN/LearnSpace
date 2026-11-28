import { redirect } from "next/navigation";
import { OnboardingFlow } from "../../components/onboarding/OnboardingFlow";
import { getCurrentSession } from "../../lib/auth/session";
import { isSharedFolderPath, safeRedirectPath } from "../../lib/auth/validation";
import { getAuthenticatedDestination, getOnboardingState } from "../../lib/onboarding/service";
import { first, type SearchParams } from "../../lib/search-params";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(first(params.next), "/app");
  const sharedNext = isSharedFolderPath(next) ? next : undefined;
  const currentSession = await getCurrentSession();
  if (!currentSession) {
    redirect(`/login?next=${encodeURIComponent(sharedNext ?? "/onboarding")}`);
  }

  const state = await getOnboardingState(currentSession.user.id);
  if (state.completed) {
    redirect(await getAuthenticatedDestination(currentSession.user.id, sharedNext ?? "/app"));
  }

  const firstName = currentSession.user.displayName?.trim().split(/\s+/)[0] || "learner";
  return <OnboardingFlow firstName={firstName} initialState={state} {...(sharedNext ? { nextPath: sharedNext } : {})} />;
}

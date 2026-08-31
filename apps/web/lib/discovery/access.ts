import { getOnboardingState } from "../onboarding/service";
import { AuthError } from "../auth/errors";
import { requireCurrentSession } from "../auth/session";

export async function requireCompletedSession() {
  const session = await requireCurrentSession();
  if (!(await getOnboardingState(session.user.id)).completed) {
    throw new AuthError("ONBOARDING_REQUIRED", "Complete onboarding before using Discovery.", 403);
  }
  return session;
}

import { OnboardingError } from "../onboarding/service";
import { AuthError } from "../auth/errors";
import { requireCurrentSessionWithOnboarding } from "../auth/session";

// The session and the onboarding check come back from one statement (see findSessionWithOnboarding): most requests a
// learner makes pass through here, and it used to be a session read, a user read, a touch and a whole transaction.
export async function requireCompletedSession() {
  const { onboarding, ...session } = await requireCurrentSessionWithOnboarding();
  if (!onboarding) {
    throw new OnboardingError("ONBOARDING_SETTINGS_MISSING", "Your learning settings could not be loaded.", 500);
  }
  if (!onboarding.completedAt) {
    throw new AuthError("ONBOARDING_REQUIRED", "Complete onboarding before using Discovery.", 403);
  }
  return session;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FirstSession } from "../../../components/onboarding/FirstSession";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getOnboardingState } from "../../../lib/onboarding/service";
import { lastSeenSessionRoute } from "../../../lib/study/service";

export const metadata: Metadata = { title: "Sessions | LearnSpace" };

export const dynamic = "force-dynamic";

/** Sessions opens the session the learner was in last, where they left it; with none open, it asks for the next video. */
export default async function SessionsRoute() {
  const auth = await requireCompletedSession();
  const route = await lastSeenSessionRoute(auth.user.id);
  if (route) redirect(route);
  const { draft } = await getOnboardingState(auth.user.id);
  return (
    <main className="product-page sessions-page" aria-labelledby="sessions-pick-title">
      <h1 id="sessions-pick-title">What will you study right now?</h1>
      <p>Pick a video from your interests to start your next session.</p>
      <FirstSession preferredDuration={draft.preferredDuration ?? "no_preference"} />
    </main>
  );
}

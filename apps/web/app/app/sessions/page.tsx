import type { Metadata } from "next";
import { FirstSession } from "../../../components/onboarding/FirstSession";
import { StudyWorkspace } from "../../../components/study/StudyWorkspace";
import { VideoSession } from "../../../components/study/VideoSession";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getOnboardingState } from "../../../lib/onboarding/service";
import { findCurrentStudySession, getStudySession } from "../../../lib/study/service";

export const metadata: Metadata = { title: "Sessions | LearnSpace" };

export const dynamic = "force-dynamic";

/** Sessions is the current study session itself, rendered in place so there is no redirect hop. */
export default async function SessionsRoute() {
  const auth = await requireCompletedSession();
  const current = await findCurrentStudySession(auth.user.id);
  if (current) {
    const session = await getStudySession(auth.user.id, current.id);
    const key = `${session.id}:${session.activeResourceId}`;
    if (session.activeResource?.type === "video") return <VideoSession key={key} session={session} active={session.activeResource} />;
    if (session.activeResource?.type === "paper") return <StudyWorkspace key={key} session={session} />;
  }
  // With nothing in progress, Sessions asks for the next video instead of showing an empty desk.
  const { draft } = await getOnboardingState(auth.user.id);
  return (
    <main className="product-page sessions-page" aria-labelledby="sessions-pick-title">
      <h1 id="sessions-pick-title">What will you study right now?</h1>
      <p>Pick a video from your interests to start your next session.</p>
      <FirstSession preferredDuration={draft.preferredDuration ?? "no_preference"} />
    </main>
  );
}

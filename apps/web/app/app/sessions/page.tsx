import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FirstSession } from "../../../components/onboarding/FirstSession";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getOnboardingState } from "../../../lib/onboarding/service";
import { lastSeenSessionRoute } from "../../../lib/study/service";

export const metadata: Metadata = { title: "Sessions | LearnSpace" };

export const dynamic = "force-dynamic";

/**
 * Sessions opens the session the learner was in last in this mode (papers in Research, videos in Learn), where they left
 * it; with none open, it asks what to study next.
 */
export default async function SessionsRoute({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const auth = await requireCompletedSession();
  const research = (await searchParams).mode === "research";
  const route = await lastSeenSessionRoute(auth.user.id, research ? "paper" : "video");
  if (route) redirect(route);
  if (research) {
    return (
      <main className="product-page sessions-page" aria-labelledby="sessions-pick-title">
        <h1 id="sessions-pick-title">What will you research right now?</h1>
        <p>Open a paper from Research Home, or start a track in Discover.</p>
        <p className="sessions-page-actions">
          <Link href="/app/research">Research Home</Link>
          <Link href="/app/research/discover">Discover tracks</Link>
        </p>
      </main>
    );
  }
  const { draft } = await getOnboardingState(auth.user.id);
  return (
    <main className="product-page sessions-page" aria-labelledby="sessions-pick-title">
      <h1 id="sessions-pick-title">What will you study right now?</h1>
      <p>Pick a video from your interests to start your next session.</p>
      <FirstSession preferredDuration={draft.preferredDuration ?? "no_preference"} />
    </main>
  );
}

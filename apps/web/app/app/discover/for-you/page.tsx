import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DiscoveryFeed } from "../../../../components/discovery/DiscoveryFeed";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { adaptiveDiscoveryEnabled, getHomeFeed } from "../../../../lib/discovery/service";
import { AuthError } from "../../../../lib/auth/errors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recommended for you | LearnSpace" };

export default async function ForYouPage({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }) {
  if (!adaptiveDiscoveryEnabled()) notFound();
  const session = await requireCompletedSession();
  const { topic } = await searchParams;
  const parsed = z.string().uuid().optional().safeParse(topic);
  if (!parsed.success) notFound();
  const topicId = parsed.data ?? null;
  const feed = await getHomeFeed(session.user.id, "discover", { topicId, scheduleRefresh: (work) => after(work) }).catch((error: unknown) => {
    if (error instanceof AuthError && error.status === 422) notFound();
    console.error("[discover] personalized collection unavailable", error instanceof Error ? error.message : "unknown error");
    return null;
  });
  const navigation = <nav key="recommendation-topics" className="discover-recommendation-topics" aria-label="Recommendation topics">
    <Link key="all" href="/app/discover/for-you" aria-current={!topicId ? "page" : undefined} prefetch={false} scroll={false}>All for you</Link>
    {feed?.sections.interests.map((interest) => <Link key={interest.id} href={`/app/discover/for-you?topic=${interest.id}`} aria-current={topicId === interest.id ? "page" : undefined} prefetch={false} scroll={false}>{interest.name}</Link>)}
  </nav>;
  return <main className="discover-home discover-for-you">
    <Link href="/app/discover" className="discover-recommendations-back" aria-label="Back to Discover"><ArrowLeft aria-hidden="true" /></Link>
    <DiscoveryFeed feed={feed} full topicNavigation={navigation} />
    {!feed?.sections.recommendedVideos.length ? <Link href="/app/discover" className="discover-recommendations-browse">Explore curated collections</Link> : null}
  </main>;
}

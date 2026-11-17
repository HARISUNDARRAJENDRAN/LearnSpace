import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResearchTrack } from "../../../../../components/research/ResearchDiscover";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getResearchTrackPage } from "../../../../../lib/research/discover";

export const metadata: Metadata = { title: "Learning path | LearnSpace" };
export const dynamic = "force-dynamic";

export default async function ResearchTrackRoute({ params }: { params: Promise<{ trackId: string }> }) {
  const session = await requireCompletedSession();
  const data = await getResearchTrackPage(session.user.id, (await params).trackId);
  if (!data) notFound();
  return <ResearchTrack data={data} />;
}

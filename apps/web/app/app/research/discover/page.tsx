import type { Metadata } from "next";
import { ResearchDiscover } from "../../../../components/research/ResearchDiscover";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { getResearchDiscover } from "../../../../lib/research/discover";

export const metadata: Metadata = { title: "Learning paths | LearnSpace" };
export const dynamic = "force-dynamic";

export default async function ResearchDiscoverRoute() {
  const session = await requireCompletedSession();
  return <ResearchDiscover data={await getResearchDiscover(session.user.id)} />;
}

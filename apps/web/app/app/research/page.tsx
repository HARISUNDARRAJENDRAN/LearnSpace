import type { Metadata } from "next";
import { ResearchHome } from "../../../components/research/ResearchHome";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getResearchPage } from "../../../lib/research/service";

export const metadata: Metadata = { title: "Research | LearnSpace" };

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ q?: string; tab?: string; topic?: string }> };

export default async function ResearchRoute({ searchParams }: Props) {
  const session = await requireCompletedSession();
  const params = searchParams ? await searchParams : {};
  const data = await getResearchPage(session.user.id, params.q ?? "", { tab: params.tab, topicId: params.topic });
  return <ResearchHome data={data} />;
}

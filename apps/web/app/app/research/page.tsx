import type { Metadata } from "next";
import { ResearchPage } from "../../../components/application/ProductPages";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getResearchPage } from "../../../lib/research/service";

export const metadata: Metadata = { title: "Research | LearnSpace" };

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ q?: string }> };

export default async function ResearchRoute({ searchParams }: Props) {
  const session = await requireCompletedSession();
  const params = searchParams ? await searchParams : {};
  return <ResearchPage data={await getResearchPage(session.user.id, params.q ?? "")} />;
}

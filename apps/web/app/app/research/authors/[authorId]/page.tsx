import type { Metadata } from "next";
import { ResearchAuthorPage } from "../../../../../components/research/ResearchAuthorPage";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getResearchAuthorPage } from "../../../../../lib/research/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ authorId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { authorId } = await params;
  const session = await requireCompletedSession();
  const result = await getResearchAuthorPage(session.user.id, authorId);
  return { title: `${result.author.name} | Research | LearnSpace` };
}

export default async function ResearchAuthorRoute({ params }: Props) {
  const session = await requireCompletedSession();
  const { authorId } = await params;
  const result = await getResearchAuthorPage(session.user.id, authorId);
  return <ResearchAuthorPage {...result} />;
}

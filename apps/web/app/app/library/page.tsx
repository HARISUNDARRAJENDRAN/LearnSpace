import type { Metadata } from "next";
import { LibraryPage } from "../../../components/library/LibraryPage";
import { ResearchLibrary } from "../../../components/research/ResearchLibrary";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { listWatchLater } from "../../../lib/library/watch-later";
import { getResearchLibrary } from "../../../lib/research/service";
import { listStudySessions } from "../../../lib/study/service";

export const metadata: Metadata = { title: "Library | LearnSpace" };

export const dynamic = "force-dynamic";

export default async function LibraryRoute({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const session = await requireCompletedSession();
  // Research keeps its own shelf; Learn's Library never mixes papers in with videos.
  if ((await searchParams).view === "papers") return <ResearchLibrary data={await getResearchLibrary(session.user.id)} />;
  const [sessions, watchLater] = await Promise.all([listStudySessions(session.user.id, "library"), listWatchLater(session.user.id)]);
  return <LibraryPage sessions={sessions.filter((item) => item.activeResource?.type !== "paper")} watchLater={watchLater} />;
}

import type { Metadata } from "next";
import { LibraryPage } from "../../../components/library/LibraryPage";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { listWatchLater } from "../../../lib/library/watch-later";
import { listStudySessions } from "../../../lib/study/service";

export const metadata: Metadata = { title: "Library | LearnSpace" };

export const dynamic = "force-dynamic";

export default async function LibraryRoute() {
  const session = await requireCompletedSession();
  const [sessions, watchLater] = await Promise.all([listStudySessions(session.user.id, "library"), listWatchLater(session.user.id)]);
  return <LibraryPage sessions={sessions} watchLater={watchLater} />;
}

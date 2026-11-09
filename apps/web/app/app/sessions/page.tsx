import type { Metadata } from "next";
import { SessionsPage } from "../../../components/application/ProductPages";
import { StudyWorkspace } from "../../../components/study/StudyWorkspace";
import { VideoSession } from "../../../components/study/VideoSession";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { findCurrentStudySession, getStudySession } from "../../../lib/study/service";

export const metadata: Metadata = { title: "Sessions | LearnSpace" };

export const dynamic = "force-dynamic";

/** Sessions is the current study session itself, rendered in place so there is no redirect hop. */
export default async function SessionsRoute() {
  const auth = await requireCompletedSession();
  const current = await findCurrentStudySession(auth.user.id);
  if (!current) return <SessionsPage />;
  const session = await getStudySession(auth.user.id, current.id);
  const key = `${session.id}:${session.activeResourceId}`;
  if (session.activeResource?.type === "video") return <VideoSession key={key} session={session} active={session.activeResource} />;
  if (session.activeResource?.type === "paper") return <StudyWorkspace key={key} session={session} />;
  return <SessionsPage />;
}

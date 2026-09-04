import { notFound, redirect } from "next/navigation";
import { StudyWorkspace } from "../../../../../components/study/StudyWorkspace";
import { AuthError } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getStudySession } from "../../../../../lib/study/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ sessionId: string }> };

export default async function PaperStudyRoute({ params }: Props) {
  const auth = await requireCompletedSession();
  const { sessionId } = await params;
  try {
    const session = await getStudySession(auth.user.id, sessionId);
    if (session.activeResource?.type === "video") redirect(`/app/study/video/${sessionId}`);
    if (!session.activeResource) notFound();
    return <StudyWorkspace session={session} kind="paper" />;
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
}

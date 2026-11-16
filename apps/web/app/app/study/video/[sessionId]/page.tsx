import { notFound, redirect } from "next/navigation";
import { VideoSession } from "../../../../../components/study/VideoSession";
import { AuthError } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getStudySession } from "../../../../../lib/study/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ sessionId: string }> };

export default async function VideoStudyRoute({ params }: Props) {
  const auth = await requireCompletedSession();
  const { sessionId } = await params;
  try {
    const session = await getStudySession(auth.user.id, sessionId, { seen: true });
    if (session.activeResource?.type === "paper") redirect(`/app/study/paper/${sessionId}`);
    if (!session.activeResource) notFound();
    return <VideoSession key={`${session.id}:${session.activeResourceId}`} session={session} active={session.activeResource} />;
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
}

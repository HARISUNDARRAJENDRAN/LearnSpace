import { notFound, redirect } from "next/navigation";
import { PaperSession } from "../../../../../components/research/PaperSession";
import { AuthError } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { requestPaperIngestion } from "../../../../../lib/research/ingestion";
import { getStudySession } from "../../../../../lib/study/service";

export const dynamic = "force-dynamic";
// Opening an unparsed paper parses it in the background: download, parse, reference resolution and embeddings (under a minute).
export const maxDuration = 300;

type Props = { params: Promise<{ sessionId: string }> };

export default async function PaperStudyRoute({ params }: Props) {
  const auth = await requireCompletedSession();
  const { sessionId } = await params;
  try {
    const session = await getStudySession(auth.user.id, sessionId, { seen: true });
    if (session.activeResource?.type === "video") redirect(`/app/study/video/${sessionId}`);
    if (!session.activeResource) notFound();
    if (session.activeResource.readiness === "preparing") requestPaperIngestion(session.activeResource.resourceId);
    return <PaperSession key={`${session.id}:${session.activeResourceId}`} session={session} active={session.activeResource} />;
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
}

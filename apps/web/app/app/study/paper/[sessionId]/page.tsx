import { notFound, redirect } from "next/navigation";
import { PaperSession } from "../../../../../components/research/PaperSession";
import { AuthError } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { folderIdForSession } from "../../../../../lib/folders/service";
import { requestPaperIngestion } from "../../../../../lib/research/ingestion";
import { getStudySession } from "../../../../../lib/study/service";

export const dynamic = "force-dynamic";
// Opening an unparsed paper parses it in the background: download, parse, reference resolution and embeddings (under a minute).
export const maxDuration = 300;

type Props = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PaperStudyRoute({ params, searchParams }: Props) {
  const auth = await requireCompletedSession();
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  try {
    const [session, folderId] = await Promise.all([
      getStudySession(auth.user.id, sessionId, { seen: true }),
      folderIdForSession(auth.user.id, sessionId),
    ]);
    const currentFolder = typeof query.folder === "string" ? query.folder : null;
    if (folderId && currentFolder !== folderId) {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (typeof value === "string") next.set(key, value);
      }
      next.set("folder", folderId);
      if (!next.has("folderMode")) next.set("folderMode", "research");
      const targetPath = session.activeResource?.type === "video" ? `/app/study/video/${sessionId}` : `/app/study/paper/${sessionId}`;
      redirect(`${targetPath}?${next.toString()}`);
    }
    if (session.activeResource?.type === "video") redirect(`/app/study/video/${sessionId}`);
    if (!session.activeResource) notFound();
    if (session.activeResource.readiness !== "ready") {
      await requestPaperIngestion(session.activeResource.resourceId, session.activeResource.readiness === "unavailable");
    }
    return <PaperSession key={`${session.id}:${session.activeResourceId}`} session={session} active={session.activeResource} />;
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
}

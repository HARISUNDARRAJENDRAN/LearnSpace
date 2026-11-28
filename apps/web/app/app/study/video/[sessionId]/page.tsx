import { notFound, redirect } from "next/navigation";
import { VideoSession } from "../../../../../components/study/VideoSession";
import { AuthError } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { folderIdForSession } from "../../../../../lib/folders/service";
import { getStudySession } from "../../../../../lib/study/service";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VideoStudyRoute({ params, searchParams }: Props) {
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
      const targetPath = session.activeResource?.type === "paper" ? `/app/study/paper/${sessionId}` : `/app/study/video/${sessionId}`;
      redirect(`${targetPath}?${next.toString()}`);
    }
    if (session.activeResource?.type === "paper") redirect(`/app/study/paper/${sessionId}`);
    if (!session.activeResource) notFound();
    return <VideoSession key={`${session.id}:${session.activeResourceId}`} session={session} active={session.activeResource} />;
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
}

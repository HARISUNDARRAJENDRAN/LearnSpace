import { folderSessionCandidatesQuerySchema, sessionFolderIdSchema } from "@learnspace/shared";
import { authErrorResponse } from "@/lib/auth/errors";
import { requireCompletedSession } from "@/lib/discovery/access";
import { folderSessionCandidates } from "@/lib/folders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  try {
    const { user } = await requireCompletedSession();
    const id = sessionFolderIdSchema.parse((await params).folderId);
    const { q } = folderSessionCandidatesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ sessions: await folderSessionCandidates(user.id, id, q) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

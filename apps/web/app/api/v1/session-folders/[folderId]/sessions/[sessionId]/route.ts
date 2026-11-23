import { sessionFolderIdSchema, studySessionIdSchema } from "@learnspace/shared";
import { authErrorResponse } from "@/lib/auth/errors";
import { requireCompletedSession } from "@/lib/discovery/access";
import { getFolderSessionContents } from "@/lib/library/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ folderId: string; sessionId: string }> }) {
  try {
    const { user } = await requireCompletedSession();
    const { folderId, sessionId } = await context.params;
    const contents = await getFolderSessionContents(user.id, sessionFolderIdSchema.parse(folderId), studySessionIdSchema.parse(sessionId));
    return Response.json(contents, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

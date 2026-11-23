import { studySessionIdSchema } from "@learnspace/shared";
import { authErrorResponse } from "@/lib/auth/errors";
import { requireCompletedSession } from "@/lib/discovery/access";
import { getEndedSessionContents } from "@/lib/library/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { user } = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await params).sessionId);
    return Response.json(await getEndedSessionContents(user.id, sessionId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

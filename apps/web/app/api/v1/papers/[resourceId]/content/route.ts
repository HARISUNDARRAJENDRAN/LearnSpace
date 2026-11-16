import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { getPaperContent } from "../../../../../../lib/research/paper-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ resourceId: string }> };

/** The parsed paper (passages, sections, bibliography) that Focus mode, the outline and citation popovers read. */
export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const resourceId = z.string().uuid().parse((await context.params).resourceId);
    return Response.json(await getPaperContent(session.user.id, resourceId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

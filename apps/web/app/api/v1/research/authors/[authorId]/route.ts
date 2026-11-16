import { NextResponse } from "next/server";
import { researchAuthorFollowRequestSchema } from "@learnspace/shared";
import { AuthError, authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { followResearchAuthor, unfollowResearchAuthor } from "../../../../../../lib/research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ authorId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const session = await requireCompletedSession();
    const authorId = (await params).authorId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authorId)) throw new AuthError("INVALID_AUTHOR_ID", "Choose a valid catalogue author.", 400);
    const body = researchAuthorFollowRequestSchema.parse(await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); }));
    const result = body.follow ? await followResearchAuthor(session.user.id, authorId) : await unfollowResearchAuthor(session.user.id, authorId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

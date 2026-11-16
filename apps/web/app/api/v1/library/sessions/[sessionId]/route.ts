import { studySessionIdSchema } from "@learnspace/shared";
import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { getLibrarySessionContents } from "../../../../../../lib/library/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

/** A finished session's notes, conversations and code, read when its folder is opened in the Library. */
export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    return NextResponse.json(await getLibrarySessionContents(session.user.id, sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

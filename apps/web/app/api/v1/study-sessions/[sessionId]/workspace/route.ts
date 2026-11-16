import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { saveStudyWorkspace } from "../../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

/** Merges the keys sent (open tool, canvas view, code draft) into the session's saved workspace. */
export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    await saveStudyWorkspace(session.user.id, sessionId, await readJson(request));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

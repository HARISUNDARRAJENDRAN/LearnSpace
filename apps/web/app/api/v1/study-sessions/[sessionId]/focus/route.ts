import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { recordStudyFocus, studyFocusIntervalSchema } from "../../../../../../lib/study/focus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    const input = studyFocusIntervalSchema.parse(await readJson(request));
    return NextResponse.json(await recordStudyFocus(session.user.id, sessionId, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

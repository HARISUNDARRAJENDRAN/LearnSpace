import { studySessionIdSchema } from "@learnspace/shared";
import { masteryAnswerRequestSchema } from "@learnspace/shared/mastery";
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse } from "../../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { answerMastery } from "../../../../../../../lib/mastery/service";
import { admitMasteryRequest, admitTutorInteraction } from "../../../../../../../lib/tutor/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A written answer is graded with reasoning; the model call itself times out first.
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

/** Answers one question: multiple choice is graded at once from the stored key, a written answer by the model. */
export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    const body = await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); });
    const input = masteryAnswerRequestSchema.parse(body);
    await ("text" in input ? admitMasteryRequest(session.user.id) : admitTutorInteraction(session.user.id));
    return NextResponse.json(await answerMastery(session.user.id, sessionId, input, { signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

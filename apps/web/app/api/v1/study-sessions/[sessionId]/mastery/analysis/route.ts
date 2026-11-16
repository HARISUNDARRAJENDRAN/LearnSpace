import { studySessionIdSchema } from "@learnspace/shared";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, authErrorResponse } from "../../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { startAnalysis } from "../../../../../../../lib/mastery/service";
import { admitMasteryRequest } from "../../../../../../../lib/tutor/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The analysis is written after the answer, within this limit; its model call stops at 270 s.
export const maxDuration = 300;

type Context = { params: Promise<{ sessionId: string }> };
const requestSchema = z.object({ checkId: z.string().uuid() }).strict();

/** Starts the learning analysis of a scored set unless it is written already; the set comes back at once, saying so. */
export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    const body = await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); });
    await admitMasteryRequest(session.user.id);
    const { view, write } = await startAnalysis(session.user.id, sessionId, requestSchema.parse(body).checkId);
    // An analysis that fails is marked so (or times out of "writing"), and the results page can ask for it again.
    if (write) after(() => write().catch(() => undefined));
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

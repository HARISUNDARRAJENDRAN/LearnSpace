import { studySessionIdSchema } from "@learnspace/shared";
import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { getMastery, startMastery } from "../../../../../../lib/mastery/service";
import { admitMasteryRequest } from "../../../../../../lib/tutor/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Writing a set reasons over the whole transcript; the model call itself times out first.
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

/** The active video's mastery check: whether it is unlocked, and the latest set without unearned answer keys. */
export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    return NextResponse.json(await getMastery(session.user.id, sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** Starts a set (or returns the one already open). */
export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await admitMasteryRequest(session.user.id);
    return NextResponse.json(await startMastery(session.user.id, sessionId, { signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

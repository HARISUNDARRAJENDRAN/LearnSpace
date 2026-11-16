import { studySessionIdSchema } from "@learnspace/shared";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { getMastery, startMastery } from "../../../../../../lib/mastery/service";
import { admitMasteryRequest } from "../../../../../../lib/tutor/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Writing a set reasons over the whole transcript, and goes on after the first question is answered; the model call times out first.
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

/**
 * The active video's mastery check: whether it is unlocked, and the latest set without unearned answer keys. `?check=` reads
 * one set of this session instead, so a passed set's results stay readable after the session moves on to the next lesson.
 */
export async function GET(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    const check = new URL(request.url).searchParams.get("check");
    return NextResponse.json(await getMastery(session.user.id, sessionId, check === null ? undefined : z.string().uuid().parse(check)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** Starts a set (or returns the one already open), answering once its first question is written; the rest follow into it. */
export async function POST(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await admitMasteryRequest(session.user.id);
    return NextResponse.json(await startMastery(session.user.id, sessionId, { keepAlive: after }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

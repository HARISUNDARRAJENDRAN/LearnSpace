import { studySessionIdSchema } from "@learnspace/shared";
import { after, NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { startGuide } from "../../../../../../../lib/notes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The guide is written after the answer, within this limit; its model call stops at 270 s.
export const maxDuration = 300;

type Context = { params: Promise<{ sessionId: string }> };

/** Starts the video's study guide if it isn't written yet; the notes come back at once, saying it is being written. */
export async function POST(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    const { notes, write } = await startGuide(session.user.id, sessionId);
    // A guide that fails is marked so, or its run times out of "writing"; either way the next open can start it again.
    if (write) after(() => write().catch(() => undefined));
    return NextResponse.json(notes, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

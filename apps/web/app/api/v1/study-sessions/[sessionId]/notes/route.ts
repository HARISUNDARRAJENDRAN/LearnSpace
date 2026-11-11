import { studySessionIdSchema } from "@learnspace/shared";
import { notesEditRequestSchema } from "@learnspace/shared/notes";
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { editNotes, getNotes } from "../../../../../../lib/notes/service";
import { admitTutorInteraction } from "../../../../../../lib/tutor/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    return NextResponse.json(await getNotes(session.user.id, sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** The learner's own edits to the notes, or undoing Luna's last edit. */
export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await admitTutorInteraction(session.user.id);
    const body = await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); });
    return NextResponse.json(await editNotes(session.user.id, sessionId, notesEditRequestSchema.parse(body)));
  } catch (error) {
    return authErrorResponse(error);
  }
}

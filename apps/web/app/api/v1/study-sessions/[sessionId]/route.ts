import { NextResponse } from "next/server";
import { studySessionActionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { endStudySession, getStudySession, pauseSession, renameStudySession } from "../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    return NextResponse.json(await getStudySession(session.user.id, sessionId));
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** `{ title }` renames the session; `{ action }` pauses or completes it. */
export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    const body = await readJson(request);
    if (body && typeof body === "object" && "title" in body) {
      await renameStudySession(session.user.id, sessionId, body);
      return NextResponse.json({ ok: true });
    }
    const input = studySessionActionRequestSchema.parse(body);
    await pauseSession(session.user.id, sessionId, input.idempotencyKey, input.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    await endStudySession(session.user.id, sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

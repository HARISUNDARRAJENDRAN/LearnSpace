import { NextResponse } from "next/server";
import { studySessionActionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getStudySession, pauseSession } from "../../../../../lib/study/service";

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

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    const input = studySessionActionRequestSchema.parse(await readJson(request));
    await pauseSession(session.user.id, sessionId, input.idempotencyKey, input.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

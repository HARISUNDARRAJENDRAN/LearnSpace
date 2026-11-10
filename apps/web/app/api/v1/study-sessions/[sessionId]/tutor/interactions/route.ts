import { studySessionIdSchema } from "@learnspace/shared";
import { tutorInteractionRequestSchema } from "@learnspace/shared/tutor";
import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { admitTutorInteraction } from "../../../../../../../lib/tutor/limits";
import { tutorInteraction } from "../../../../../../../lib/tutor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

/** Answers a check or opens a hint on one of the tutor's earlier answers. */
export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await admitTutorInteraction(session.user.id);
    const input = tutorInteractionRequestSchema.parse(await readJson(request));
    return NextResponse.json(await tutorInteraction(session.user.id, sessionId, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

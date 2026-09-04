import { NextResponse } from "next/server";
import { studyProgressRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { updateStudyProgress } from "../../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    const input = studyProgressRequestSchema.parse(await readJson(request));
    return NextResponse.json(await updateStudyProgress(session.user.id, sessionId, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

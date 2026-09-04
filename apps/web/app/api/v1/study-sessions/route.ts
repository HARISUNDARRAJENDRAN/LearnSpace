import { NextResponse } from "next/server";
import { startStudySessionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { readJson } from "../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { startOrResumeStudySession } from "../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const input = startStudySessionRequestSchema.parse(await readJson(request));
    return NextResponse.json(await startOrResumeStudySession(session.user.id, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

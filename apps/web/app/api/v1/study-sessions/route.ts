import { NextResponse } from "next/server";
import { startStudySessionRequestSchema, studySessionsQuerySchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { readJson } from "../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { listStudySessions, startOrResumeStudySession } from "../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The learner's sessions, most recent first; the plan dialog offers them as what to study.
export async function GET(request: Request) {
  try {
    const session = await requireCompletedSession();
    const { shelf } = studySessionsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ sessions: await listStudySessions(session.user.id, shelf) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const input = startStudySessionRequestSchema.parse(await readJson(request));
    return NextResponse.json(await startOrResumeStudySession(session.user.id, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

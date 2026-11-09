import { NextResponse } from "next/server";
import { addCourseRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { importCourseToSessions } from "../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const { slug } = addCourseRequestSchema.parse(await readJson(request));
    return NextResponse.json(await importCourseToSessions(session.user.id, slug));
  } catch (error) {
    return authErrorResponse(error);
  }
}

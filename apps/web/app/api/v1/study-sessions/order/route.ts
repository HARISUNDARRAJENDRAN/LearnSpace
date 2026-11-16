import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { reorderStudySessions } from "../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stores the learner's sidebar order of their sessions. */
export async function PUT(request: Request) {
  try {
    const session = await requireCompletedSession();
    await reorderStudySessions(session.user.id, await readJson(request));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

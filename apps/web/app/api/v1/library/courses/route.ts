import { NextResponse } from "next/server";
import { addCourseRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { addCourseToLibrary } from "../../../../../lib/library/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const { slug } = addCourseRequestSchema.parse(await readJson(request));
    await addCourseToLibrary(session.user.id, slug);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

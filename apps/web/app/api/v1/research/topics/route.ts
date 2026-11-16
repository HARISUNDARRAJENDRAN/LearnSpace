import { NextResponse } from "next/server";
import { researchTopicsRequestSchema } from "@learnspace/shared";
import { AuthError, authErrorResponse } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { setResearchTopics } from "../../../../../lib/research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replaces the reader's Research topics. */
export async function PUT(request: Request) {
  try {
    const session = await requireCompletedSession();
    const body = researchTopicsRequestSchema.parse(await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); }));
    return NextResponse.json(await setResearchTopics(session.user.id, body.conceptIds), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

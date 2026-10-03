import { NextResponse, type NextRequest } from "next/server";
import { discoveryInteractionRequestSchema } from "@learnspace/shared";
import { AuthError, authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { recordInteraction } from "../../../../../lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    const input = discoveryInteractionRequestSchema.parse(await readJson(request));
    if (input.action === "complete" || input.action === "start_session") throw new AuthError("INVALID_DISCOVERY_ACTION", "Start or complete lessons from your study session.", 422);
    return NextResponse.json({ ok: true, ...(await recordInteraction(session.user.id, input)) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

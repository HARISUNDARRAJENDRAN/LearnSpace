import { NextResponse, type NextRequest } from "next/server";
import { discoveryInteractionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { recordInteraction } from "../../../../../lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    const input = discoveryInteractionRequestSchema.parse(await readJson(request));
    return NextResponse.json({ ok: true, ...(await recordInteraction(session.user.id, input)) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

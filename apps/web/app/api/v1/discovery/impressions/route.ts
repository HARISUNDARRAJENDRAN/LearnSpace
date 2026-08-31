import { NextResponse, type NextRequest } from "next/server";
import { discoveryImpressionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { recordImpression } from "../../../../../lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    const input = discoveryImpressionRequestSchema.parse(await readJson(request));
    return NextResponse.json({ ok: true, ...(await recordImpression(session.user.id, input)) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

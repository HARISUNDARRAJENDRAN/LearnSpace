import { NextResponse } from "next/server";
import { startCollectionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { startResearchTrack } from "../../../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ trackId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { trackId } = await context.params;
    const input = startCollectionRequestSchema.parse(await readJson(request));
    return NextResponse.json(await startResearchTrack(session.user.id, trackId, input.idempotencyKey));
  } catch (error) {
    return authErrorResponse(error);
  }
}

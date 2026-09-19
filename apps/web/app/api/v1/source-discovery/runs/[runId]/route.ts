import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { getSourceDiscoveryRun } from "../../../../../../lib/source-discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const session = await requireCompletedSession();
    const { runId } = await context.params;
    z.string().uuid().parse(runId);
    return NextResponse.json(await getSourceDiscoveryRun(session.user.id, runId));
  } catch (error) {
    return authErrorResponse(error);
  }
}

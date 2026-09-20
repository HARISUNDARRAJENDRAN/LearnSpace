import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../../lib/auth/rate-limit";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { getSourceDiscoveryRun } from "../../../../../../lib/source-discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request: _request, bucket: "source-discovery-poll", limit: 60, windowSeconds: 60, identifier: session.user.id });
    const { runId } = await context.params;
    z.string().uuid().parse(runId);
    return NextResponse.json(await getSourceDiscoveryRun(session.user.id, runId));
  } catch (error) {
    return authErrorResponse(error);
  }
}

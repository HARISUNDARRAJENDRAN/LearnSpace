import { NextResponse, type NextRequest } from "next/server";
import { sourceDiscoveryResolveRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { enforceRateLimit } from "../../../../../lib/auth/rate-limit";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { resolveSource } from "../../../../../lib/source-discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request, bucket: "source-discovery-resolve", limit: 12, windowSeconds: 60, identifier: session.user.id });
    const input = sourceDiscoveryResolveRequestSchema.parse(await readJson(request));
    return NextResponse.json({ status: "preview", preview: await resolveSource(session.user.id, input) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

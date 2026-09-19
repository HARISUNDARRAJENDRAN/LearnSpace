import { NextResponse, type NextRequest } from "next/server";
import { sourceDiscoverySearchRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { enforceRateLimit } from "../../../../../lib/auth/rate-limit";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { resolveSource, searchSources } from "../../../../../lib/source-discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request, bucket: "source-discovery-search", limit: 12, windowSeconds: 60, identifier: session.user.id });
    const input = sourceDiscoverySearchRequestSchema.parse(await readJson(request));
    if (/^https?:\/\//i.test(input.query.trim())) {
      const preview = await resolveSource(session.user.id, { mode: input.mode, url: input.query.trim(), correlationId: input.correlationId });
      return NextResponse.json({ status: "preview", runId: null, mode: input.mode, query: input.query, candidates: [], preview });
    }
    return NextResponse.json(await searchSources(session.user.id, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

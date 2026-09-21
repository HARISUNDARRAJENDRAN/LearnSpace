import { sourceDiscoverySearchRequestSchema } from "@learnspace/shared";
import { after, type NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../lib/auth/rate-limit";
import { readJson } from "../../../../../lib/auth/request";
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
    const result = await searchSources(session.user.id, input, (work) => after(work));
    const response = NextResponse.json(result);
    if (result.timings) {
      response.headers.set("Server-Timing", [
        result.timings.cacheMs === undefined ? null : `cache;dur=${result.timings.cacheMs}`,
        result.timings.catalogMs === undefined ? null : `catalog;dur=${result.timings.catalogMs}`,
        result.timings.exaMs === undefined ? null : `exa;dur=${result.timings.exaMs}`,
        result.timings.providerMs === undefined ? null : `provider;dur=${result.timings.providerMs}`,
        result.timings.rankMs === undefined ? null : `rank;dur=${result.timings.rankMs}`,
        result.timings.persistMs === undefined ? null : `persist;dur=${result.timings.persistMs}`,
        result.timings.totalMs === undefined ? null : `total;dur=${result.timings.totalMs}`,
      ].filter(Boolean).join(", "));
    }
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

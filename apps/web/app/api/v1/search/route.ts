import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { searchQuerySchema } from "../../../../lib/search/contract";
import { searchWorkspace } from "../../../../lib/search/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireCompletedSession();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { mode, q } = searchQuerySchema.parse(params);
    return NextResponse.json({ mode, results: await searchWorkspace(session.user.id, q, mode) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { searchWorkspace } from "../../../../lib/search/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireCompletedSession();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ results: await searchWorkspace(session.user.id, query) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

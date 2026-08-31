import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getHomeFeed } from "../../../../../lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireCompletedSession();
    return NextResponse.json(await getHomeFeed(session.user.id, "discover"));
  } catch (error) {
    return authErrorResponse(error);
  }
}

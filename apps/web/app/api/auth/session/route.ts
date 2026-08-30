import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { getCurrentSession, publicUser } from "../../../../lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentSession = await getCurrentSession();
    if (!currentSession) {
      return NextResponse.json(
        { authenticated: false, user: null },
        { status: 401 },
      );
    }

    return NextResponse.json({
      authenticated: true,
      user: publicUser(currentSession.user),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

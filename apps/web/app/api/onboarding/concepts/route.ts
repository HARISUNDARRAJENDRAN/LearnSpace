import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { requireCurrentSession } from "../../../../lib/auth/session";
import { searchOnboardingConcepts } from "../../../../lib/onboarding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.string().trim().max(80);

export async function GET(request: NextRequest) {
  try {
    const session = await requireCurrentSession();
    const query = querySchema.parse(request.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({
      ok: true,
      concepts: await searchOnboardingConcepts(session.user.id, query),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

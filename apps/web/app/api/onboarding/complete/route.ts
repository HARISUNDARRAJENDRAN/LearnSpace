import { NextResponse, type NextRequest } from "next/server";
import { onboardingCompletionSchema } from "@learnspace/shared/onboarding";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { requireCurrentSession } from "../../../../lib/auth/session";
import { completeOnboarding, getAuthenticatedDestination } from "../../../../lib/onboarding/service";
import { readJson } from "../../../../lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCurrentSession();
    const completion = onboardingCompletionSchema.parse(await readJson(request));
    const state = await completeOnboarding(session.user.id, completion);
    return NextResponse.json({
      ok: true,
      state,
      destination: await getAuthenticatedDestination(session.user.id),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

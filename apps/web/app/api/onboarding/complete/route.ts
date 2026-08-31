import { NextResponse, type NextRequest } from "next/server";
import { onboardingCompletionSchema } from "@learnspace/shared/onboarding";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { requireCurrentSession } from "../../../../lib/auth/session";
import { completeOnboarding } from "../../../../lib/onboarding/service";
import { readJson } from "../../../../lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireCurrentSession();
    const completion = onboardingCompletionSchema.parse(await readJson(request));
    return NextResponse.json({
      ok: true,
      state: await completeOnboarding(session.user.id, completion),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

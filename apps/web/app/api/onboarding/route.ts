import { NextResponse, type NextRequest } from "next/server";
import { onboardingDraftRequestSchema } from "@learnspace/shared/onboarding";
import { authErrorResponse } from "../../../lib/auth/errors";
import { requireCurrentSession } from "../../../lib/auth/session";
import { getOnboardingState, saveOnboardingDraft } from "../../../lib/onboarding/service";
import { readJson } from "../../../lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireCurrentSession();
    return NextResponse.json({ ok: true, state: await getOnboardingState(session.user.id) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireCurrentSession();
    const draft = onboardingDraftRequestSchema.parse(await readJson(request));
    return NextResponse.json({
      ok: true,
      state: await saveOnboardingDraft(session.user.id, draft),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

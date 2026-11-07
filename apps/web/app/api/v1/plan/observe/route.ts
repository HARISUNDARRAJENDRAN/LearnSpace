import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { observePlan } from "../../../../../lib/plan/observer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One observer tick: reconcile the plan with recorded study and refresh the agent's next actions.
export async function POST() {
  try {
    const session = await requireCompletedSession();
    return NextResponse.json(await observePlan(session.user.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}

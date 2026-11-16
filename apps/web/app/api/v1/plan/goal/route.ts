import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { goalPlanSchema, planGoal } from "../../../../../lib/plan/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Turns the learner's current goal into a few all-day to-dos on their calendar.
export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const input = goalPlanSchema.parse(await readJson(request));
    return NextResponse.json(await planGoal(session.user.id, input), { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

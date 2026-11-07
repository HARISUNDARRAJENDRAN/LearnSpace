import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { readJson } from "../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { createPlanItem, listPlanItems, planItemInputSchema } from "../../../../lib/plan/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireCompletedSession();
    const params = new URL(request.url).searchParams;
    return NextResponse.json({ items: await listPlanItems(session.user.id, params.get("from") ?? "", params.get("to") ?? "") });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const input = planItemInputSchema.parse(await readJson(request));
    return NextResponse.json({ item: await createPlanItem(session.user.id, input) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

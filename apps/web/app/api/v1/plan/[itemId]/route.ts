import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { tickPlanItem } from "../../../../../lib/plan/observer";
import { deletePlanItem, getPlanItem, planItemPatchSchema, planTickSchema, updatePlanItem } from "../../../../../lib/plan/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ itemId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { itemId } = await context.params;
    const body = await readJson(request);
    // A tick is a request to verify: the reply says whether recorded study backs it.
    if (body && typeof body === "object" && "done" in body) {
      const tick = await tickPlanItem(session.user.id, itemId, planTickSchema.parse(body).done);
      return NextResponse.json({ item: await getPlanItem(session.user.id, itemId), tick });
    }
    return NextResponse.json({ item: await updatePlanItem(session.user.id, itemId, planItemPatchSchema.parse(body)) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { itemId } = await context.params;
    await deletePlanItem(session.user.id, itemId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

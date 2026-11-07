import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { deletePlanItem, planItemPatchSchema, updatePlanItem } from "../../../../../lib/plan/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ itemId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { itemId } = await context.params;
    const patch = planItemPatchSchema.parse(await readJson(request));
    return NextResponse.json({ item: await updatePlanItem(session.user.id, itemId, patch) });
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

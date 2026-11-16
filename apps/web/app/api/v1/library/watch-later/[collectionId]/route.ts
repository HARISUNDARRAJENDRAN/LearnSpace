import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { removeFromWatchLater } from "../../../../../../lib/library/watch-later";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ collectionId: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    await removeFromWatchLater(session.user.id, (await context.params).collectionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

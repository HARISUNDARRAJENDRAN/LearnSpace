import { NextResponse } from "next/server";
import { startCollectionRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { startLibraryCollection } from "../../../../../../../lib/library/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ collectionId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { collectionId } = await context.params;
    const input = startCollectionRequestSchema.parse(await readJson(request));
    return NextResponse.json(await startLibraryCollection(session.user.id, collectionId, input.idempotencyKey));
  } catch (error) {
    return authErrorResponse(error);
  }
}

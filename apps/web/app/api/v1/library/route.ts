import { NextResponse } from "next/server";
import { libraryItemRequestSchema } from "@learnspace/shared";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { readJson } from "../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../lib/discovery/access";
import { saveLibraryItem } from "../../../../lib/library/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireCompletedSession();
    const input = libraryItemRequestSchema.parse(await readJson(request));
    await saveLibraryItem(session.user.id, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

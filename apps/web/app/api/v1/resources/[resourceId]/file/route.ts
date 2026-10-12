import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../../lib/auth/rate-limit";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { deleteDocument, getDocumentDownload } from "../../../../../../lib/storage/resource-uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request, bucket: "document-download", limit: 120, windowSeconds: 3600, identifier: session.user.id });
    const { resourceId } = await context.params;
    z.string().uuid().parse(resourceId);
    const url = await getDocumentDownload(session.user.id, resourceId);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request, bucket: "document-delete", limit: 20, windowSeconds: 3600, identifier: session.user.id });
    const { resourceId } = await context.params;
    z.string().uuid().parse(resourceId);
    return NextResponse.json(await deleteDocument(session.user.id, resourceId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

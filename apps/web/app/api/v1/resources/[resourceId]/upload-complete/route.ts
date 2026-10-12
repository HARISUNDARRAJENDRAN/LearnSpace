import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../../lib/auth/rate-limit";
import { readJson } from "../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { completeDocumentUpload } from "../../../../../../lib/storage/resource-uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ versionId: z.string().uuid() });

export async function POST(request: NextRequest, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request, bucket: "document-upload-complete", limit: 20, windowSeconds: 3600, identifier: session.user.id });
    const { resourceId } = await context.params;
    const input = requestSchema.parse(await readJson(request));
    z.string().uuid().parse(resourceId);
    return NextResponse.json(await completeDocumentUpload(session.user.id, resourceId, input.versionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

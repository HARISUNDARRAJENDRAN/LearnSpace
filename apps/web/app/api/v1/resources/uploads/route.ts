import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../lib/auth/rate-limit";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { createDocumentUpload } from "../../../../../lib/storage/resource-uploads";
import { MAX_PRIVATE_DOCUMENT_BYTES } from "@learnspace/shared/private-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.literal("application/pdf"),
  byteSize: z.number().int().positive().max(MAX_PRIVATE_DOCUMENT_BYTES),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    await enforceRateLimit({ request, bucket: "document-upload", limit: 10, windowSeconds: 3600, identifier: session.user.id });
    const input = requestSchema.parse(await readJson(request));
    return NextResponse.json(await createDocumentUpload(session.user.id, input), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

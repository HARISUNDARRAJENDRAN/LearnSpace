import { folderShareMutationSchema, sessionFolderIdSchema } from "@learnspace/shared";
import { getAppBaseUrl } from "@/lib/auth/config";
import { AuthError, authErrorResponse } from "@/lib/auth/errors";
import { enforceRateLimit } from "@/lib/auth/rate-limit";
import { requireCompletedSession } from "@/lib/discovery/access";
import { assertSameOrigin, createOrRotateFolderShare, getFolderShare, revokeFolderShare } from "@/lib/folders/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ folderId: string }> };

const securityHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

async function readOptionalShareMutation(request: Request) {
  const raw = await request.text();
  if (raw.trim().length === 0) return { rotate: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthError("INVALID_JSON", "Send a valid JSON request body.");
  }
  return folderShareMutationSchema.parse(parsed);
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { user } = await requireCompletedSession();
    const folderId = sessionFolderIdSchema.parse((await params).folderId);
    const state = await getFolderShare(user.id, folderId, getAppBaseUrl(request));
    return Response.json(state, { headers: securityHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { user } = await requireCompletedSession();
    await enforceRateLimit({
      request,
      bucket: "folder-share-manage",
      identifier: user.id,
      limit: 30,
      windowSeconds: 10 * 60,
    });
    const folderId = sessionFolderIdSchema.parse((await params).folderId);
    const input = await readOptionalShareMutation(request);
    const state = await createOrRotateFolderShare(user.id, folderId, getAppBaseUrl(request), input);
    return Response.json(state, { headers: securityHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { user } = await requireCompletedSession();
    await enforceRateLimit({
      request,
      bucket: "folder-share-manage",
      identifier: user.id,
      limit: 30,
      windowSeconds: 10 * 60,
    });
    const folderId = sessionFolderIdSchema.parse((await params).folderId);
    const state = await revokeFolderShare(user.id, folderId);
    return Response.json(state, { headers: securityHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}

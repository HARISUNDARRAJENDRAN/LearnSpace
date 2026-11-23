import { changeSessionFolderSchema, sessionFolderDetailsQuerySchema, sessionFolderIdSchema } from "@learnspace/shared";
import { authErrorResponse } from "@/lib/auth/errors";
import { readJson } from "@/lib/auth/request";
import { requireCompletedSession } from "@/lib/discovery/access";
import { getSessionFolderDetails } from "@/lib/folders/details";
import { changeSessionFolder, deleteSessionFolder } from "@/lib/folders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ folderId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { user } = await requireCompletedSession();
    const id = sessionFolderIdSchema.parse((await params).folderId);
    const query = sessionFolderDetailsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getSessionFolderDetails(user.id, id, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user } = await requireCompletedSession();
    const id = sessionFolderIdSchema.parse((await params).folderId);
    const input = changeSessionFolderSchema.parse(await readJson(request));
    return Response.json(await changeSessionFolder(user.id, id, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { user } = await requireCompletedSession();
    const id = sessionFolderIdSchema.parse((await params).folderId);
    await deleteSessionFolder(user.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

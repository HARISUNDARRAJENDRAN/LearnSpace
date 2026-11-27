import { changeSessionFolderSchema, sessionFolderIdSchema } from "@learnspace/shared";
import { authErrorResponse } from "@/lib/auth/errors";
import { readJson } from "@/lib/auth/request";
import { requireCompletedSession } from "@/lib/discovery/access";
import { getSessionFolderDetails } from "@/lib/folders/details";
import { requestPaperIngestion } from "@/lib/research/ingestion";
import { changeSessionFolder, deleteSessionFolder } from "@/lib/folders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ folderId: string }> };

export const maxDuration = 300;

export async function GET(_request: Request, { params }: Context) {
  try {
    const { user } = await requireCompletedSession();
    const id = sessionFolderIdSchema.parse((await params).folderId);
    const folder = await getSessionFolderDetails(user.id, id);
    // Claims are deduplicated by the paper ingestion lease.
    await Promise.all(folder.materials.filter((item) => item.type === "paper" && item.state === "preparing")
      .map((item) => requestPaperIngestion(item.id)));
    return Response.json(folder, { headers: { "Cache-Control": "private, no-store" } });
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

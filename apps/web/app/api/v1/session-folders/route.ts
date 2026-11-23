import { createSessionFolderSchema } from "@learnspace/shared";
import { authErrorResponse } from "@/lib/auth/errors";
import { readJson } from "@/lib/auth/request";
import { requireCompletedSession } from "@/lib/discovery/access";
import { createSessionFolder, listSessionFolders } from "@/lib/folders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await requireCompletedSession();
    return Response.json({ folders: await listSessionFolders(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireCompletedSession();
    const input = createSessionFolderSchema.parse(await readJson(request));
    return Response.json(await createSessionFolder(user.id, input), { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

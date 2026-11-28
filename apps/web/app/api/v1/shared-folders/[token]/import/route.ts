import { authErrorResponse } from "@/lib/auth/errors";
import { enforceRateLimit } from "@/lib/auth/rate-limit";
import { requireCompletedSession } from "@/lib/discovery/access";
import { assertSameOrigin, importSharedFolder } from "@/lib/folders/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ token: string }> };

const securityHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function POST(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { user } = await requireCompletedSession();
    await enforceRateLimit({
      request,
      bucket: "folder-share-import",
      identifier: user.id,
      limit: 20,
      windowSeconds: 10 * 60,
    });
    const { token } = await params;
    const result = await importSharedFolder(user.id, token);
    return Response.json(result, { headers: securityHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}

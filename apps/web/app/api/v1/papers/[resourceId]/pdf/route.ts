import { z } from "zod";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { fetchTrustedPdf, paperPdfUrl } from "../../../../../../lib/research/pdf-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ resourceId: string }> };

/** Streams a catalogue paper's verified PDF so the in-app reader can render it (arXiv sends no CORS headers). */
export async function GET(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const resourceId = z.string().uuid().parse((await context.params).resourceId);
    const pdf = await fetchTrustedPdf(await paperPdfUrl(session.user.id, resourceId), request.signal);
    return new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        ...(pdf.length ? { "Content-Length": String(pdf.length) } : {}),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

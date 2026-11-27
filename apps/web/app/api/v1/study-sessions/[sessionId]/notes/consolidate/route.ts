import { sessionFolderIdSchema, studySessionIdSchema } from "@learnspace/shared";
import type { ScribeEvent } from "@learnspace/shared/notes";
import { NextResponse } from "next/server";
import { authErrorResponse, AuthError } from "../../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { runScribe } from "../../../../../../../lib/notes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

/**
 * One scribe pass over the recent conversation. A page that accepts NDJSON gets the pass as it runs: each edit as the
 * model finishes writing it, then the saved notebook (or an error with the status it would have had); a bad request is
 * plain JSON with a status. Any other caller (a page loaded before streaming) gets the saved notebook as JSON, as before.
 */
export async function POST(request: Request, context: Context) {
  let userId: string;
  let sessionId: string;
  let resourceId: string | undefined;
  try {
    const session = await requireCompletedSession();
    userId = session.user.id;
    sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    resourceId = sessionFolderIdSchema.optional().parse(new URL(request.url).searchParams.get("resource") ?? undefined);
  } catch (error) {
    return authErrorResponse(error);
  }
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    try {
      return NextResponse.json(await runScribe(userId, sessionId, { ...(resourceId ? { resourceId } : {}), signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return authErrorResponse(error);
    }
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ScribeEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The page went away; the pass still saves.
        }
      };
      try {
        const notes = await runScribe(userId, sessionId, { ...(resourceId ? { resourceId } : {}), signal: request.signal, onOp: (op, base) => emit({ type: "op", op, base }) });
        emit({ type: "notes", notes });
      } catch (error) {
        emit({ type: "error", message: error instanceof AuthError ? error.message : "Luny couldn't update the notes just now.", status: error instanceof AuthError ? error.status : 500 });
      }
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

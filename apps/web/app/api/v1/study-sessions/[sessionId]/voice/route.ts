import { sessionFolderIdSchema, studySessionIdSchema } from "@learnspace/shared";
import { type VoiceTurnEvent, voiceTurnRequestSchema } from "@learnspace/shared/notes";
import { AuthError, authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { runVoiceTurn } from "../../../../../../lib/notes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

/** One spoken turn with Luny. A bad request is plain JSON with a status; once read, the reply streams as NDJSON. */
export async function POST(request: Request, context: Context) {
  let userId: string;
  let sessionId: string;
  let resourceId: string | undefined;
  let input: ReturnType<typeof voiceTurnRequestSchema.parse>;
  try {
    const session = await requireCompletedSession();
    userId = session.user.id;
    sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    resourceId = sessionFolderIdSchema.optional().parse(new URL(request.url).searchParams.get("resource") ?? undefined);
    input = voiceTurnRequestSchema.parse(await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); }));
  } catch (error) {
    return authErrorResponse(error);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: VoiceTurnEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The learner cut Luny off; the turn still records how it ended.
        }
      };
      try {
        await runVoiceTurn(userId, sessionId, input, { ...(resourceId ? { resourceId } : {}), signal: request.signal, emit });
      } catch (error) {
        emit({ type: "error", message: error instanceof AuthError ? error.message : "Luny couldn't answer just now." });
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

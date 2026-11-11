import { studySessionIdSchema } from "@learnspace/shared";
import { type NotesStreamEvent, notesTurnRequestSchema } from "@learnspace/shared/notes";
import { AuthError, authErrorResponse } from "../../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../../lib/discovery/access";
import { runNotesTurn } from "../../../../../../../lib/notes/service";
import { admitNotesTurn } from "../../../../../../../lib/tutor/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

/** One spoken turn with Luna. Admission errors are plain JSON with a status; once admitted, the reply and the notes stream as NDJSON. */
export async function POST(request: Request, context: Context) {
  let userId: string;
  let sessionId: string;
  let input: ReturnType<typeof notesTurnRequestSchema.parse>;
  try {
    const session = await requireCompletedSession();
    userId = session.user.id;
    sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await admitNotesTurn(userId);
    const body = await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); });
    input = notesTurnRequestSchema.parse(body);
  } catch (error) {
    return authErrorResponse(error);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: NotesStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The learner left or cut Luna off; the turn still records how it ended.
        }
      };
      try {
        await runNotesTurn(userId, sessionId, input, { signal: request.signal, emit });
      } catch (error) {
        emit({ type: "error", message: error instanceof AuthError ? error.message : "Luna couldn't answer just now." });
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

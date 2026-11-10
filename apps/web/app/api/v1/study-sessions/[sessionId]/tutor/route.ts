import { studySessionIdSchema } from "@learnspace/shared";
import { type TutorStreamEvent, tutorTurnRequestSchema } from "@learnspace/shared/tutor";
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { admitTutorRequest } from "../../../../../../lib/tutor/limits";
import { admitTutorTurn, endTutorThread, getTutorThread, runTutorTurn } from "../../../../../../lib/tutor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// High reasoning can think for a minute or more; the model call itself times out first.
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };
const MAX_BODY_BYTES = 8_192;

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    return NextResponse.json(await getTutorThread(session.user.id, sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** Asks the tutor. Admission errors are plain JSON with a status; once admitted, progress and the answer stream as NDJSON. */
export async function POST(request: Request, context: Context) {
  let turn: Awaited<ReturnType<typeof admitTutorTurn>>;
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await admitTutorRequest(session.user.id);
    const body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) throw new AuthError("REQUEST_TOO_LARGE", "That question is too long.", 413);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new AuthError("INVALID_JSON", "Send a valid JSON request body.");
    }
    turn = await admitTutorTurn(session.user.id, sessionId, tutorTurnRequestSchema.parse(json));
  } catch (error) {
    return authErrorResponse(error);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TutorStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The learner left; the turn still records how it ended.
        }
      };
      if (turn.kind === "replay") {
        emit({ type: "accepted", user: turn.user, assistantId: turn.assistant.id });
        emit({ type: "done", message: turn.assistant });
      } else {
        emit({ type: "accepted", user: turn.user, assistantId: turn.assistantId });
        const message = await runTutorTurn(turn, { signal: request.signal, emit });
        if (message) emit({ type: "done", message });
      }
      try {
        controller.close();
      } catch {
        // Already closed by the learner leaving.
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** Starts the conversation for this video over. */
export async function DELETE(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    await endTutorThread(session.user.id, sessionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

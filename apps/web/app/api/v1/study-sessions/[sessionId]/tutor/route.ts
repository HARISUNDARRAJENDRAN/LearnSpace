import { studySessionIdSchema } from "@learnspace/shared";
import { type TutorStreamEvent, tutorThreadActionSchema, tutorTurnRequestSchema } from "@learnspace/shared/tutor";
import { NextResponse } from "next/server";
import { embedText } from "../../../../../../lib/ai/openai";
import { AuthError, authErrorResponse } from "../../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { requestPaperIngestion } from "../../../../../../lib/research/ingestion";
import { admitTutorRequest } from "../../../../../../lib/tutor/limits";
import { admitTutorTurn, endTutorThread, getTutorThread, resolveTutorDoubt, restoreTutorThread, runTutorTurn } from "../../../../../../lib/tutor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A question that needs reasoning can think for a minute or more; the model call itself times out first. A paper still
// being read in is parsed in the background while the chat polls, which takes under a minute.
export const maxDuration = 300;

type Context = { params: Promise<{ sessionId: string }> };
const MAX_BODY_BYTES = 8_192;

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    const thread = await getTutorThread(session.user.id, sessionId);
    // A failed attempt is retried by the chat's own polling once the request window has passed.
    if (thread.resourceId !== sessionId && thread.resourceType === "paper" && thread.transcript.status === "preparing") await requestPaperIngestion(thread.resourceId);
    return NextResponse.json(thread, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** Asks the tutor. Admission errors are plain JSON with a status; once admitted, progress and the answer stream as NDJSON. */
export async function POST(request: Request, context: Context) {
  let turn: Awaited<ReturnType<typeof admitTutorTurn>>;
  let embedding: Promise<number[] | null> | null = null;
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
    const input = tutorTurnRequestSchema.parse(json);
    // The question is embedded while the turn is admitted; a reply or a doubt is embedded with its context, so it waits.
    embedding = "positionMs" in input && !input.replyTo && !input.doubt ? embedText(input.question, request.signal) : null;
    turn = await admitTutorTurn(session.user.id, sessionId, input);
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
        const early = embedding;
        const message = await runTutorTurn(turn, { signal: request.signal, emit, ...(early ? { embed: () => early } : {}) });
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

/** Restores an earlier conversation about this video, or resolves a doubt in the current one. */
export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
    const body = await request.json().catch(() => { throw new AuthError("INVALID_JSON", "Send a valid JSON request body."); });
    const action = tutorThreadActionSchema.parse(body);
    if (action.action === "restore") await restoreTutorThread(session.user.id, sessionId, action.threadId);
    else await resolveTutorDoubt(session.user.id, sessionId, action.doubtId, action.resolved);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

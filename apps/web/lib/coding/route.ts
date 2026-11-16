import { studySessionIdSchema } from "@learnspace/shared";
import { after, NextResponse } from "next/server";
import type { z } from "zod";
import { AuthError, authErrorResponse } from "../auth/errors";
import { requireCompletedSession } from "../discovery/access";
import { RunnerUnavailableError } from "./runner";
import type { Options } from "./service";

type Context = { params: Promise<{ sessionId: string }> };
type Handler<T> = (input: { userId: string; sessionId: string; body: T; options: Options }) => Promise<unknown>;

const RUNNER_MESSAGES: Record<RunnerUnavailableError["reason"], [string, number]> = {
  not_configured: ["The code runner isn't set up on this server.", 503],
  busy: ["The code runner is busy. Try again in a few seconds.", 503],
  failed: ["The code runner couldn't be reached. Try again in a moment.", 503],
  problem_not_ready: ["This problem isn't ready to grade yet.", 409],
};

/**
 * One coding endpoint: the signed-in learner, their session, a validated body, and errors as JSON. Work that should
 * outlive the response (classifying a lesson, writing the next problem) is kept alive with `after`.
 */
export function codingRoute<T>(schema: z.ZodType<T> | null, handler: Handler<T>, admit?: (userId: string) => Promise<void>) {
  return async (request: Request, context: Context) => {
    try {
      const session = await requireCompletedSession();
      const sessionId = studySessionIdSchema.parse((await context.params).sessionId);
      if (admit) await admit(session.user.id);
      const body = schema ? schema.parse(await request.json().catch(() => ({}))) : (undefined as T);
      const result = await handler({ userId: session.user.id, sessionId, body, options: { keepAlive: (work) => after(work) } });
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof RunnerUnavailableError) {
        const [message, status] = RUNNER_MESSAGES[error.reason];
        return authErrorResponse(new AuthError("CODE_RUNNER_UNAVAILABLE", message, status, error.reason === "busy" ? 5 : undefined));
      }
      return authErrorResponse(error);
    }
  };
}

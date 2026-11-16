import { codingAttemptActionSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { revealSolution } from "../../../../../../../lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Gives up and shows the solution: no credit, and the concept comes back on a changed problem. */
export const POST = codingRoute(codingAttemptActionSchema, ({ userId, sessionId, body, options }) => revealSolution(userId, sessionId, body.attemptId, options));

import { codingAttemptActionSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { skipOptimization } from "../../../../../../../lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Keeps a correct but slow solution, for less credit. */
export const POST = codingRoute(codingAttemptActionSchema, ({ userId, sessionId, body, options }) => skipOptimization(userId, sessionId, body.attemptId, options));

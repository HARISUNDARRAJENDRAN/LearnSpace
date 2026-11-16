import { codingAttemptActionSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { declineOffer } from "../../../../../../../lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Turns down an offered hint; offers then wait a while before coming back. */
export const POST = codingRoute(codingAttemptActionSchema, ({ userId, sessionId, body }) => declineOffer(userId, sessionId, body.attemptId));

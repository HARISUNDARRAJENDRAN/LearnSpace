import { codingStartRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../lib/coding/route";
import { getCodingState, startCoding } from "../../../../../../lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Starting may write and verify a problem in the background (after the response), which can take a few minutes.
export const maxDuration = 300;

/** The session's coding practice for its active video: the lesson's profile, the current problem and concept mastery. */
export const GET = codingRoute(null, ({ userId, sessionId, options }) => getCodingState(userId, sessionId, options));

/** Opens a problem (the lesson's next concept, or `concept`), or starts preparing one; poll until it's open. */
export const POST = codingRoute(codingStartRequestSchema, ({ userId, sessionId, body, options }) => startCoding(userId, sessionId, body, options));

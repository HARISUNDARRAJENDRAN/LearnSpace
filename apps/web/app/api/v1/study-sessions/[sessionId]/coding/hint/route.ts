import { codingHintRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { takeHint } from "../../../../../../../lib/coding/service";
import { admitTutorRequest } from "../../../../../../../lib/tutor/limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The next hint (asked for, or an accepted offer). It lowers what the problem can earn. */
export const POST = codingRoute(codingHintRequestSchema, ({ userId, sessionId, body, options }) => takeHint(userId, sessionId, body, options), admitTutorRequest);

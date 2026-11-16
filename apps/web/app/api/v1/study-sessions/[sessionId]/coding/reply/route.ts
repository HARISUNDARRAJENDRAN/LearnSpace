import { codingReplyRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { replyToCoach } from "../../../../../../../lib/coding/service";
import { admitTutorRequest } from "../../../../../../../lib/tutor/limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The learner's answer to the live tutor's question; its reply lands on the next poll. */
export const POST = codingRoute(codingReplyRequestSchema, ({ userId, sessionId, body, options }) => replyToCoach(userId, sessionId, body, options), admitTutorRequest);

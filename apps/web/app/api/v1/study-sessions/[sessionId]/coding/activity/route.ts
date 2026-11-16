import { codingActivityRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { recordCodingActivity } from "../../../../../../../lib/coding/service";
import { admitTutorInteraction } from "../../../../../../../lib/tutor/limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A check-in the report calls for is written after the response, within this limit.
export const maxDuration = 120;

/** Focused working time, edits, pastes and time away, reported by the editor every few seconds. */
export const POST = codingRoute(codingActivityRequestSchema, ({ userId, sessionId, body, options }) => recordCodingActivity(userId, sessionId, body, options), admitTutorInteraction);

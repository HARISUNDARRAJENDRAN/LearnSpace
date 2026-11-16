import { codingRunRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { runCoding } from "../../../../../../../lib/coding/service";
import { admitCodeRun } from "../../../../../../../lib/coding/limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Runs the code on the examples and the learner's own inputs (never the hidden tests). */
export const POST = codingRoute(codingRunRequestSchema, ({ userId, sessionId, body, options }) => runCoding(userId, sessionId, body, options), admitCodeRun);

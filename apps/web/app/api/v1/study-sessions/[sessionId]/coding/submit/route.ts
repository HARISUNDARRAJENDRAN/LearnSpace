import { codingSubmitRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { submitCoding } from "../../../../../../../lib/coding/service";
import { admitCodeRun } from "../../../../../../../lib/coding/limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Grades the code on every hidden test; the grade alone moves the problem on. */
export const POST = codingRoute(codingSubmitRequestSchema, ({ userId, sessionId, body, options }) => submitCoding(userId, sessionId, body, options), admitCodeRun);

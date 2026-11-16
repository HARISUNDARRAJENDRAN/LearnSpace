import { codingRoute } from "../../../../../../../lib/coding/route";
import { getCodingEligibility } from "../../../../../../../lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current resource's coding capability, used to render nested session tools. */
export const GET = codingRoute(null, ({ userId, sessionId, options }) => getCodingEligibility(userId, sessionId, options));

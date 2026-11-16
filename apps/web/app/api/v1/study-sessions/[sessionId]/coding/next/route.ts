import { codingRoute } from "../../../../../../../lib/coding/route";
import { nextCoding } from "../../../../../../../lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Opens what follows a finished problem (decided by its outcome), or starts preparing it. */
export const POST = codingRoute(null, ({ userId, sessionId, options }) => nextCoding(userId, sessionId, options));

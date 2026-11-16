import { codingRoute } from "../../../../../../lib/coding/route";
import { getPaperGuide, startPaperGuide } from "../../../../../../lib/research/practice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Returns the cached project guide for the active paper version, starting generation if needed. */
export const GET = codingRoute(null, ({ userId, sessionId, options }) => getPaperGuide(userId, sessionId, options.keepAlive));

/** Starts guide generation once per immutable paper version. */
export const POST = codingRoute(null, ({ userId, sessionId, options }) => startPaperGuide(userId, sessionId, options.keepAlive));

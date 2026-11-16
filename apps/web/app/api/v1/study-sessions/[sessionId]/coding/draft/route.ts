import { codingDraftRequestSchema } from "@learnspace/shared/coding";
import { codingRoute } from "../../../../../../../lib/coding/route";
import { saveDraft } from "../../../../../../../lib/coding/service";
import { admitTutorInteraction } from "../../../../../../../lib/tutor/limits";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Keeps the code as typed, per language, so the problem resumes exactly where it was left. */
export const PUT = codingRoute(codingDraftRequestSchema, ({ userId, sessionId, body }) => saveDraft(userId, sessionId, body), admitTutorInteraction);

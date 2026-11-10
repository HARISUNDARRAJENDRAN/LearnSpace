import { studyProgressRequestSchema } from "@learnspace/shared";
import { after, NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { startMastery } from "../../../../../../lib/mastery/service";
import { updateStudyProgress } from "../../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Finishing a video writes its mastery check after the response, which takes as long as the mastery route.
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    const input = studyProgressRequestSchema.parse(await readJson(request));
    const progress = await updateStudyProgress(session.user.id, sessionId, input);
    // Written while the learner is still on the last frame, so the check is usually ready when they open it. A
    // paper, a passed lesson or a spent budget simply has nothing to write; the learner can still start it by hand.
    if (input.event === "complete") after(() => startMastery(session.user.id, sessionId).then(() => undefined, () => undefined));
    return NextResponse.json(progress);
  } catch (error) {
    return authErrorResponse(error);
  }
}

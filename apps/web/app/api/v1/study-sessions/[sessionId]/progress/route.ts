import { studyProgressRequestSchema } from "@learnspace/shared";
import { after, NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../../lib/auth/errors";
import { readJson } from "../../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../../lib/discovery/access";
import { startMastery } from "../../../../../../lib/mastery/service";
import { updateStudyProgress } from "../../../../../../lib/study/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Playing or finishing a video writes its mastery check after the response, which takes as long as the mastery route.
export const maxDuration = 150;

type Context = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const { sessionId } = await context.params;
    const input = studyProgressRequestSchema.parse(await readJson(request));
    const progress = await updateStudyProgress(session.user.id, sessionId, input);
    // The first set is written while the video plays (from the first play, or the first checkpoint after the transcript
    // lands), locked until the video ends, so it is ready when the learner opens it; finishing writes it if it isn't yet.
    // A paper, a passed lesson, a set already there or a spent budget simply has nothing to write.
    if (input.event === "complete" || input.event === "play" || input.event === "checkpoint") {
      after(async () => {
        const rest: Promise<void>[] = [];
        await startMastery(session.user.id, sessionId, { ahead: input.event !== "complete", keepAlive: (work) => rest.push(work) }).catch(() => undefined);
        await Promise.all(rest);
      });
    }
    return NextResponse.json(progress);
  } catch (error) {
    return authErrorResponse(error);
  }
}

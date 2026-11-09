import { NextResponse } from "next/server";
import { transcriptSubmissionSchema } from "@learnspace/shared/transcripts";
import { z } from "zod";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { readJson } from "../../../../../lib/auth/request";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { submitTranscript, transcriptStatus } from "../../../../../lib/transcripts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ resourceId: string }> };
const resourceIdSchema = z.string().uuid();

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const resourceId = resourceIdSchema.parse((await context.params).resourceId);
    return NextResponse.json(await transcriptStatus(session.user.id, resourceId));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireCompletedSession();
    const resourceId = resourceIdSchema.parse((await context.params).resourceId);
    const input = transcriptSubmissionSchema.parse(await readJson(request));
    return NextResponse.json(await submitTranscript(session.user.id, resourceId, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}

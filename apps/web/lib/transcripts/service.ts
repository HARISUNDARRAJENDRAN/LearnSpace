import { createHash } from "node:crypto";
import { withUserTransaction } from "@learnspace/db";
import { resourceVersions, resources, transcriptRequests, transcriptSubmissions, videoDetails } from "@learnspace/db/schema";
import { normalizeSegments, type TranscriptStatus, type TranscriptSubmission } from "@learnspace/shared/transcripts";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";

// Captions may run a little past the reported length (outros, rounding), never minutes past it.
const DURATION_SLACK_MS = 5 * 60_000;

/** Queues the video for the home signer if needed and tells the learner's browser what to do next. */
export async function transcriptStatus(userId: string, resourceId: string): Promise<TranscriptStatus> {
  return withUserTransaction(userId, async (tx) => {
    // RLS limits this to videos the learner can see.
    const [video] = await tx
      .select({ youtubeId: videoDetails.youtubeId, versionStatus: resourceVersions.processingStatus })
      .from(resources)
      .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
      .leftJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
      .where(and(eq(resources.id, resourceId), isNull(resources.deletedAt)))
      .limit(1);
    if (!video) throw new AuthError("RESOURCE_NOT_FOUND", "That video is not available.", 404);
    if (video.versionStatus === "ready") return { status: "ready" };
    await tx.insert(transcriptRequests).values({ resourceId, youtubeId: video.youtubeId }).onConflictDoNothing();
    // A signature about to expire is useless to a browser, so the signer gets the video again.
    await tx.update(transcriptRequests)
      .set({ status: "queued", captionUrl: null, attempts: 0, requestedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(transcriptRequests.resourceId, resourceId), eq(transcriptRequests.status, "signed"), lt(transcriptRequests.expiresAt, sql`now() + interval '10 minutes'`)));
    const [request] = await tx.select().from(transcriptRequests).where(eq(transcriptRequests.resourceId, resourceId)).limit(1);
    if (!request) throw new Error("Transcript request was not recorded");
    if (request.status === "ready") return { status: "ready" };
    if (request.status === "unavailable" || request.status === "failed") return { status: "unavailable" };
    const [own] = await tx.select({ resourceId: transcriptSubmissions.resourceId }).from(transcriptSubmissions)
      .where(and(eq(transcriptSubmissions.resourceId, resourceId), eq(transcriptSubmissions.userId, userId))).limit(1);
    if (own) return { status: "submitted" };
    if (request.status === "signed" && request.captionUrl && request.language) return { status: "signed", captionUrl: request.captionUrl, language: request.language };
    return { status: "queued" };
  });
}

/** Keeps the learner's own download; the worker shares it once another learner's download matches it exactly. */
export async function submitTranscript(userId: string, resourceId: string, input: TranscriptSubmission): Promise<TranscriptStatus> {
  const segments = normalizeSegments(input.segments);
  if (segments.length === 0) throw new AuthError("EMPTY_TRANSCRIPT", "That transcript has no text.", 422);
  return withUserTransaction(userId, async (tx) => {
    const [request] = await tx
      .select({ status: transcriptRequests.status, language: transcriptRequests.language, durationMs: videoDetails.durationMs })
      .from(transcriptRequests)
      .innerJoin(resources, eq(resources.id, transcriptRequests.resourceId))
      .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
      .where(eq(transcriptRequests.resourceId, resourceId))
      .limit(1);
    // Only captions for a URL the signer handed out are accepted, in the language it chose.
    if (!request || request.status !== "signed") throw new AuthError("TRANSCRIPT_NOT_REQUESTED", "This video is not waiting for captions.", 409);
    if (input.language !== request.language) throw new AuthError("TRANSCRIPT_LANGUAGE_MISMATCH", "Those captions are in a different language.", 422);
    if (request.durationMs && segments.some(([startMs]) => startMs > request.durationMs! + DURATION_SLACK_MS)) {
      throw new AuthError("TRANSCRIPT_OUT_OF_RANGE", "Those captions run past the end of the video.", 422);
    }
    const contentSha256 = createHash("sha256").update(JSON.stringify(segments)).digest("hex");
    await tx.insert(transcriptSubmissions)
      .values({ resourceId, userId, language: input.language, contentSha256, segments })
      .onConflictDoUpdate({ target: [transcriptSubmissions.resourceId, transcriptSubmissions.userId], set: { language: input.language, contentSha256, segments, createdAt: sql`now()` } });
    return { status: "submitted" };
  });
}

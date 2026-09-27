import { withUserTransaction } from "@learnspace/db";
import { resources, videoDetails } from "@learnspace/db/schema";
import { and, desc, eq, gte, isNotNull, isNull, or } from "drizzle-orm";

export type PopularResource = {
  resourceId: string;
  title: string;
  youtubeId: string;
  channelTitle: string | null;
  durationMs: number | null;
  publishedAt: Date | null;
  viewCount: number;
  metricsCapturedAt: Date;
};

export function getPopularResourcesThisWeek(userId: string, limit = 4): Promise<PopularResource[]> {
  const capturedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));

  return withUserTransaction(userId, async (tx) => {
    const rows = await tx
      .select({
        resourceId: resources.id,
        title: resources.title,
        youtubeId: videoDetails.youtubeId,
        channelTitle: videoDetails.channelTitle,
        durationMs: videoDetails.durationMs,
        publishedAt: videoDetails.publishedAt,
        viewCount: videoDetails.latestViewCount,
        metricsCapturedAt: videoDetails.metricsCapturedAt,
      })
      .from(resources)
      .innerJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
      .where(and(
        isNull(resources.ownerUserId),
        or(eq(resources.visibility, "public"), eq(resources.visibility, "unlisted")),
        eq(resources.type, "video"),
        eq(resources.status, "ready"),
        isNull(resources.deletedAt),
        gte(videoDetails.metricsCapturedAt, capturedSince),
        isNotNull(videoDetails.latestViewCount),
      ))
      .orderBy(desc(videoDetails.latestViewCount), desc(videoDetails.metricsCapturedAt))
      .limit(safeLimit);

    return rows.flatMap((row) => (
      row.viewCount === null || row.metricsCapturedAt === null
        ? []
        : [{ ...row, viewCount: row.viewCount, metricsCapturedAt: row.metricsCapturedAt }]
    ));
  });
}

import { NextResponse } from "next/server";
import { withUserTransaction } from "@learnspace/db";
import { recommendationRuns, recommendationCandidates, resources } from "@learnspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { authErrorResponse } from "../../../../../lib/auth/errors";

export async function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  try {
    const session = await requireCompletedSession();
    return NextResponse.json(await withUserTransaction(session.user.id, async (tx) => {
      const [run] = await tx.select().from(recommendationRuns).where(and(eq(recommendationRuns.userId, session.user.id), eq(recommendationRuns.surface, "discover"))).orderBy(desc(recommendationRuns.createdAt)).limit(1);
      if (!run) return { runId: null, candidates: [] };
      const candidates = await tx.select({ resourceId: resources.id, title: resources.title, score: recommendationCandidates.score, position: recommendationCandidates.finalRank, reasons: recommendationCandidates.reasonCodes }).from(recommendationCandidates).innerJoin(resources, eq(resources.id, recommendationCandidates.resourceId)).where(eq(recommendationCandidates.recommendationRunId, run.id));
      const features = run.contextSnapshot.featureSnapshots as Record<string, unknown> | undefined;
      return { runId: run.id, strategyVersion: run.strategyVersion, featureVersion: run.featureVersion, candidates: candidates.map((candidate) => ({ ...candidate, components: features?.[candidate.resourceId] ?? {} })) };
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

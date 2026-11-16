import { randomUUID } from "node:crypto";
import { type Transaction, withUserTransaction } from "@learnspace/db";
import { agentRuns, modelInvocations } from "@learnspace/db/schema";
import { CODING_CONTRACT_VERSION } from "@learnspace/shared/coding";
import { eq } from "drizzle-orm";
import { estimateCostUsd, TUTOR_MODEL, type TutorDepth, type TutorModel, TutorModelError, type TutorModelResult, type TutorUsage } from "../ai/tutor-model";
import { recordGlobalSpend } from "../tutor/limits";

export const CODING_PURPOSE = "coding_practice";

/** What a run did, for the learner's waiting state: writing the problem they asked for, or one written ahead. */
export const RUN_GOALS = { author: "Write a coding problem", prefetch: "Write a coding problem ahead", hint: "Give a coding hint", coach: "Check in on a coding attempt" } as const;

export async function openCodingRun(tx: Transaction, userId: string, sessionId: string, goal: string, depth: TutorDepth): Promise<string> {
  const [run] = await tx.insert(agentRuns).values({
    userId, studySessionId: sessionId, purpose: CODING_PURPOSE, status: "executing", goal, policyVersion: CODING_CONTRACT_VERSION,
    maxIterations: 1, maxToolCalls: 0, maxTokens: TUTOR_MODEL.depths[depth].maxOutputTokens, correlationId: randomUUID(), startedAt: new Date(),
  }).returning({ id: agentRuns.id });
  return run!.id;
}

/** Records a model call against the learner's and everyone's budgets, and closes its run. */
export async function closeCodingRun(tx: Transaction, runId: string, depth: TutorDepth, usage: TutorUsage | null, latencyMs: number | null, failure: string | null): Promise<void> {
  const costUsd = usage ? estimateCostUsd(usage) : 0;
  if (usage) {
    await tx.insert(modelInvocations).values({
      agentRunId: runId, provider: TUTOR_MODEL.provider, modelName: TUTOR_MODEL.id, purpose: `${CODING_PURPOSE}:${TUTOR_MODEL.depths[depth].effort}`, promptTemplateId: `coding-${depth}`, promptTemplateVer: CODING_CONTRACT_VERSION,
      inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, latencyMs,
      estimatedCostUsd: costUsd.toFixed(8), cacheStatus: "miss", safetyStatus: failure ?? "ok", completedAt: new Date(),
    });
  }
  await recordGlobalSpend(tx, costUsd);
  await tx.update(agentRuns).set({ status: failure ? "failed" : "done", completedAt: new Date(), failureCode: failure?.slice(0, 120) ?? null }).where(eq(agentRuns.id, runId));
}

/** One model call inside an open run; the run is closed either way, and a failure comes back as its code. */
export async function runModel(userId: string, runId: string, model: TutorModel, request: Parameters<TutorModel>[0], validate: (result: TutorModelResult) => string | null = () => null): Promise<{ result: TutorModelResult | null; failure: string | null }> {
  let result: TutorModelResult | null = null;
  let failure: string | null = null;
  let usage: TutorUsage | null = null;
  try {
    result = await model(request, { signal: new AbortController().signal });
    usage = result.usage;
    failure = result.refusal ? "refused" : validate(result);
  } catch (error) {
    failure = error instanceof TutorModelError ? error.code : "internal_error";
    usage = error instanceof TutorModelError ? error.usage : null;
  }
  await withUserTransaction(userId, (tx) => closeCodingRun(tx, runId, request.depth, usage, result?.latencyMs ?? null, failure)).catch(() => undefined);
  return { result: failure ? null : result, failure };
}

import { createHash } from "node:crypto";
import type { Transaction } from "@learnspace/db";
import { answerCache } from "@learnspace/db/schema";
import { TUTOR_CONTRACT_VERSION, type TutorModelOutput, type TutorSource } from "@learnspace/shared/tutor";
import { sql } from "drizzle-orm";
import { TUTOR_MODEL } from "../ai/tutor-model";
import type { GroundedAnswer } from "./grounding";

// Paraphrases of one question score ~0.9 with this embedding model; different questions about one topic score lower still.
// Only near-identical wording is treated as the same question.
export const SEMANTIC_MATCH = 0.95;
// The model is part of the contract, so a model change never serves an older model's answers.
const CONTRACT = `${TUTOR_CONTRACT_VERSION}:${TUTOR_MODEL.id}`;

export type CachedAnswer = GroundedAnswer & { learner: TutorModelOutput["learner"]; match: "exact" | "semantic" };

export function normalizeQuestion(question: string): string {
  return question.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}:]+/gu, " ").trim();
}

/**
 * Only a learner's first question in a thread, on a public video, is shared: later turns depend on their own
 * conversation and learner record. Short questions only, so an instruction smuggled into a long one is not shared.
 */
export function cacheEligible(input: { firstTurn: boolean; replying: boolean; publicSource: boolean; question: string; scopeKind: string }): boolean {
  return input.firstTurn && !input.replying && input.publicSource && input.question.length <= 200 && input.scopeKind !== "out_of_range";
}

export async function findCachedAnswer(tx: Transaction, versionId: string, scopeKey: string, question: string, vector: number[] | null): Promise<CachedAnswer | null> {
  const sha = createHash("sha256").update(normalizeQuestion(question)).digest("hex");
  const similarity = vector ? sql`1 - (question_embedding <=> ${JSON.stringify(vector)}::vector)` : sql`NULL::float8`;
  const [row] = await tx.execute<{ answer: CachedAnswer; chunk_ids: string[]; exact: boolean; similarity: number | null }>(sql`
    SELECT answer, chunk_ids, question_sha256 = ${sha} AS exact, ${similarity} AS similarity
    FROM retrieval.answer_cache
    WHERE resource_version_id = ${versionId} AND contract_version = ${CONTRACT} AND scope_key = ${scopeKey}
      AND (question_sha256 = ${sha} ${vector ? sql`OR question_embedding IS NOT NULL` : sql``})
    ORDER BY (question_sha256 = ${sha}) DESC ${vector ? sql`, question_embedding <=> ${JSON.stringify(vector)}::vector` : sql``}
    LIMIT 1`);
  if (!row) return null;
  if (!row.exact && Number(row.similarity ?? 0) < SEMANTIC_MATCH) return null;
  // The entry must still point only at chunks of this version.
  const [check] = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}
      AND id = ANY(ARRAY[${sql.join(row.chunk_ids.map((id) => sql`${id}`), sql`, `)}]::uuid[])`);
  if ((check?.count ?? 0) !== new Set(row.chunk_ids).size) return null;
  return { ...row.answer, match: row.exact ? "exact" : "semantic" };
}

export async function storeCachedAnswer(tx: Transaction, versionId: string, scopeKey: string, question: string, vector: number[] | null, answer: GroundedAnswer, learner: TutorModelOutput["learner"]): Promise<void> {
  if (answer.outcome !== "answer") return;
  const chunkIds = [...new Set(answer.sources.map((source: TutorSource) => source.chunkId))];
  await tx.insert(answerCache).values({
    resourceVersionId: versionId,
    contractVersion: CONTRACT,
    scopeKey,
    questionSha256: createHash("sha256").update(normalizeQuestion(question)).digest("hex"),
    questionEmbedding: vector,
    // The learner's goal and open questions are theirs; a cached answer carries only the concepts it taught.
    answer: { outcome: answer.outcome, blocks: answer.blocks, sources: answer.sources, followUps: answer.followUps ?? [], learner: { goal: null, concepts: learner.concepts, openQuestions: [], nextStep: learner.nextStep } },
    chunkIds,
  }).onConflictDoNothing();
}

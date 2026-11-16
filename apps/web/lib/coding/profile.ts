import { type Transaction, withUserTransaction } from "@learnspace/db";
import { resourceChunks, videoCodingProfiles } from "@learnspace/db/schema";
import {
  CODING_CONCEPTS, CODING_CONTRACT_VERSION, type CodingClassificationOutput, codingClassificationOutputSchema, type CodingConcept, type CodingProfileView, type Difficulty, type VideoCategory,
} from "@learnspace/shared/coding";
import { strictJsonSchema } from "@learnspace/shared/tutor";
import { asc, eq, sql } from "drizzle-orm";
import { openAiConfigured, structuredCompletion } from "../ai/openai";
import { formatClock } from "../tutor/scope";
import { CLASSIFY_INSTRUCTIONS, fence } from "./prompt";

/** A classification still marked running after this long died with its server and is tried again. */
const CLASSIFY_WINDOW_MS = 120_000;
/** Failures are retried, but not on every page load. */
const RETRY_FAILED_MS = 15 * 60_000;
const MAX_PASSAGES = 60;
const PASSAGE_CHARS = 700;
const RECOMMEND_FIT = 0.6;
const CODING_CATEGORIES: VideoCategory[] = ["dsa_lesson", "programming_tutorial"];

export type StoredConcept = { concept: CodingConcept; focus: string; startMs: number | null };
export type ProfileRow = typeof videoCodingProfiles.$inferSelect;
export type Classifier = (input: { system: string; user: string }) => Promise<CodingClassificationOutput>;

const SCHEMA = strictJsonSchema(codingClassificationOutputSchema);

export const openAiClassifier: Classifier = (input) => structuredCompletion({
  name: "coding_profile", system: input.system, user: input.user, jsonSchema: SCHEMA, parser: codingClassificationOutputSchema, reasoningEffort: "low", timeoutMs: 60_000,
});

/** Whether a lesson should offer coding practice: the classifier's call, held to a bar the LLM doesn't set. */
export function recommends(output: Pick<CodingClassificationOutput, "category" | "practiceFit" | "concepts">): boolean {
  return CODING_CATEGORIES.includes(output.category) && output.practiceFit >= RECOMMEND_FIT && output.concepts.length > 0;
}

export function profileView(row: ProfileRow | null, transcript: "ready" | "preparing" | "unavailable" | "failed"): CodingProfileView {
  const empty = { recommended: false, category: null, concepts: [] };
  if (transcript === "unavailable" || transcript === "failed") return { status: "unavailable", ...empty };
  if (!row) return { status: transcript === "ready" ? "classifying" : "waiting_transcript", ...empty };
  if (row.status !== "ready") return { status: row.status === "failed" ? "failed" : "classifying", ...empty };
  return {
    status: "ready",
    recommended: row.recommended,
    category: row.category as VideoCategory | null,
    concepts: (row.concepts as StoredConcept[]).map((item) => ({ concept: item.concept, label: CODING_CONCEPTS[item.concept], focus: item.focus, startMs: item.startMs })),
  };
}

export async function loadProfile(tx: Transaction, versionId: string): Promise<ProfileRow | null> {
  const [row] = await tx.select().from(videoCodingProfiles).where(eq(videoCodingProfiles.resourceVersionId, versionId)).limit(1);
  return row ?? null;
}

/**
 * Claims the classification of a transcript version: true when this caller should classify it (nobody has, a run died, or
 * a failure is old enough to retry). One claim per version, whichever learner opens it first.
 */
async function claim(tx: Transaction, versionId: string, resourceId: string): Promise<boolean> {
  const rows = await tx.insert(videoCodingProfiles).values({ resourceVersionId: versionId, resourceId, status: "classifying", contractVersion: CODING_CONTRACT_VERSION })
    .onConflictDoUpdate({
      target: videoCodingProfiles.resourceVersionId,
      set: { status: "classifying", startedAt: sql`now()`, updatedAt: sql`now()` },
      where: sql`(${videoCodingProfiles.status} = 'classifying' AND ${videoCodingProfiles.startedAt} < now() - make_interval(secs => ${CLASSIFY_WINDOW_MS / 1000}))
        OR (${videoCodingProfiles.status} = 'failed' AND ${videoCodingProfiles.updatedAt} < now() - make_interval(secs => ${RETRY_FAILED_MS / 1000}))
        OR ${videoCodingProfiles.contractVersion} <> ${CODING_CONTRACT_VERSION}`,
    })
    .returning({ id: videoCodingProfiles.resourceVersionId });
  return rows.length > 0;
}

/** Evenly spread passages of the transcript, numbered so concepts can cite where they are taught. */
function sample(chunks: Array<{ content: string; startMs: number | null }>) {
  const step = Math.max(1, chunks.length / MAX_PASSAGES);
  const picked: Array<{ content: string; startMs: number | null }> = [];
  for (let index = 0; index < chunks.length && picked.length < MAX_PASSAGES; index = Math.floor(picked.length * step)) picked.push(chunks[index]!);
  return picked;
}

export async function classifyVersion(userId: string, video: { resourceId: string; versionId: string; title: string }, classifier: Classifier = openAiClassifier): Promise<ProfileRow | null> {
  const claimed = await withUserTransaction(userId, (tx) => claim(tx, video.versionId, video.resourceId));
  if (!claimed) return null;
  const finish = (values: Partial<typeof videoCodingProfiles.$inferInsert>) => withUserTransaction(userId, async (tx) => {
    const [row] = await tx.update(videoCodingProfiles).set({ ...values, updatedAt: new Date() }).where(eq(videoCodingProfiles.resourceVersionId, video.versionId)).returning();
    return row ?? null;
  });
  try {
    if (classifier === openAiClassifier && !openAiConfigured()) throw new Error("OPENAI_API_KEY is not configured");
    const chunks = await withUserTransaction(userId, (tx) => tx.select({ content: resourceChunks.content, startMs: resourceChunks.startMs }).from(resourceChunks)
      .where(eq(resourceChunks.resourceVersionId, video.versionId)).orderBy(asc(resourceChunks.ordinal)));
    const passages = sample(chunks);
    const user = `<video_title>${fence(video.title)}</video_title>\n\n<transcript>\n${passages.map((chunk, index) => `[${index + 1}]${chunk.startMs === null ? "" : ` ${formatClock(chunk.startMs)}`}\n${fence(chunk.content.slice(0, PASSAGE_CHARS))}`).join("\n\n")}\n</transcript>`;
    const output = await classifier({ system: CLASSIFY_INSTRUCTIONS, user });
    const seen = new Set<CodingConcept>();
    const concepts: StoredConcept[] = output.concepts.flatMap((item) => {
      if (seen.has(item.concept)) return [];
      seen.add(item.concept);
      const cited = item.cite.map((number) => passages[number - 1]).find((passage) => passage && passage.startMs !== null);
      return [{ concept: item.concept, focus: item.focus.trim(), startMs: cited?.startMs ?? null }];
    });
    return await finish({
      status: "ready", category: output.category, practiceFit: output.practiceFit, recommended: recommends({ ...output, concepts: output.concepts }),
      language: output.language, difficulty: output.difficulty as Difficulty, concepts, reason: output.reason.slice(0, 300), contractVersion: CODING_CONTRACT_VERSION,
    });
  } catch (error) {
    console.error("[coding] classification failed", error instanceof Error ? error.message : error);
    return finish({ status: "failed", reason: null });
  }
}

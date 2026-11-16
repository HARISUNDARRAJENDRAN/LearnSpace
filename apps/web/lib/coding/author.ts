import { type Transaction, withUserTransaction } from "@learnspace/db";
import { codingAttempts, codingProblems, codingProblemSecrets, resourceChunks, resources, videoCodingProfiles } from "@learnspace/db/schema";
import { paperCitationAnchorSchema, type PaperCitationAnchor } from "@learnspace/shared/contracts";
import {
  CODING_CONCEPTS, CODING_CONTRACT_VERSION, type CodingConcept, type CodingProblemOutput, codingProblemOutputSchema, type Difficulty, type Signature,
} from "@learnspace/shared/coding";
import { argsError, parseTyped } from "@learnspace/shared/coding-code";
import { strictJsonSchema } from "@learnspace/shared/tutor";
import { and, asc, eq, inArray, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { openAiTutorModel, TUTOR_MODEL, type TutorModel } from "../ai/tutor-model";
import { admitTutorGeneration } from "../tutor/limits";
import { formatClock } from "../tutor/scope";
import { AUTHOR_INSTRUCTIONS, fence } from "./prompt";
import { verifyProblem as runnerVerify } from "./runner";
import { openCodingRun, RUN_GOALS, runModel } from "./runs";

/** Where a problem sits in the bank: the lesson it practises, its concept and level, and the problem it varies, if any. */
export type Slot = { resourceId: string; concept: CodingConcept; difficulty: Difficulty; parentProblemId: string | null; paper?: { versionId: string; component: string; focus: string; anchor: PaperCitationAnchor } };

/** What the browser and the tutor may know about a problem: everything except its tests and reference code. */
export type ProblemSpec = {
  statement: string;
  signature: Signature;
  compare: "exact" | "unordered";
  numericTolerance?: { absolute: number; relative: number };
  constraints: string[];
  examples: Array<{ args: unknown[]; expected: unknown; explanation: string }>;
  moments: Array<{ startMs: number; label: string }>;
  related: string[];
  efficiencyMatters: boolean;
  paper?: { component: string; anchors: PaperCitationAnchor[] };
};
export type ProblemTutor = {
  hints: Array<{ level: number; stage: "correct" | "efficient"; text: string }>;
  misconceptions: string[];
  baseline: { approach: string; time: string; space: string };
  optimal: { approach: string; time: string; space: string };
};

const GENERATING_WINDOW_MS = 8 * 60_000;
const MAX_TRIES = 2;
const PASSAGES = 80;
const PASSAGE_CHARS = 600;
const SCHEMA = strictJsonSchema(codingProblemOutputSchema);

const sameParent = (parent: string | null) => (parent ? eq(codingProblems.parentProblemId, parent) : isNull(codingProblems.parentProblemId));

/** Problems this learner has already been given, which they never get again. */
const triedBy = (tx: Transaction, userId: string) => tx.select({ id: codingAttempts.problemId }).from(codingAttempts).where(eq(codingAttempts.userId, userId));

/**
 * A verified problem for the slot the learner hasn't had. The lesson's own problems come first; then, for the lesson's
 * first problem on a concept, the shared bank's (another lesson's) at the same level; for a variant, any other problem
 * on the concept at that level, which is a changed problem of the same kind.
 */
export async function findProblem(tx: Transaction, userId: string, slot: Slot): Promise<string | null> {
  const base = [eq(codingProblems.status, "verified"), eq(codingProblems.concept, slot.concept), eq(codingProblems.difficulty, slot.difficulty), notInArray(codingProblems.id, triedBy(tx, userId))];
  const pick = async (...where: ReturnType<typeof eq>[]) => (await tx.select({ id: codingProblems.id }).from(codingProblems).where(and(...base, ...where)).orderBy(asc(codingProblems.verifiedAt)).limit(1))[0]?.id ?? null;
  return (await pick(eq(codingProblems.resourceId, slot.resourceId), sameParent(slot.parentProblemId)))
    ?? (slot.parentProblemId ? await pick(eq(codingProblems.parentProblemId, slot.parentProblemId)) : null)
    ?? (await pick(slot.parentProblemId ? ne(codingProblems.id, slot.parentProblemId) : isNull(codingProblems.parentProblemId)));
}

/** A problem being written or verified for the slot right now. */
export async function slotPending(tx: Transaction, slot: Slot): Promise<boolean> {
  const [row] = await tx.select({ id: codingProblems.id }).from(codingProblems).where(and(
    eq(codingProblems.resourceId, slot.resourceId), eq(codingProblems.concept, slot.concept), eq(codingProblems.difficulty, slot.difficulty), sameParent(slot.parentProblemId),
    inArray(codingProblems.status, ["generating", "verifying"]), sql`${codingProblems.createdAt} > now() - make_interval(secs => ${GENERATING_WINDOW_MS / 1000})`,
  )).limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------------------------------------------------
// Checking what the model wrote, before the runner spends any time on it.

class AuthoringError extends Error {}

function parseArgs(signature: Signature, text: string, label: string): unknown[] {
  let args: unknown;
  try {
    args = JSON.parse(text);
  } catch {
    throw new AuthoringError(`${label}: args is not JSON`);
  }
  const error = argsError(signature, args);
  if (error) throw new AuthoringError(`${label}: ${error}`);
  return args as unknown[];
}

function parseExpected(signature: Signature, text: string, label: string): unknown {
  try {
    return parseTyped(signature.returns, text);
  } catch (error) {
    throw new AuthoringError(`${label}: expected ${error instanceof Error ? error.message : "is invalid"}`);
  }
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);

/** How much two statements share, 0 to 1 (Jaccard over words): a variant must read as a different problem. */
export function similarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return a.size + b.size === 0 ? 1 : shared / (a.size + b.size - shared);
}
const MAX_VARIANT_SIMILARITY = 0.6;

export function checkAuthored(output: CodingProblemOutput, slot: Slot, parent: { statement: string; examples: ProblemSpec["examples"] } | null, moments: ProblemSpec["moments"]) {
  const { signature } = output;
  if (slot.paper && signature.returns.includes("double") && !output.numericTolerance) throw new AuthoringError("paper exercises with numeric output must declare bounded absolute and relative tolerance");
  const names = new Set(signature.params.map((param) => param.name));
  if (names.size !== signature.params.length) throw new AuthoringError("parameter names repeat");
  const examples = output.examples.map((example, index) => ({ args: parseArgs(signature, example.args, `example ${index + 1}`), expected: parseExpected(signature, example.expected, `example ${index + 1}`), explanation: example.explanation.trim() }));
  const edgeCases = output.edgeCases.map((edge, index) => ({ args: parseArgs(signature, edge.args, `edge case ${index + 1}`), expected: parseExpected(signature, edge.expected, `edge case ${index + 1}`), why: edge.why.trim() }));
  const stages = output.efficiencyMatters ? ["correct", "efficient"] as const : ["correct"] as const;
  const hints = output.hints.filter((hint) => (stages as readonly string[]).includes(hint.stage)).map((hint) => ({ ...hint, text: hint.text.trim() }));
  for (const stage of stages) if (!hints.some((hint) => hint.stage === stage)) throw new AuthoringError(`no ${stage} hints`);
  if (hints.some((hint) => /```/.test(hint.text))) throw new AuthoringError("a hint contains code");
  for (const reference of [output.baseline, output.optimal, { code: output.generator }, { code: output.validator }]) {
    if (/^\s*(import\s+(os|subprocess|socket|urllib|http|requests)|from\s+(os|subprocess|socket|urllib|http))\b/m.test(reference.code)) throw new AuthoringError("reference code imports a system module");
  }
  if (parent) {
    if (similarity(parent.statement, output.statement) > MAX_VARIANT_SIMILARITY) throw new AuthoringError("the variant reads too much like the original");
    if (JSON.stringify(parent.examples.map((example) => example.args)) === JSON.stringify(examples.map((example) => example.args))) throw new AuthoringError("the variant reuses the original's examples");
  }
  const spec: ProblemSpec = {
    statement: output.statement.trim(), signature, compare: output.compare, ...(output.numericTolerance ? { numericTolerance: output.numericTolerance } : {}), constraints: output.constraints.map((line) => line.trim()), examples,
    moments, related: output.related.map((name) => name.trim()).filter(Boolean), efficiencyMatters: output.efficiencyMatters,
  };
  const tutor: ProblemTutor = {
    hints: hints.sort((a, b) => (a.stage === b.stage ? a.level - b.level : a.stage === "correct" ? -1 : 1)),
    misconceptions: output.misconceptions,
    baseline: { approach: output.baseline.approach, time: output.baseline.time, space: output.baseline.space },
    optimal: { approach: output.optimal.approach, time: output.optimal.time, space: output.optimal.space },
  };
  const authored = { generator: output.generator, validator: output.validator, baseline: output.baseline, optimal: output.optimal, edgeCases };
  return { title: output.title.trim().slice(0, 80), spec, tutor, authored, concept: slot.concept, difficulty: slot.difficulty };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing a problem.

export type AuthorResult = { status: "verified"; problemId: string } | { status: "pending" } | { status: "failed"; reason: string };

/**
 * Writes a problem for the slot and has the runner verify it, trying once more (told what went wrong) if it is rejected.
 * Only one problem is written per slot at a time, whoever asks; a caller who finds one being written gets `pending`.
 */
export async function authorProblem(userId: string, sessionId: string, slot: Slot, options: { model?: TutorModel; prefetch?: boolean } = {}): Promise<AuthorResult> {
  const model = options.model ?? openAiTutorModel;
  let feedback: string | null = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    const prepared = await withUserTransaction(userId, async (tx) => {
      // A problem left generating by a server that died frees its slot.
      await tx.update(codingProblems).set({ status: "rejected", failure: "interrupted" }).where(and(
        eq(codingProblems.resourceId, slot.resourceId), eq(codingProblems.concept, slot.concept), eq(codingProblems.difficulty, slot.difficulty), sameParent(slot.parentProblemId),
        inArray(codingProblems.status, ["generating", "verifying"]), lt(codingProblems.createdAt, new Date(Date.now() - GENERATING_WINDOW_MS)),
      ));
      await admitTutorGeneration(tx, userId);
      const [row] = await tx.insert(codingProblems).values({
        resourceId: slot.resourceId, concept: slot.concept, difficulty: slot.difficulty, parentProblemId: slot.parentProblemId, status: "generating",
        createdBy: userId, model: TUTOR_MODEL.id, contractVersion: CODING_CONTRACT_VERSION,
      }).onConflictDoNothing().returning({ id: codingProblems.id });
      if (!row) return null;
      const runId = await openCodingRun(tx, userId, sessionId, options.prefetch ? RUN_GOALS.prefetch : RUN_GOALS.author, "author");
      return { problemId: row.id, runId, context: await authoringContext(tx, userId, slot) };
    });
    if (!prepared) return { status: "pending" };
    const { problemId, runId, context } = prepared;
    const reject = (failure: string) => withUserTransaction(userId, (tx) => tx.update(codingProblems).set({ status: "rejected", failure: failure.slice(0, 1_000) }).where(eq(codingProblems.id, problemId)));

    let checked: ReturnType<typeof checkAuthored> | null = null;
    const { failure } = await runModel(userId, runId, model, {
      depth: "author", instructions: AUTHOR_INSTRUCTIONS, user: context.user, schema: SCHEMA, cacheKey: `learnspace-${CODING_CONTRACT_VERSION}-author`,
      developer: [
        `Write a ${slot.difficulty} problem on ${CODING_CONCEPTS[slot.concept]} (concept "${slot.concept}"), practising what the lesson does with it: ${context.focus || "as the lesson teaches it"}.`,
        context.parent ? "It is a variant of the original problem below: it practises the same idea with a different scenario, statement, signature and examples, so a learner who memorised the original's answer must still think." : "",
        context.avoid.length ? `Do not repeat these problems the learner has already had: ${context.avoid.map((title) => `"${fence(title)}"`).join(", ")}.` : "",
        feedback ? `An earlier version was discarded because: ${fence(feedback)}. Fix that.` : "",
      ].filter(Boolean).join("\n"),
    }, (result) => {
      try {
        const output = codingProblemOutputSchema.parse(JSON.parse(result.text));
        const moments = output.cite.flatMap((number) => {
          const passage = context.passages[number - 1];
          return passage?.startMs === null || passage === undefined ? [] : [{ startMs: passage.startMs, label: formatClock(passage.startMs) }];
        }).slice(0, 3);
        checked = checkAuthored(output, slot, context.parent, moments);
        if (slot.paper && checked) {
          const paperAnchors = [...new Map(output.cite.flatMap((number) => {
            const anchor = context.passages[number - 1]?.anchor;
            return anchor ? [[anchor.chunkId, anchor] as const] : [];
          })).values()];
          if (!paperAnchors.length) throw new AuthoringError("paper exercise cited no available paper passages");
          checked.spec.paper = { component: slot.paper.component, anchors: paperAnchors };
        }
        return null;
      } catch (error) {
        feedback = error instanceof AuthoringError ? error.message : "the output did not match the format";
        return "invalid_output";
      }
    });
    if (failure || !checked) {
      await reject(feedback ?? failure ?? "invalid_output");
      if (failure && failure !== "invalid_output") return { status: "failed", reason: failure };
      continue;
    }
    const problem = checked as ReturnType<typeof checkAuthored>;
    await withUserTransaction(userId, async (tx) => {
      await tx.update(codingProblems).set({ title: problem.title, spec: problem.spec, tutor: problem.tutor }).where(eq(codingProblems.id, problemId));
      await tx.insert(codingProblemSecrets).values({ problemId, authored: problem.authored });
      await tx.update(codingProblems).set({ status: "verifying" }).where(eq(codingProblems.id, problemId));
    });
    try {
      const verdict = await runnerVerify(problemId);
      if (verdict.status === "verified") return { status: "verified", problemId };
      feedback = verdict.failure;
    } catch (error) {
      await reject("runner_unavailable");
      return { status: "failed", reason: error instanceof Error ? error.message : "runner_unavailable" };
    }
  }
  return { status: "failed", reason: feedback ?? "rejected" };
}

async function authoringContext(tx: Transaction, userId: string, slot: Slot) {
  const [resource] = await tx.select({ title: resources.title, versionId: resources.currentVersionId }).from(resources).where(eq(resources.id, slot.resourceId)).limit(1);
  const versionId = slot.paper?.versionId ?? resource?.versionId;
    const [profile] = !slot.paper && versionId ? await tx.select({ concepts: videoCodingProfiles.concepts }).from(videoCodingProfiles).where(eq(videoCodingProfiles.resourceVersionId, versionId)).limit(1) : [];
  const focus = slot.paper?.focus ?? ((profile?.concepts ?? []) as Array<{ concept: string; focus: string }>).find((item) => item.concept === slot.concept)?.focus ?? "";
  const chunks = versionId ? await tx.select({ id: resourceChunks.id, content: resourceChunks.content, startMs: resourceChunks.startMs, anchor: resourceChunks.anchor }).from(resourceChunks).where(eq(resourceChunks.resourceVersionId, versionId)).orderBy(asc(resourceChunks.ordinal)) : [];
  const step = Math.max(1, chunks.length / PASSAGES);
  const passages: Array<{ content: string; startMs: number | null; anchor?: PaperCitationAnchor }> = [];
  for (let index = 0; index < chunks.length && passages.length < PASSAGES; index = Math.floor(passages.length * step)) {
    const chunk = chunks[index]!;
    const parsedAnchor = slot.paper ? paperCitationAnchorSchema.safeParse({ kind: "paper", page: chunk.anchor.page, sectionId: chunk.anchor.sectionId, chunkId: chunk.id }) : null;
    passages.push({ content: chunk.content, startMs: slot.paper ? null : chunk.startMs, ...(parsedAnchor?.success ? { anchor: parsedAnchor.data } : {}) });
  }
  const [parentRow] = slot.parentProblemId ? await tx.select({ title: codingProblems.title, spec: codingProblems.spec }).from(codingProblems).where(eq(codingProblems.id, slot.parentProblemId)).limit(1) : [];
  const parent = parentRow?.spec ? { statement: (parentRow.spec as ProblemSpec).statement, examples: (parentRow.spec as ProblemSpec).examples, title: parentRow.title ?? "" } : null;
  const avoid = (await tx.select({ title: codingProblems.title }).from(codingAttempts).innerJoin(codingProblems, eq(codingProblems.id, codingAttempts.problemId))
    .where(and(eq(codingAttempts.userId, userId), eq(codingProblems.concept, slot.concept))).limit(20)).flatMap((row) => (row.title ? [row.title] : []));
  const user = [
    slot.paper ? `<paper_title>${fence(resource?.title ?? "")}</paper_title>\n<component>${fence(slot.paper.component)}: ${fence(focus)}</component>` : `<video_title>${fence(resource?.title ?? "")}</video_title>`,
    `${slot.paper ? "<paper_passages>" : "<transcript>"}\n${passages.map((chunk, index) => `[${index + 1}]${chunk.startMs === null ? "" : ` ${formatClock(chunk.startMs)}`}\n${fence(chunk.content.slice(0, PASSAGE_CHARS))}`).join("\n\n")}\n${slot.paper ? "</paper_passages>" : "</transcript>"}`,
    parent ? `<original_problem title="${fence(parent.title)}">\n${fence(parent.statement)}\n</original_problem>` : "",
  ].filter(Boolean).join("\n\n");
  return { user, passages, focus, parent, avoid };
}

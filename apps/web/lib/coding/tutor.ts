import { withUserTransaction } from "@learnspace/db";
import { CODING_CONTRACT_VERSION, codingLanguageLabels, type CodingLanguage } from "@learnspace/shared/coding";
import { openAiTutorModel, type TutorModel } from "../ai/tutor-model";
import { admitTutorGeneration } from "../tutor/limits";
import type { ProblemSpec, ProblemTutor } from "./author";
import type { CoachMoment } from "@learnspace/shared/coding";
import { COACH_INSTRUCTIONS, COACH_MOMENTS, fence, HINT_INSTRUCTIONS, levelRule } from "./prompt";
import { openCodingRun, RUN_GOALS, runModel } from "./runs";

export type TutorContext = {
  title: string;
  spec: ProblemSpec;
  tutor: ProblemTutor;
  phase: "correct" | "efficient";
  language: CodingLanguage;
  code: string;
  /** The latest run or submission, as the learner saw it, plus what a failing hidden test was written to catch. */
  results: string | null;
};

const CODE_LINE = /^\s*(def |class |for |while |if .*:\s*$|return\b|function\b|const |let |var |public |private |#include|import |from \S+ import|[A-Za-z_][\w.[\]]* *(=|\+=|-=)[^=]|}\s*$|.*[;{]\s*$)/;

/** Whether text carries code: a fenced block, or two or more lines that read as code. Hints below level 4 must not. */
export function containsCode(text: string): boolean {
  if (/```/.test(text)) return true;
  return text.split("\n").filter((line) => CODE_LINE.test(line)).length >= 2;
}

export function authoredHint(tutor: ProblemTutor, stage: "correct" | "efficient", level: number): string | null {
  const ladder = tutor.hints.filter((hint) => hint.stage === stage);
  return [...ladder].reverse().find((hint) => hint.level <= level)?.text ?? ladder[0]?.text ?? null;
}

function contextText(context: TutorContext): string {
  const { spec } = context;
  return [
    `<problem title="${fence(context.title)}">\n${fence(spec.statement)}\n\nSignature: ${spec.signature.functionName}(${spec.signature.params.map((param) => `${param.name}: ${param.type}`).join(", ")}) -> ${spec.signature.returns}\nConstraints:\n${spec.constraints.map((line) => `- ${fence(line)}`).join("\n")}\nExamples:\n${spec.examples.map((example) => `- ${fence(JSON.stringify(example.args))} -> ${fence(JSON.stringify(example.expected))}`).join("\n")}\n</problem>`,
    `<approaches>\nStraightforward (${fence(context.tutor.baseline.time)}): ${fence(context.tutor.baseline.approach)}\nEfficient (${fence(context.tutor.optimal.time)}): ${fence(context.tutor.optimal.approach)}\n</approaches>`,
    context.tutor.misconceptions.length ? `<misconceptions>\n${context.tutor.misconceptions.map((item) => `- ${fence(item)}`).join("\n")}\n</misconceptions>` : "",
    `<stage>${context.phase === "correct" ? "Reaching a correct solution." : "The learner's solution is correct but too slow; reaching the efficient one."}</stage>`,
    `<learner_code language="${codingLanguageLabels[context.language]}">\n${fence(context.code.slice(0, 12_000)) || "(empty)"}\n</learner_code>`,
    context.results ? `<latest_results>\n${fence(context.results)}\n</latest_results>` : "<latest_results>Not run yet.</latest_results>",
  ].filter(Boolean).join("\n\n");
}

/**
 * Words the hint at `level` for the learner's own code, from the authored ladder. If the model is unavailable or its hint
 * breaks the rules (code below level 4), the authored hint is given instead: a hint the learner was promised is never lost.
 */
export async function writeHint(userId: string, sessionId: string, context: TutorContext, level: number, model: TutorModel = openAiTutorModel): Promise<string> {
  const fallback = authoredHint(context.tutor, context.phase, level) ?? "Trace your code by hand on the first example: where does what it does differ from what you expect?";
  const runId = await withUserTransaction(userId, async (tx) => {
    await admitTutorGeneration(tx, userId);
    return openCodingRun(tx, userId, sessionId, RUN_GOALS.hint, "quick");
  }).catch(() => null);
  if (!runId) return fallback;
  const { result } = await runModel(userId, runId, model, {
    depth: "quick", instructions: HINT_INSTRUCTIONS, user: contextText(context), cacheKey: `learnspace-${CODING_CONTRACT_VERSION}-hint`,
    developer: `Give the level ${level} hint. The authored hint for this level, to build on: ${fence(fallback)}`,
  }, (output) => (!output.text.trim() ? "empty" : level < 4 && containsCode(output.text) ? "code_in_hint" : null));
  return result?.text.trim().slice(0, 1_500) ?? fallback;
}

export type CoachTurn = { role: "learner" | "tutor"; text: string };

/**
 * The live tutor's next words for `moment`, within the help already unlocked. Null when it has nothing safe to say (the
 * model failed, or wrote code below level 4): a check-in is never forced.
 */
export async function writeCoach(userId: string, sessionId: string, context: TutorContext, level: number, moment: CoachMoment, history: CoachTurn[], model: TutorModel = openAiTutorModel): Promise<string | null> {
  const runId = await withUserTransaction(userId, async (tx) => {
    await admitTutorGeneration(tx, userId);
    return openCodingRun(tx, userId, sessionId, RUN_GOALS.coach, "quick");
  }).catch(() => null);
  if (!runId) return null;
  const conversation = history.slice(-10).map((turn) => `${turn.role === "learner" ? "Learner" : "Tutor"}: ${fence(turn.text)}`).join("\n");
  const { result } = await runModel(userId, runId, model, {
    depth: "quick", instructions: COACH_INSTRUCTIONS, cacheKey: `learnspace-${CODING_CONTRACT_VERSION}-coach`,
    user: `${contextText(context)}\n\n<conversation>\n${conversation || "(nothing said yet)"}\n</conversation>`,
    developer: `${levelRule(level)} What just happened: ${COACH_MOMENTS[moment]}`,
  }, (output) => (!output.text.trim() ? "empty" : level < 4 && containsCode(output.text) ? "code_in_reply" : null));
  return result?.text.trim().slice(0, 1_200) || null;
}

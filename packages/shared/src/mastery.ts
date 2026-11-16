import { z } from "zod";

/** Bumped whenever the question or grading prompts change. */
export const MASTERY_CONTRACT_VERSION = "mastery-v4";
/** A set passes at this share of full credit; below it, the learner reviews and takes a fresh set. */
export const MASTERY_PASS_SCORE = 0.65;

// What the model writes. Passages are cited by their number in the prompt; the server maps them to transcript moments.
// `concept` names the idea a question tests, in two to four words, so results can be read concept by concept.
const cite = z.array(z.number().int().min(1)).min(1).max(3);
const concept = z.string().max(60);
export const masteryQuestionsOutputSchema = z.object({
  questions: z.array(z.union([
    z.object({ type: z.literal("choice"), cite, concept, question: z.string(), options: z.array(z.string()).min(4).max(4), answer: z.number().int().min(0).max(3), explanation: z.string() }).strict(),
    z.object({ type: z.literal("written"), cite, concept, question: z.string(), keyPoints: z.array(z.string()).min(1).max(4), modelAnswer: z.string() }).strict(),
  ])).min(5).max(10),
}).strict();

/**
 * The learning analysis written once a set is scored, from the learner's actual answers. A mistake keeps what the answer
 * shows (`observed`) apart from the misconception that probably caused it (`likelyCause`), which is inferred.
 */
export const masteryAnalysisOutputSchema = z.object({
  summary: z.string().max(400),
  strengths: z.array(z.string().max(240)).max(4),
  mistakes: z.array(z.object({
    questionId: z.string(), observed: z.string().max(400), likelyCause: z.string().max(400), eli5: z.string().max(400), correctReasoning: z.string().max(600),
  }).strict()).max(10),
  improvements: z.array(z.object({ concept: z.string().max(60), gap: z.string().max(300), action: z.string().max(300) }).strict()).max(3),
  practice: z.array(z.object({ concept: z.string().max(60), question: z.string().max(400), answer: z.string().max(600) }).strict()).max(3),
}).strict();
export type MasteryAnalysis = z.infer<typeof masteryAnalysisOutputSchema>;
/** writing: being written; ready: written; failed: the last try did not finish, and it can be asked for again. */
export type MasteryAnalysisView = { status: "writing" } | { status: "failed" } | ({ status: "ready" } & MasteryAnalysis);

/** How a score reads: a pass is at least `passScore`; excellent is near full marks. */
export function masteryBand(score: number, passScore: number): "excellent" | "mastered" | "close" | "review" {
  if (score >= 0.9) return "excellent";
  if (score >= passScore) return "mastered";
  return score >= passScore - 0.2 ? "close" : "review";
}
export type MasteryQuestionsOutput = z.infer<typeof masteryQuestionsOutputSchema>;

export const masteryGradeOutputSchema = z.object({ verdict: z.enum(["correct", "partial", "incorrect"]), feedback: z.string() }).strict();
export type MasteryVerdict = z.infer<typeof masteryGradeOutputSchema>["verdict"];

// What the browser receives: no answer key until the learner has answered that question.
export type MasteryResult = {
  verdict: MasteryVerdict;
  /** 1, 0.5 or 0. */
  credit: number;
  feedback: string;
  response: { choice: number } | { text: string };
  /** The correct option, for multiple choice. */
  answer: number | null;
  /** A full-credit answer, for written questions. */
  modelAnswer: string | null;
};
export type MasteryQuestionView = { id: string; type: "choice" | "written"; concept: string | null; question: string; options: string[] | null; positionMs: number | null; result: MasteryResult | null };
/** `writing`: more questions are still being written into the set; the learner answers the ones already there. */
export type MasteryCheckView = {
  id: string; status: "open" | "passed" | "failed"; score: number | null; writing: boolean; questions: MasteryQuestionView[];
  /** Once scored: the learning analysis (null until it is asked for), and the learner's earlier scored sets on this video, oldest first. */
  analysis: MasteryAnalysisView | null;
  earlierScores: number[];
  /** For each question, the heading of the section of the learner's notes that covers its moment, when there is one. */
  notesSections: Record<string, string>;
};
/**
 * unavailable: no transcript, so no check (finishing the video completes it); locked: not watched yet;
 * ready: watched, no set yet; open/failed/passed: the latest set.
 */
export type MasteryView = { state: "unavailable" | "locked" | "ready" | "writing" | "open" | "failed" | "passed"; passScore: number; check: MasteryCheckView | null };

export const masteryAnswerRequestSchema = z.union([
  z.object({ checkId: z.string().uuid(), questionId: z.string().regex(/^q\d{1,2}$/), choice: z.number().int().min(0).max(3) }).strict(),
  z.object({ checkId: z.string().uuid(), questionId: z.string().regex(/^q\d{1,2}$/), text: z.string().trim().min(1).max(2_000) }).strict(),
]);
export type MasteryAnswerRequest = z.infer<typeof masteryAnswerRequestSchema>;

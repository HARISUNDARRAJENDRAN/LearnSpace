import { z } from "zod";

/** Bumped whenever the question or grading prompts change. */
export const MASTERY_CONTRACT_VERSION = "mastery-v3";
/** A set passes at this share of full credit; below it, the learner reviews and takes a fresh set. */
export const MASTERY_PASS_SCORE = 0.8;

// What the model writes. Passages are cited by their number in the prompt; the server maps them to transcript moments.
const cite = z.array(z.number().int().min(1)).min(1).max(3);
export const masteryQuestionsOutputSchema = z.object({
  questions: z.array(z.union([
    z.object({ type: z.literal("choice"), cite, question: z.string(), options: z.array(z.string()).min(4).max(4), answer: z.number().int().min(0).max(3), explanation: z.string() }).strict(),
    z.object({ type: z.literal("written"), cite, question: z.string(), keyPoints: z.array(z.string()).min(1).max(4), modelAnswer: z.string() }).strict(),
  ])).min(5).max(10),
}).strict();
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
export type MasteryQuestionView = { id: string; type: "choice" | "written"; question: string; options: string[] | null; positionMs: number | null; result: MasteryResult | null };
export type MasteryCheckView = { id: string; status: "open" | "passed" | "failed"; score: number | null; questions: MasteryQuestionView[] };
/**
 * unavailable: no transcript, so no check (finishing the video completes it); locked: not watched yet;
 * ready: watched, no set yet; open/failed/passed: the latest set.
 */
export type MasteryView = { state: "unavailable" | "locked" | "ready" | "open" | "failed" | "passed"; passScore: number; check: MasteryCheckView | null };

export const masteryAnswerRequestSchema = z.union([
  z.object({ checkId: z.string().uuid(), questionId: z.string().regex(/^q\d{1,2}$/), choice: z.number().int().min(0).max(3) }).strict(),
  z.object({ checkId: z.string().uuid(), questionId: z.string().regex(/^q\d{1,2}$/), text: z.string().trim().min(1).max(2_000) }).strict(),
]);
export type MasteryAnswerRequest = z.infer<typeof masteryAnswerRequestSchema>;

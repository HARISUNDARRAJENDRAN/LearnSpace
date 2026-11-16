import { z } from "zod";

/** Bumped whenever the authoring, verification, hint or classification prompts change. */
export const CODING_CONTRACT_VERSION = "coding-v1";

/** The languages a learner can solve in; every problem gets starter code and a test harness in each. */
export const CODING_LANGUAGES = ["python", "javascript", "typescript", "java", "cpp"] as const;
export type CodingLanguage = (typeof CODING_LANGUAGES)[number];
export const codingLanguageLabels: Record<CodingLanguage, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", java: "Java", cpp: "C++" };

/**
 * The value types a problem's function may take and return. Every language maps each one to a native type, so one test suite
 * grades every language; graphs are edge lists and grids are arrays of rows.
 */
export const VALUE_TYPES = [
  "int", "long", "double", "bool", "string",
  "int[]", "long[]", "double[]", "bool[]", "string[]",
  "int[][]", "long[][]", "double[][]", "bool[][]", "string[][]",
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

const identifier = z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/);
export const signatureSchema = z.object({
  functionName: identifier,
  params: z.array(z.object({ name: identifier, type: z.enum(VALUE_TYPES) }).strict()).min(1).max(5),
  returns: z.enum(VALUE_TYPES),
}).strict();
export type Signature = z.infer<typeof signatureSchema>;

/** How a returned value is compared with the expected one: as is, or as a list whose order does not matter. */
export const COMPARE_MODES = ["exact", "unordered"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** The concepts coding mastery is tracked by; a video's concepts and every problem are tagged with these. */
export const CODING_CONCEPTS = {
  "arrays": "Arrays",
  "strings": "Strings",
  "hashing": "Hashing",
  "two-pointers": "Two pointers",
  "sliding-window": "Sliding window",
  "binary-search": "Binary search",
  "sorting": "Sorting",
  "prefix-sums": "Prefix sums",
  "stacks-queues": "Stacks and queues",
  "recursion": "Recursion",
  "backtracking": "Backtracking",
  "greedy": "Greedy",
  "dynamic-programming": "Dynamic programming",
  "graphs": "Graphs",
  "heaps": "Heaps",
  "intervals": "Intervals",
  "matrices": "Matrices",
  "bit-manipulation": "Bit manipulation",
  "math": "Math",
  "implementation": "Implementation",
} as const;
export type CodingConcept = keyof typeof CODING_CONCEPTS;
export const CODING_CONCEPT_SLUGS = Object.keys(CODING_CONCEPTS) as [CodingConcept, ...CodingConcept[]];

// ---------------------------------------------------------------------------------------------------------------------
// What the models write. Test values are JSON text, so the strict output schema need not describe every value type; the
// server parses each one against the problem's signature.

export const VIDEO_CATEGORIES = ["programming_tutorial", "dsa_lesson", "software_engineering", "conceptual_cs", "non_coding"] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const codingClassificationOutputSchema = z.object({
  category: z.enum(VIDEO_CATEGORIES),
  /** How well function-sized coding exercises would practise what this video teaches, 0 to 1. */
  practiceFit: z.number().min(0).max(1),
  language: z.enum([...CODING_LANGUAGES, "other", "none"]),
  difficulty: z.enum(DIFFICULTIES),
  concepts: z.array(z.object({ concept: z.enum(CODING_CONCEPT_SLUGS), focus: z.string().max(160), cite: z.array(z.number().int().min(1)).max(3) }).strict()).max(5),
  reason: z.string().max(300),
}).strict();
export type CodingClassificationOutput = z.infer<typeof codingClassificationOutputSchema>;

const json = z.string().max(400_000);
const pythonSource = z.string().max(20_000);
const approach = z.object({ approach: z.string().max(600), time: z.string().max(40), space: z.string().max(40), code: pythonSource }).strict();

export const codingProblemOutputSchema = z.object({
  title: z.string().max(80),
  concept: z.enum(CODING_CONCEPT_SLUGS),
  difficulty: z.enum(DIFFICULTIES),
  statement: z.string().max(4_000),
  signature: signatureSchema,
  compare: z.enum(COMPARE_MODES),
  constraints: z.array(z.string().max(200)).min(1).max(8),
  examples: z.array(z.object({ args: json, expected: json, explanation: z.string().max(400) }).strict()).min(2).max(3),
  edgeCases: z.array(z.object({ args: json, expected: json, why: z.string().max(200) }).strict()).min(3).max(10),
  generator: pythonSource,
  validator: pythonSource,
  baseline: approach,
  optimal: approach,
  efficiencyMatters: z.boolean(),
  hints: z.array(z.object({ level: z.number().int().min(1).max(4), stage: z.enum(["correct", "efficient"]), text: z.string().max(600) }).strict()).min(4).max(8),
  misconceptions: z.array(z.string().max(240)).max(5),
  cite: z.array(z.number().int().min(1)).max(4),
  related: z.array(z.string().max(120)).max(3),
}).strict();
export type CodingProblemOutput = z.infer<typeof codingProblemOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// The tutoring state machine (lib/coding/policy.ts holds its transitions).

export const TUTOR_STATES = [
  "PROBLEM_INTRO", "INDEPENDENT_ATTEMPT", "PROBABLE_STALL", "HINT_OFFERED", "GUIDED_ATTEMPT", "SOLUTION_SUBMITTED",
  "CORRECTNESS_VERIFIED", "OPTIMIZATION_STAGE", "TRANSFER_PROBLEM", "MASTERY_CONFIRMED",
] as const;
export type TutorState = (typeof TUTOR_STATES)[number];

/** Why an attempt exists: the lesson's next concept, a transfer after assisted work, or reinforcement after a failed transfer. */
export const ATTEMPT_ROLES = ["primary", "transfer", "reinforcement"] as const;
export type AttemptRole = (typeof ATTEMPT_ROLES)[number];

/** What a finished attempt leads to: the next concept, a transfer problem, or review later once the reinforcement cap is hit. */
export const ATTEMPT_OUTCOMES = ["advance", "transfer", "reinforce", "review_later"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const VERDICTS = ["accepted", "accepted_slow", "wrong_answer", "runtime_error", "time_limit", "memory_limit", "output_limit", "compile_error"] as const;
export type Verdict = (typeof VERDICTS)[number];

// ---------------------------------------------------------------------------------------------------------------------
// What the browser sees. Hidden tests, reference solutions, generators and authored hints beyond the learner's level never
// appear here.

export type CodingProfileView = {
  status: "waiting_transcript" | "classifying" | "ready" | "failed" | "unavailable";
  /** The classifier thinks this lesson calls for coding practice: the Code tool shows itself. */
  recommended: boolean;
  category: VideoCategory | null;
  concepts: Array<{ concept: CodingConcept; label: string; focus: string; startMs: number | null }>;
};

export type CodingExampleView = { args: unknown[]; expected: unknown; explanation: string };

export type CodingProblemView = {
  id: string;
  title: string;
  difficulty: Difficulty;
  concept: CodingConcept;
  conceptLabel: string;
  statement: string;
  signature: Signature;
  compare: CompareMode;
  constraints: string[];
  examples: CodingExampleView[];
  starter: Record<CodingLanguage, string>;
  /** Moments in the lesson this problem practises. */
  moments: Array<{ startMs: number; label: string }>;
  /** Whether an efficient solution is a separate stage after a correct one. */
  efficiencyStage: boolean;
  related: string[];
};

export type CaseResultView = {
  index: number;
  args: unknown[];
  output: unknown;
  /** Known for examples and for custom cases the reference solution answered. */
  expected: unknown;
  passed: boolean | null;
  stdout: string;
  error: string | null;
  ms: number | null;
};

export type RunResultView = {
  verdict: "ran" | "compile_error" | "time_limit" | "memory_limit" | "output_limit" | "runtime_error";
  compileOutput: string | null;
  cases: CaseResultView[];
  /** A custom case the problem's constraints reject, by index. */
  invalid: Array<{ index: number; reason: string }>;
};

export type SubmissionView = {
  id: string;
  language: CodingLanguage;
  verdict: Verdict;
  passed: number;
  total: number;
  runtimeMs: number | null;
  memoryKb: number | null;
  /** The first failing test: its input and expected output only when it is one of the shown examples. */
  failure: { example: CodingExampleView | null; output: unknown; error: string | null } | null;
  compileOutput: string | null;
  createdAt: string;
};

export type HintView = { level: number; stage: "correct" | "efficient"; text: string; requested: boolean; createdAt: string };

/** What the live tutor checked in about: the problem opening, a result, a quiet stretch, a lot of unrun code, or a reply. */
export type CoachMoment = "kickoff" | "ran" | "submitted" | "slow" | "solved" | "idle" | "unrun" | "reply";

/** One line of the live tutor's talk with the learner: its check-ins, and the learner's answers to its questions. */
export type CoachMessageView = { role: "learner" | "tutor"; text: string; moment: CoachMoment | null; asks: boolean; createdAt: string };

export type CodingAttemptView = {
  id: string;
  problem: CodingProblemView;
  role: AttemptRole;
  state: TutorState;
  phase: "correct" | "efficient";
  language: CodingLanguage;
  drafts: Partial<Record<CodingLanguage, string>>;
  correctSolved: boolean;
  efficientSolved: boolean;
  hints: HintView[];
  /**
   * The live tutor: what it has said (and the learner answered), whether it is writing a check-in now (poll until it
   * lands), and whether its last words were a question the learner may answer.
   */
  coach: { messages: CoachMessageView[]; thinking: boolean; canReply: boolean };
  /** The next hint, its credit cost and whether it can be taken yet (`wait` says what unlocks it). */
  nextHint: { level: number; capAfter: number; available: boolean; wait: string | null } | null;
  offer: { text: string } | null;
  submissions: SubmissionView[];
  failedSubmissions: number;
  revealed: boolean;
  /** The most credit the attempt can still earn, given the help taken and failed submissions so far. */
  creditCap: number;
  credit: number | null;
  outcome: AttemptOutcome | null;
  /** Once the attempt is over (or the learner revealed it): the reference approach, in Python. */
  solution: { approach: string; time: string; space: string; code: string } | null;
  focus: { interruptions: number; awayMs: number };
  startedAt: string;
  completedAt: string | null;
};

export type ConceptMasteryView = { concept: CodingConcept; label: string; score: number; independentSolves: number; assistedSolves: number; status: "new" | "practising" | "mastered" | "review" };

export type CodingStateView = {
  profile: CodingProfileView;
  attempt: CodingAttemptView | null;
  /** A problem being written and verified for this learner, or the last try failing. */
  preparing: { status: "idle" | "preparing" | "failed"; message: string | null };
  mastery: ConceptMasteryView[];
  /** What Next would open, once the current attempt is over. */
  next: { kind: "concept" | "transfer" | "reinforcement" | "more" | "done"; concept: CodingConcept | null; label: string } | null;
};

// ---------------------------------------------------------------------------------------------------------------------
// Requests.

export const MAX_CODE_LENGTH = 40_000;
const attemptId = z.string().uuid();
const code = z.string().max(MAX_CODE_LENGTH);
const language = z.enum(CODING_LANGUAGES);

export const codingStartRequestSchema = z.object({ concept: z.enum(CODING_CONCEPT_SLUGS).optional(), retry: z.boolean().optional() }).strict();
export const codingDraftRequestSchema = z.object({ attemptId, language, code }).strict();
export const codingRunRequestSchema = z.object({ attemptId, language, code, custom: z.array(z.string().max(20_000)).max(4).default([]) }).strict();
export const codingSubmitRequestSchema = z.object({ attemptId, language, code }).strict();
export const codingHintRequestSchema = z.object({ attemptId, language, code }).strict();
/** The learner's answer to the tutor's question. */
export const codingReplyRequestSchema = z.object({ attemptId, language, code, message: z.string().trim().min(1).max(1_000) }).strict();
export const codingActivityRequestSchema = z.object({
  attemptId,
  /** Focused time spent editing or running since the last report, and edits made in it. */
  activeMs: z.number().int().min(0).max(120_000),
  edits: z.number().int().min(0).max(10_000),
  /** Characters pasted in from outside the editor (copies made inside it don't count). */
  pasted: z.number().int().min(0).max(1_000_000).default(0),
  away: z.array(z.object({ ms: z.number().int().min(0).max(86_400_000) }).strict()).max(20).default([]),
  /** How long since the learner last typed or clicked, and whether the page is in front of them now: the tutor checks in on a quiet stretch. */
  idleMs: z.number().int().min(0).max(86_400_000).optional(),
  visible: z.boolean().optional(),
}).strict();
export const codingAttemptActionSchema = z.object({ attemptId }).strict();

export type CodingRunRequest = z.input<typeof codingRunRequestSchema>;
export type CodingActivityRequest = z.input<typeof codingActivityRequestSchema>;

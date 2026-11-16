import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, numeric, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { resources, resourceVersions } from "../catalog/resources.js";
import { users } from "../identity/users.js";
import { practiceSchema } from "../namespaces.js";
import { studySessions } from "../study/sessions.js";

/**
 * Whether a video (one transcript version) calls for coding practice and which concepts it teaches, decided once from the
 * transcript and shared by every learner.
 */
export const videoCodingProfiles = practiceSchema.table(
  "video_coding_profiles",
  {
    resourceVersionId: uuid("resource_version_id").primaryKey().references(() => resourceVersions.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    // classifying, ready or failed; a classifying row older than its window was cut off and is tried again.
    status: text("status").notNull(),
    category: text("category"),
    practiceFit: real("practice_fit"),
    recommended: boolean("recommended").notNull().default(false),
    language: text("language"),
    difficulty: text("difficulty"),
    // [{ concept, focus, startMs }], in the order the lesson teaches them.
    concepts: jsonb("concepts").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    reason: text("reason"),
    contractVersion: text("contract_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("video_coding_profiles_status_chk", sql`${table.status} IN ('classifying', 'ready', 'failed')`),
    index("video_coding_profiles_resource_idx").on(table.resourceId),
  ],
);

/**
 * A coding problem in the shared bank: what a learner and the tutor may see. Its tests, generator and reference code live
 * in `coding_problem_secrets`, which the app can write but never read; only the runner reads them, and only the runner
 * marks a problem verified. A variant (`parent_problem_id`) practises its parent's concept in a different form.
 */
export const codingProblems = practiceSchema.table(
  "coding_problems",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    concept: text("concept").notNull(),
    difficulty: text("difficulty").notNull(),
    parentProblemId: uuid("parent_problem_id"),
    // generating (being written), verifying (with the runner), verified (servable) or rejected.
    status: text("status").notNull(),
    title: text("title"),
    // The statement, signature, comparison, constraints, examples, lesson moments and related problems.
    spec: jsonb("spec").$type<Record<string, unknown>>(),
    // What the tutor works from: the hint ladder, misconceptions and the reference approaches in words (never their code).
    tutor: jsonb("tutor").$type<Record<string, unknown>>(),
    verification: jsonb("verification").$type<Record<string, unknown>>(),
    failure: text("failure"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    model: text("model"),
    contractVersion: text("contract_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [
    check("coding_problems_status_chk", sql`${table.status} IN ('generating', 'verifying', 'verified', 'rejected')`),
    check("coding_problems_difficulty_chk", sql`${table.difficulty} IN ('easy', 'medium', 'hard')`),
    check("coding_problems_verified_chk", sql`${table.status} <> 'verified' OR (${table.spec} IS NOT NULL AND ${table.tutor} IS NOT NULL AND ${table.verifiedAt} IS NOT NULL)`),
    foreignKey({ name: "coding_problems_parent_fkey", columns: [table.parentProblemId], foreignColumns: [table.id] }).onDelete("set null"),
    index("coding_problems_bank_idx").on(table.resourceId, table.concept, table.difficulty, table.status),
    index("coding_problems_parent_idx").on(table.parentProblemId, table.status),
    // One problem written at a time for a slot, so two tabs (or the prefetch and a click) never both pay for it.
    uniqueIndex("coding_problems_generating_uq")
      .on(sql`coalesce(${table.resourceId}, '00000000-0000-0000-0000-000000000000'::uuid)`, table.concept, table.difficulty, sql`coalesce(${table.parentProblemId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${table.status} IN ('generating', 'verifying')`),
  ],
);

/** The grading half of a problem: written once by the app as it is authored, then read (and completed) only by the runner. */
export const codingProblemSecrets = practiceSchema.table(
  "coding_problem_secrets",
  {
    problemId: uuid("problem_id").primaryKey().references(() => codingProblems.id, { onDelete: "cascade" }),
    // The generator, validator, baseline and optimal references and the authored edge cases, as the model wrote them.
    authored: jsonb("authored").$type<Record<string, unknown>>().notNull(),
    // Materialized by verification: { small: [{ args, expected }], large: [{ args, expected }] }.
    tests: jsonb("tests").$type<Record<string, unknown>>(),
    // The large suite's wall-clock budget in Python; other languages are scaled from it.
    perfLimitMs: integer("perf_limit_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * One learner working one problem in a session. The tutoring state machine, the help taken and the stall tracker live here,
 * so the attempt resumes exactly after a refresh; drafts are kept per language.
 */
export const codingAttempts = practiceSchema.table(
  "coding_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    problemId: uuid("problem_id").notNull().references(() => codingProblems.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    parentAttemptId: uuid("parent_attempt_id"),
    // How many reinforcement problems deep this attempt is (0 for primary and transfer), so the recovery path is finite.
    depth: integer("depth").notNull().default(0),
    state: text("state").notNull(),
    phase: text("phase").notNull().default("correct"),
    language: text("language").notNull(),
    drafts: jsonb("drafts").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    correctSolved: boolean("correct_solved").notNull().default(false),
    efficientSolved: boolean("efficient_solved").notNull().default(false),
    hintLevel: integer("hint_level").notNull().default(0),
    revealed: boolean("revealed").notNull().default(false),
    failedSubmissions: integer("failed_submissions").notNull().default(0),
    submissionCount: integer("submission_count").notNull().default(0),
    runCount: integer("run_count").notNull().default(0),
    tracker: jsonb("tracker").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    focus: jsonb("focus").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    credit: numeric("credit", { precision: 5, scale: 4 }),
    outcome: text("outcome"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("coding_attempts_role_chk", sql`${table.role} IN ('primary', 'transfer', 'reinforcement')`),
    check("coding_attempts_phase_chk", sql`${table.phase} IN ('correct', 'efficient')`),
    check("coding_attempts_hint_level_chk", sql`${table.hintLevel} BETWEEN 0 AND 4`),
    check("coding_attempts_outcome_chk", sql`${table.outcome} IS NULL OR ${table.outcome} IN ('advance', 'transfer', 'reinforce', 'review_later')`),
    check("coding_attempts_credit_chk", sql`${table.credit} IS NULL OR ${table.credit} BETWEEN 0 AND 1`),
    foreignKey({ name: "coding_attempts_user_session_fkey", columns: [table.userId, table.studySessionId], foreignColumns: [studySessions.userId, studySessions.id] }).onDelete("restrict"),
    foreignKey({ name: "coding_attempts_parent_fkey", columns: [table.parentAttemptId], foreignColumns: [table.id] }).onDelete("restrict"),
    // One open problem per learner per video.
    uniqueIndex("coding_attempts_open_uq").on(table.userId, table.resourceId).where(sql`${table.completedAt} IS NULL`),
    index("coding_attempts_user_resource_idx").on(table.userId, table.resourceId, table.startedAt.desc()),
  ],
);

/** Every submission's grade, as the runner reported it (never a hidden test's contents). */
export const codingSubmissions = practiceSchema.table(
  "coding_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => codingAttempts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    language: text("language").notNull(),
    code: text("code").notNull(),
    verdict: text("verdict").notNull(),
    passed: integer("passed").notNull(),
    total: integer("total").notNull(),
    runtimeMs: integer("runtime_ms"),
    memoryKb: integer("memory_kb"),
    // The first failure as the learner may see it, and compiler output.
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coding_submissions_attempt_idx").on(table.attemptId, table.createdAt)],
);

/**
 * The attempt's tutoring record: hints (with level and whether the learner asked), offers and their answers, the
 * conversation, reveals, focus interruptions and state transitions.
 */
export const codingEvents = practiceSchema.table(
  "coding_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => codingAttempts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    level: integer("level"),
    text: text("text"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("coding_events_kind_chk", sql`${table.kind} IN ('hint', 'offer', 'offer_declined', 'learner', 'tutor', 'reveal', 'focus', 'transition')`),
    index("coding_events_attempt_idx").on(table.attemptId, table.createdAt),
  ],
);

/** A learner's standing on each coding concept, across every video: what problems are chosen and reviewed from. */
export const codingMastery = practiceSchema.table(
  "coding_mastery",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    concept: text("concept").notNull(),
    score: real("score").notNull(),
    independentSolves: integer("independent_solves").notNull().default(0),
    assistedSolves: integer("assisted_solves").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    needsReview: boolean("needs_review").notNull().default(false),
    lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }).notNull().defaultNow(),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.concept] }),
    check("coding_mastery_score_chk", sql`${table.score} BETWEEN 0 AND 1`),
  ],
);

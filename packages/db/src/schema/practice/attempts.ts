import { sql } from "drizzle-orm";
import { char, check, foreignKey, index, integer, jsonb, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { practiceSchema } from "../namespaces.js";
import { attemptStatus } from "../domain-values.js";
import { users } from "../identity/users.js";
import { studySessions } from "../study/sessions.js";
import { exerciseBindings, exerciseVersions } from "./exercises.js";

export const exerciseAttempts = practiceSchema.table(
  "exercise_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "restrict" }),
    exerciseBindingId: uuid("exercise_binding_id").notNull().references(() => exerciseBindings.id, { onDelete: "restrict" }),
    exerciseVersionId: uuid("exercise_version_id").notNull().references(() => exerciseVersions.id, { onDelete: "restrict" }),
    status: attemptStatus("status").notNull().default("started"),
    language: text("language"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    firstRunAt: timestamp("first_run_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    score: real("score"),
    passedCaseCount: integer("passed_case_count"),
    totalCaseCount: integer("total_case_count"),
    hintCount: integer("hint_count").notNull().default(0),
    submissionCount: integer("submission_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("exercise_attempts_score_chk", sql`${table.score} IS NULL OR ${table.score} BETWEEN 0 AND 1`),
    check("exercise_attempts_passed_count_chk", sql`${table.passedCaseCount} IS NULL OR ${table.passedCaseCount} >= 0`),
    check("exercise_attempts_total_count_chk", sql`${table.totalCaseCount} IS NULL OR ${table.totalCaseCount} >= 0`),
    check("exercise_attempts_count_order_chk", sql`${table.passedCaseCount} IS NULL OR ${table.totalCaseCount} IS NULL OR ${table.passedCaseCount} <= ${table.totalCaseCount}`),
    check("exercise_attempts_counters_chk", sql`${table.hintCount} >= 0 AND ${table.submissionCount} >= 0`),
    uniqueIndex("exercise_attempts_user_idempotency_uq").on(table.userId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
    foreignKey({
      name: "exercise_attempts_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "exercise_attempts_binding_version_fkey",
      columns: [table.exerciseBindingId, table.exerciseVersionId],
      foreignColumns: [exerciseBindings.id, exerciseBindings.exerciseVersionId],
    }).onDelete("restrict"),
    index("exercise_attempts_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("exercise_attempts_session_created_idx").on(table.studySessionId, table.createdAt),
    index("exercise_attempts_version_status_idx").on(table.exerciseVersionId, table.status),
  ],
);

export const codeSnapshots = practiceSchema.table(
  "code_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => exerciseAttempts.id, { onDelete: "restrict" }),
    sequenceNo: integer("sequence_no").notNull(),
    kind: text("kind").notNull(),
    sourceCode: text("source_code").notNull(),
    sourceSha256: char("source_sha256", { length: 64 }).notNull(),
    parentSnapshotId: uuid("parent_snapshot_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("code_snapshots_attempt_sequence_uq").on(table.attemptId, table.sequenceNo),
    unique("code_snapshots_attempt_id_uq").on(table.attemptId, table.id),
    index("code_snapshots_attempt_created_idx").on(table.attemptId, table.createdAt.desc()),
    check("code_snapshots_sequence_no_chk", sql`${table.sequenceNo} >= 0`),
    foreignKey({
      name: "code_snapshots_parent_attempt_fkey",
      columns: [table.attemptId, table.parentSnapshotId],
      foreignColumns: [table.attemptId, table.id],
    }).onDelete("restrict"),
  ],
);

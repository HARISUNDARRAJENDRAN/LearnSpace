import { sql } from "drizzle-orm";
import { bigint, char, check, foreignKey, index, integer, jsonb, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { practiceSchema } from "../namespaces.js";
import { executionStatus } from "../domain-values.js";
import { concepts } from "../knowledge/concepts.js";
import { codeSnapshots, exerciseAttempts } from "./attempts.js";
import { exerciseVersions } from "./exercises.js";

export const testBundles = practiceSchema.table(
  "test_bundles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseVersionId: uuid("exercise_version_id").notNull().references(() => exerciseVersions.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    caseCount: integer("case_count").notNull(),
    runtimeImageDigest: text("runtime_image_digest").notNull(),
    harnessVersion: text("harness_version").notNull(),
    resourceLimits: jsonb("resource_limits").$type<Record<string, unknown>>().notNull(),
    keyReference: text("key_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("test_bundles_version_kind_hash_uq").on(table.exerciseVersionId, table.kind, table.sha256),
    uniqueIndex("test_bundles_object_key_uq").on(table.objectKey),
    check("test_bundles_case_count_chk", sql`${table.caseCount} > 0`),
  ],
);

export const executionRuns = practiceSchema.table(
  "execution_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => exerciseAttempts.id, { onDelete: "restrict" }),
    codeSnapshotId: uuid("code_snapshot_id").notNull().references(() => codeSnapshots.id, { onDelete: "restrict" }),
    testBundleId: uuid("test_bundle_id").notNull().references(() => testBundles.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").notNull(),
    status: executionStatus("status").notNull(),
    runnerPool: text("runner_pool").notNull(),
    runtimeImageDigest: text("runtime_image_digest").notNull(),
    sourceSha256: char("source_sha256", { length: 64 }).notNull(),
    testBundleSha256: char("test_bundle_sha256", { length: 64 }).notNull(),
    cpuLimitMs: integer("cpu_limit_ms").notNull(),
    wallLimitMs: integer("wall_limit_ms").notNull(),
    memoryLimitBytes: bigint("memory_limit_bytes", { mode: "number" }).notNull(),
    exitCode: integer("exit_code"),
    signal: text("signal"),
    cpuTimeMs: integer("cpu_time_ms"),
    wallTimeMs: integer("wall_time_ms"),
    peakMemoryBytes: bigint("peak_memory_bytes", { mode: "number" }),
    passedCaseCount: integer("passed_case_count"),
    totalCaseCount: integer("total_case_count"),
    stdoutExcerpt: text("stdout_excerpt"),
    stderrExcerpt: text("stderr_excerpt"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("execution_runs_request_id_uq").on(table.requestId),
    check("execution_runs_limits_chk", sql`${table.wallLimitMs} > 0 AND ${table.cpuLimitMs} > 0 AND ${table.memoryLimitBytes} > 0`),
    check("execution_runs_case_counts_chk", sql`${table.passedCaseCount} IS NULL OR ${table.totalCaseCount} IS NULL OR (${table.passedCaseCount} >= 0 AND ${table.passedCaseCount} <= ${table.totalCaseCount})`),
    index("execution_runs_attempt_created_idx").on(table.attemptId, table.createdAt.desc()),
    index("execution_runs_status_created_idx").on(table.status, table.createdAt),
    foreignKey({
      name: "execution_runs_attempt_snapshot_fkey",
      columns: [table.attemptId, table.codeSnapshotId],
      foreignColumns: [codeSnapshots.attemptId, codeSnapshots.id],
    }).onDelete("restrict"),
  ],
);

export const observerDiagnostics = practiceSchema.table(
  "observer_diagnostics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => exerciseAttempts.id, { onDelete: "restrict" }),
    executionRunId: uuid("execution_run_id").references(() => executionRuns.id, { onDelete: "set null" }),
    codeSnapshotId: uuid("code_snapshot_id").notNull().references(() => codeSnapshots.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    confidence: real("confidence").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    diagnosticText: text("diagnostic_text").notNull(),
    modelInvocationId: uuid("model_invocation_id"),
    policyVersion: text("policy_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("observer_diagnostics_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
    index("observer_diagnostics_attempt_created_idx").on(table.attemptId, table.createdAt.desc()),
  ],
);

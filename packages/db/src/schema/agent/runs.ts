import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agentSchema } from "../namespaces.js";
import { agentRunStatus, agentStepStatus } from "../domain-values.js";
import { users } from "../identity/users.js";
import { studySessions } from "../study/sessions.js";
import { tutorThreads } from "../study/tutor.js";

export const agentRuns = agentSchema.table(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    tutorThreadId: uuid("tutor_thread_id").references(() => tutorThreads.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    status: agentRunStatus("status").notNull(),
    goal: text("goal").notNull(),
    plannerVersion: text("planner_version"),
    policyVersion: text("policy_version").notNull(),
    maxIterations: integer("max_iterations").notNull(),
    maxToolCalls: integer("max_tool_calls").notNull(),
    maxTokens: integer("max_tokens").notNull(),
    traceId: text("trace_id"),
    correlationId: uuid("correlation_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    finalAnswer: text("final_answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("agent_runs_positive_budgets_chk", sql`${table.maxIterations} > 0 AND ${table.maxToolCalls} >= 0 AND ${table.maxTokens} > 0`),
    index("agent_runs_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("agent_runs_session_created_idx").on(table.studySessionId, table.createdAt.desc()),
    index("agent_runs_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const agentSteps = agentSchema.table(
  "agent_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    parentStepId: uuid("parent_step_id"),
    stepKey: text("step_key").notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    kind: text("kind").notNull(),
    status: agentStepStatus("status").notNull(),
    dependsOn: text("depends_on").array().notNull().default(sql`'{}'::text[]`),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    outputSummary: text("output_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
  },
  (table) => [
    uniqueIndex("agent_steps_run_key_uq").on(table.agentRunId, table.stepKey),
    uniqueIndex("agent_steps_run_sequence_uq").on(table.agentRunId, table.sequenceNo),
    index("agent_steps_run_status_idx").on(table.agentRunId, table.status),
  ],
);

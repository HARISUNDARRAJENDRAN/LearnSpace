import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { practiceSchema } from "../namespaces.js";
import { exerciseAttempts } from "./attempts.js";
import { observerDiagnostics } from "./execution.js";

export const hintEvents = practiceSchema.table(
  "hint_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => exerciseAttempts.id, { onDelete: "restrict" }),
    diagnosticId: uuid("diagnostic_id"),
    hintLevel: integer("hint_level").notNull(),
    triggerType: text("trigger_type").notNull(),
    userRequested: boolean("user_requested").notNull(),
    content: text("content").notNull(),
    policyVersion: text("policy_version").notNull(),
    modelInvocationId: uuid("model_invocation_id"),
    presentedAt: timestamp("presented_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    check("hint_events_level_chk", sql`${table.hintLevel} BETWEEN 1 AND 5`),
    index("hint_events_attempt_presented_idx").on(table.attemptId, table.presentedAt),
    foreignKey({
      name: "hint_events_attempt_diagnostic_fkey",
      columns: [table.attemptId, table.diagnosticId],
      foreignColumns: [observerDiagnostics.attemptId, observerDiagnostics.id],
    }).onDelete("restrict"),
  ],
);

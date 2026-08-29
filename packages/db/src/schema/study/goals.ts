import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { goalStatus } from "../domain-values.js";
import { users } from "../identity/users.js";
import { concepts } from "../knowledge/concepts.js";

export const learningGoals = studySchema.table(
  "learning_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    primaryConceptId: uuid("primary_concept_id").references(() => concepts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    intent: text("intent"),
    status: goalStatus("status").notNull().default("active"),
    startingLevel: text("starting_level"),
    targetLevel: text("target_level"),
    targetAt: timestamp("target_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("learning_goals_user_status_updated_idx").on(table.userId, table.status, table.updatedAt.desc())],
);

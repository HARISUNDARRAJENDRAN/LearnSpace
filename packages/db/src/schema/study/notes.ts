import { sql } from "drizzle-orm";
import { foreignKey, integer, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { studySessions } from "./sessions.js";

/**
 * A session's spoken notes: the document the learner and the voice companion build together, the recent conversation
 * that built it, and the notes as they were before each of the companion's recent edits, so one can be undone.
 */
export const sessionNotes = studySchema.table(
  "session_notes",
  {
    studySessionId: uuid("study_session_id").primaryKey().references(() => studySessions.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(0),
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    turns: jsonb("turns").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    history: jsonb("history").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "session_notes_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
  ],
);

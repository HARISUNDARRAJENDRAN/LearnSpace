import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { resources } from "../catalog/resources.js";
import { studySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { studySessions } from "./sessions.js";

/**
 * A learner's notes for one video, kept across every session that studies it: the study guide written from the video, then
 * what the learner and the voice companion build on it, and the notes as they were before each of the companion's recent
 * edits, so one can be undone.
 */
export const videoNotes = studySchema.table(
  "video_notes",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(0),
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    history: jsonb("history").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    // writing, ready or failed; null until the guide is first started.
    guideStatus: text("guide_status"),
    guideStartedAt: timestamp("guide_started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.resourceId] }),
    check("video_notes_guide_status_check", sql`${table.guideStatus} in ('writing', 'ready', 'failed')`),
  ],
);

/**
 * Every line of the conversation that built the notes, as said: the learner's speech (or typing) and Luna's replies. Learner
 * lines are saved before Luna answers, so nothing said is lost to an interruption or a failed turn; their ids come from the
 * client, so a resent turn saves each line once.
 */
export const sessionTranscript = studySchema.table(
  "session_transcript",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lines saved in one transaction share a timestamp; this keeps them in the order they were said.
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    // The video being talked about: a course session moves between videos, and each keeps its own conversation.
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
    positionMs: integer("position_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "session_transcript_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
    check("session_transcript_speaker_check", sql`${table.speaker} in ('you', 'luna')`),
    index("session_transcript_session_idx").on(table.studySessionId, table.resourceId, table.seq),
  ],
);

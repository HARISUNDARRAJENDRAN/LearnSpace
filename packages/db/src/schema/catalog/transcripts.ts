import { char, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { resources } from "./resources.js";

/** A learner's browser download of a video's captions; published for everyone once a second learner's copy matches. */
export const transcriptSubmissions = catalogSchema.table("transcript_submissions", {
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  contentSha256: char("content_sha256", { length: 64 }).notNull(),
  segments: jsonb("segments").$type<[number, number, string][]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.resourceId, table.userId] })]);

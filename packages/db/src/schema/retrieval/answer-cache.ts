import { char, index, jsonb, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";
import { retrievalSchema } from "../namespaces.js";
import { resourceVersions } from "../catalog/resources.js";
import { ACTIVE_EMBEDDING_DIMENSIONS } from "./embeddings.js";

/** First-turn tutor answers about one public transcript version, reusable by any learner asking the same thing. */
export const answerCache = retrievalSchema.table(
  "answer_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceVersionId: uuid("resource_version_id").notNull().references(() => resourceVersions.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").notNull(),
    scopeKey: text("scope_key").notNull(),
    questionSha256: char("question_sha256", { length: 64 }).notNull(),
    questionEmbedding: vector("question_embedding", { dimensions: ACTIVE_EMBEDDING_DIMENSIONS }),
    answer: jsonb("answer").$type<Record<string, unknown>>().notNull(),
    chunkIds: uuid("chunk_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("answer_cache_question_uq").on(table.resourceVersionId, table.contractVersion, table.scopeKey, table.questionSha256),
    index("answer_cache_scope_idx").on(table.resourceVersionId, table.contractVersion, table.scopeKey),
  ],
);

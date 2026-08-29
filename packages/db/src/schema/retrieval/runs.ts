import { sql } from "drizzle-orm";
import { boolean, char, foreignKey, index, integer, jsonb, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { retrievalSchema } from "../namespaces.js";
import { agentRuns } from "../agent/runs.js";
import { resourceChunks } from "./chunks.js";
import { embeddingProfiles } from "./embeddings.js";
import { resourceVersions } from "../catalog/resources.js";
import { studySessions } from "../study/sessions.js";
import { users } from "../identity/users.js";

export const retrievalRuns = retrievalSchema.table(
  "retrieval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    queryText: text("query_text").notNull(),
    querySha256: char("query_sha256", { length: 64 }).notNull(),
    embeddingProfileId: text("embedding_profile_id").references(() => embeddingProfiles.id, { onDelete: "set null" }),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
    strategyVersion: text("strategy_version").notNull(),
    status: text("status").notNull(),
    candidateCount: integer("candidate_count").notNull().default(0),
    selectedCount: integer("selected_count").notNull().default(0),
    latencyMs: integer("latency_ms"),
    traceId: text("trace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("retrieval_runs_session_created_idx").on(table.studySessionId, table.createdAt.desc()),
    index("retrieval_runs_user_created_idx").on(table.userId, table.createdAt.desc()),
    foreignKey({
      name: "retrieval_runs_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("cascade"),
  ],
);

export const retrievedChunks = retrievalSchema.table(
  "retrieved_chunks",
  {
    retrievalRunId: uuid("retrieval_run_id").notNull().references(() => retrievalRuns.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").notNull().references(() => resourceChunks.id, { onDelete: "cascade" }),
    candidateRank: integer("candidate_rank").notNull(),
    finalRank: integer("final_rank"),
    lexicalScore: real("lexical_score"),
    vectorScore: real("vector_score"),
    rerankScore: real("rerank_score"),
    selected: boolean("selected").notNull().default(false),
    reasonCodes: jsonb("reason_codes").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    primaryKey({ columns: [table.retrievalRunId, table.chunkId] }),
    uniqueIndex("retrieved_chunks_run_candidate_rank_uq").on(table.retrievalRunId, table.candidateRank),
  ],
);

export const citations = retrievalSchema.table(
  "citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    retrievalRunId: uuid("retrieval_run_id").notNull().references(() => retrievalRuns.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").notNull(),
    resourceVersionId: uuid("resource_version_id").notNull(),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    messageId: uuid("message_id"),
    ordinal: integer("ordinal").notNull(),
    anchorSnapshot: jsonb("anchor_snapshot").$type<Record<string, unknown>>().notNull(),
    quoteSha256: char("quote_sha256", { length: 64 }),
    quoteStart: integer("quote_start"),
    quoteEnd: integer("quote_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("citations_retrieval_ordinal_uq").on(table.retrievalRunId, table.ordinal),
    index("citations_agent_run_idx").on(table.agentRunId),
    index("citations_message_idx").on(table.messageId),
    foreignKey({
      name: "citations_retrieved_chunk_fkey",
      columns: [table.retrievalRunId, table.chunkId],
      foreignColumns: [retrievedChunks.retrievalRunId, retrievedChunks.chunkId],
    }).onDelete("cascade"),
    foreignKey({
      name: "citations_version_chunk_fkey",
      columns: [table.resourceVersionId, table.chunkId],
      foreignColumns: [resourceChunks.resourceVersionId, resourceChunks.id],
    }).onDelete("restrict"),
  ],
);

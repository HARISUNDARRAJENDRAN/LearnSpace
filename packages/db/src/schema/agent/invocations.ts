import { char, index, integer, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agentSchema } from "../namespaces.js";
import { agentRuns } from "./runs.js";

export const modelInvocations = agentSchema.table(
  "model_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    modelName: text("model_name").notNull(),
    purpose: text("purpose").notNull(),
    promptTemplateId: text("prompt_template_id"),
    promptTemplateVer: text("prompt_template_ver"),
    inputSha256: char("input_sha256", { length: 64 }),
    outputSha256: char("output_sha256", { length: 64 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    firstOutputMs: integer("first_output_ms"),
    latencyMs: integer("latency_ms"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 18, scale: 8 }),
    cacheStatus: text("cache_status"),
    safetyStatus: text("safety_status"),
    rawInputObjectKey: text("raw_input_object_key"),
    rawOutputObjectKey: text("raw_output_object_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("model_invocations_run_created_idx").on(table.agentRunId, table.createdAt),
    index("model_invocations_provider_model_created_idx").on(table.provider, table.modelName, table.createdAt),
  ],
);

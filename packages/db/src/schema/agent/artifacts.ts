import { primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agentSchema } from "../namespaces.js";
import { resources } from "../catalog/resources.js";
import { agentRuns } from "./runs.js";

export const agentArtifacts = agentSchema.table(
  "agent_artifacts",
  {
    agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.agentRunId, table.resourceId, table.role] })],
);

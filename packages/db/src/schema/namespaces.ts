import { pgSchema } from "drizzle-orm/pg-core";

export const identitySchema = pgSchema("identity");
export const catalogSchema = pgSchema("catalog");
export const studySchema = pgSchema("study");
export const activitySchema = pgSchema("activity");
export const retrievalSchema = pgSchema("retrieval");
export const practiceSchema = pgSchema("practice");
export const knowledgeSchema = pgSchema("knowledge");
export const agentSchema = pgSchema("agent");
export const discoverySchema = pgSchema("discovery");
export const opsSchema = pgSchema("ops");
export const projectionSchema = pgSchema("projection");

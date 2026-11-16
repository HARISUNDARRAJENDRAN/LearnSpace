import { sql } from "drizzle-orm";
import { check, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { resources, resourceVersions } from "../catalog/resources.js";
import { practiceSchema } from "../namespaces.js";

/** Paper-specific planner and guide output, cached for one immutable paper version. */
export const paperCodingProfiles = practiceSchema.table("paper_coding_profiles", {
  resourceVersionId: uuid("resource_version_id").primaryKey().references(() => resourceVersions.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  components: jsonb("components").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  verifiedExercises: integer("verified_exercises").notNull().default(0),
  guideStatus: text("guide_status").notNull().default("pending"),
  guide: jsonb("guide").$type<Record<string, unknown> | null>(),
  failure: text("failure"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("paper_coding_profiles_status_chk", sql`${table.status} IN ('planning', 'ready', 'ineligible', 'failed')`),
  check("paper_coding_profiles_guide_status_chk", sql`${table.guideStatus} IN ('pending', 'generating', 'ready', 'failed')`),
  check("paper_coding_profiles_verified_chk", sql`${table.verifiedExercises} >= 0`),
]);

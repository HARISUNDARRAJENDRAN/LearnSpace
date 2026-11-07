import { bigint, date, primaryKey, text } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";

export const apiUsageDaily = opsSchema.table(
  "api_usage_daily",
  {
    provider: text("provider").notNull(),
    usageDate: date("usage_date").notNull(),
    units: bigint("units", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.provider, table.usageDate] })],
);

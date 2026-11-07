import type postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

/** Units used today (UTC) for a provider, from the shared ops.api_usage_daily counter. */
export async function dailyUsage(sql: SqlClient, provider: string): Promise<number> {
  const [row] = await sql<{ units: string }[]>`
    SELECT units FROM ops.api_usage_daily WHERE provider = ${provider} AND usage_date = (now() AT TIME ZONE 'UTC')::date
  `;
  return Number(row?.units ?? 0);
}

export async function recordUsage(sql: SqlClient, provider: string, units: number): Promise<void> {
  if (units <= 0) return;
  await sql`
    INSERT INTO ops.api_usage_daily (provider, usage_date, units)
    VALUES (${provider}, (now() AT TIME ZONE 'UTC')::date, ${units})
    ON CONFLICT (provider, usage_date) DO UPDATE SET units = ops.api_usage_daily.units + EXCLUDED.units
  `;
}

import postgres from "postgres";
import type { ProblemRecord, ProblemStore } from "./problems.js";

/**
 * Problems through the database's runner role: the only role that can read a problem's secret half and the only one that
 * can mark a problem verified (and then only one that is verifying).
 */
export function createDatabaseStore(url: string): ProblemStore & { close(): Promise<void> } {
  const sql = postgres(url, { max: 4, idle_timeout: 30, prepare: false });
  return {
    async load(id) {
      const rows = await sql<Array<{ id: string; status: ProblemRecord["status"]; spec: unknown; verification: unknown; authored: unknown; tests: unknown; perf_limit_ms: number | null }>>`
        SELECT p.id, p.status, p.spec, p.verification, s.authored, s.tests, s.perf_limit_ms
        FROM practice.coding_problems p
        JOIN practice.coding_problem_secrets s ON s.problem_id = p.id
        WHERE p.id = ${id}
      `;
      const row = rows[0];
      return row ? { id: row.id, status: row.status, spec: row.spec, verification: row.verification, authored: row.authored, tests: row.tests, perfLimitMs: row.perf_limit_ms } : null;
    },
    async publish(id, result) {
      return sql.begin(async (tx) => {
        const secrets = await tx`
          UPDATE practice.coding_problem_secrets SET tests = ${tx.json(result.tests as never)}, perf_limit_ms = ${result.perfLimitMs}
          WHERE problem_id = ${id}
        `;
        if (secrets.count !== 1) return false;
        const problems = await tx`
          UPDATE practice.coding_problems SET status = 'verified', verification = ${tx.json(result.verification as never)}, verified_at = now()
          WHERE id = ${id} AND status = 'verifying'
        `;
        if (problems.count !== 1) throw new Error("problem stopped verifying");
        return true;
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message === "problem stopped verifying") return false;
        throw error;
      });
    },
    async reject(id, failure, verification) {
      await sql`
        UPDATE practice.coding_problems SET status = 'rejected', failure = ${failure}, verification = ${sql.json(verification as never)}
        WHERE id = ${id} AND status = 'verifying'
      `;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

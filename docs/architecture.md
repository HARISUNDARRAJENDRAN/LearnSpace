# Architecture notes

The authoritative product, system, and persistence specifications are retained in `specs/`. The implementation follows the greenfield target state and intentionally ignores legacy migration/backfill guidance.

`packages/db/src/schema/` is the relational source of truth and `infra/migrations/drizzle/` contains deterministic Drizzle migrations. PostgreSQL-specific security, circular-integrity, trigger, view, and index DDL is reviewed in `infra/migrations/sql/0002_security.sql`; the migration runner applies those statements idempotently after the Drizzle chain. Extensions are installed by the local Compose init process or the optional `DATABASE_ADMIN_URL` preflight because the migrator role is intentionally non-superuser.

Runtime roles are `learnspace_app`, `learnspace_ai`, `learnspace_worker`, `learnspace_runner`, and `learnspace_readonly`. User-scoped requests use transaction-local `app.user_id` through `withUserTransaction`.

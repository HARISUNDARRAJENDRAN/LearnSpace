# Architecture notes

The authoritative product, system, and persistence specifications are retained in `specs/`. The implementation follows the greenfield target state and intentionally ignores legacy migration/backfill guidance.

`packages/db/src/schema/` is the relational source of truth and `infra/migrations/drizzle/` contains the single deterministic migration chain. PostgreSQL-specific security, circular-integrity, trigger, view, index, and migration-ledger DDL is reviewed alongside the generated statements in the tracked Drizzle migration. The runner retains an advisory lock and records each ordered migration filename and checksum in `drizzle.migration_manifest`; it does not replay a second SQL directory or use `drizzle-kit push`.

Runtime roles are `learnspace_app`, `learnspace_ai`, `learnspace_worker`, `learnspace_runner`, and `learnspace_readonly`. User-scoped requests use transaction-local `app.user_id` through `withUserTransaction`.

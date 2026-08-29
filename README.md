# LearnSpace

LearnSpace is a session-centric learning, research, practice, and knowledge-retention platform. This repository currently establishes the TypeScript monorepo boundaries and the PostgreSQL + Drizzle persistence layer; application services remain intentionally scaffolded.

## Repository layout

- `apps/` deployable application boundaries
- `services/` worker and backend boundaries
- `packages/db/` PostgreSQL schema, migrations, client, seeds, and verification
- `packages/shared/` shared domain tuples and Zod contracts
- `infra/postgres/` local PostgreSQL + pgvector Compose setup
- `infra/migrations/` deterministic Drizzle migrations
- `docs/` implementation notes and architecture references

## Local database bootstrap

```text
pnpm install
docker compose -f infra/postgres/docker-compose.yml up -d
pnpm db:migrate
pnpm db:verify
pnpm db:seed:dev
pnpm db:test
```

The database layer uses PostgreSQL 16 with `pgcrypto`, `pg_trgm`, and `vector`. Production migrations are versioned SQL migrations; `drizzle-kit push` is not part of the production workflow.

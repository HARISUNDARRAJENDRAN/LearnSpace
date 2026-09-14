# LearnSpace

LearnSpace is a session-centric learning, research, practice, and knowledge-retention platform. The repository contains the Next.js web app, PostgreSQL + Drizzle persistence layer, discovery worker, and FastAPI discovery-agent service.

## Repository layout

- `apps/` deployable application boundaries
- `services/` worker and backend boundaries
- `packages/db/` PostgreSQL schema, migrations, client, seeds, and verification
- `packages/shared/` shared domain tuples and Zod contracts
- `infra/postgres/` local PostgreSQL + pgvector initialization
- `infra/migrations/` deterministic Drizzle migrations
- `docs/` implementation notes and architecture references

## Local development with Docker

The root Compose file starts PostgreSQL/pgvector, Redis, the migration and
development seed job, the Next.js web app, the discovery worker, and the AI
backend. Provider-backed discovery is disabled by default, so no API keys are
required for the first boot.

```text
cp .env.example .env
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3000>. The web container runs Next.js in development
mode and mounts the repository, so source changes are picked up without
rebuilding the image. Verification and password-reset links are returned by
the local UI because email delivery is disabled by default.

Useful commands:

```text
docker compose logs -f web worker ai
docker compose down
docker compose down -v  # removes local Compose volumes, including the database
```

Set `DISCOVERY_AGENTS_ENABLED=true` and provide `EXA_API_KEY` in `.env` to
enable live discovery-provider calls. The AI backend remains reachable at
<http://localhost:8080> for local health checks.

The AWS deployment for the discovery agent is documented in
[`infra/aws/discovery-agent/README.md`](infra/aws/discovery-agent/README.md).
It stores the Exa key and worker token in Secrets Manager and deploys the
existing Lambda container through ECR and CloudFormation.

The root Dockerfile defaults to the standalone web image and also exposes a
compiled worker target:

```text
docker build -t learnspace-web .
docker build --target worker -t learnspace-worker .
docker build -f services/ai-backend/Dockerfile -t learnspace-ai services/ai-backend
```

## Host-based database workflow

If you prefer to run the TypeScript tools on the host, start only PostgreSQL:

```text
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm db:verify
pnpm db:seed:dev
pnpm db:test
```

The database layer uses PostgreSQL 16 with `pgcrypto`, `pg_trgm`, and `vector`. Production migrations are versioned SQL migrations; `drizzle-kit push` is not part of the production workflow.

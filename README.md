# LearnSpace

LearnSpace is a session-centric learning, research, practice, and knowledge-retention platform. The repository contains the Next.js web app, the Electron desktop app, PostgreSQL + Drizzle persistence layer, discovery worker, and FastAPI discovery-agent service.

## Repository layout

- `apps/` deployable application boundaries: `web` (Next.js) and `desktop` (Electron)
- `services/` worker and backend boundaries
- `packages/db/` PostgreSQL schema, migrations, client, seeds, and verification
- `packages/shared/` shared domain tuples and Zod contracts
- `infra/postgres/` local PostgreSQL + pgvector initialization
- `infra/migrations/` deterministic Drizzle migrations
- `docs/` implementation notes and architecture references

## Local development with Docker

The root Compose file runs three services:

- `postgres` — PostgreSQL 16 with pgvector, holding all application data.
- `web` — the Next.js UI and API. On start it installs dependencies, applies
  migrations, verifies roles, and seeds development data, then serves the
  mounted source with hot reload.
- `backend` — the FastAPI discovery agent and the discovery worker in one
  image. The container restarts if either process exits.

Provider-backed discovery is disabled by default, so no API keys are required
for the first boot.

```text
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3000>. The web container runs Next.js in development
mode and mounts the repository, so source changes are picked up without
rebuilding the image. Verification and password-reset links are returned by
the local UI because email delivery is disabled by default.

Compose uses safe local defaults. Put any local-only overrides in the ignored
root `.env` file. For an intentional staging-like run, use the Vercel project
environment without writing production secrets into the repository:

```text
pnpm dlx vercel env run --environment=production --project=learnspace-staging -- pnpm --filter @learnspace/web dev
```

That command connects the app to the staging services configured in Vercel;
do not use it for destructive local database work.

Useful commands:

```text
docker compose logs -f web backend
docker compose down
docker compose down -v  # removes local Compose volumes, including the database
```

Set `DISCOVERY_AGENTS_ENABLED=true` and provide `EXA_API_KEY` in `.env` to
enable live discovery-provider calls. The discovery agent remains reachable at
<http://localhost:8080> for local health checks.

The AWS deployment for the discovery agent is documented in
[`infra/aws/discovery-agent/README.md`](infra/aws/discovery-agent/README.md).
It stores the Exa key and worker token in Secrets Manager and deploys the
existing Lambda container through ECR and CloudFormation.

The root Dockerfile defaults to the standalone web image. It also exposes the
`backend` target used by Compose and the standalone `worker` target deployed to
AWS (the agent itself deploys through `services/ai-backend/Dockerfile.lambda`):

```text
docker build -t learnspace-web .
docker build --target backend -t learnspace-backend .
docker build --target worker -t learnspace-worker .
```

## Desktop app

`apps/desktop` packages LearnSpace for Linux (AppImage, .deb), Windows (NSIS
installer), and macOS (universal .dmg). LearnSpace is a server-rendered app
backed by PostgreSQL, so the desktop app is a hardened window onto a
deployment rather than a second frontend. It keeps navigation on the
LearnSpace origin, opens other links in the system browser, and denies
camera, microphone, location, and notification requests.

Google refuses sign-in inside embedded app windows. In the desktop app,
"Continue with Google" opens the system browser. On success the server
returns the session through a single-purpose `learnspace://auth` link,
encrypted and valid for 60 seconds, which only the app that started the
sign-in accepts.

```text
pnpm --filter @learnspace/desktop start                          # run against the default deployment
LEARNSPACE_URL=http://localhost:3000 pnpm --filter @learnspace/desktop start
pnpm --filter @learnspace/desktop dist                           # package for the current OS into apps/desktop/release
```

The app opens `https://learnspace-staging.vercel.app` unless `LEARNSPACE_URL`
names another HTTPS origin (plain HTTP is accepted only for localhost). Each
installer must be built on its own OS. The `Desktop` workflow builds all three
on GitHub Actions when a `desktop-v*` tag is pushed or the workflow is run by
hand. Builds are unsigned, so macOS Gatekeeper and Windows SmartScreen warn on
first launch until signing certificates are configured. Google sign-in
returns to the app only from packaged builds, which register the
`learnspace://` scheme; development runs can use email sign-in. Packaging the
.deb on Arch Linux needs `libxcrypt-compat`.

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

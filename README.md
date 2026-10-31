# LearnSpace

LearnSpace is a session-centric learning, research, practice, and knowledge-retention platform. The repository contains the Next.js web app, PostgreSQL + Drizzle persistence layer, discovery worker, and FastAPI discovery-agent service.

## Repository layout

- `apps/web/` the Next.js web app
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
root `.env` file.

Useful commands:

```text
docker compose logs -f web backend
docker compose down
docker compose down -v  # removes local Compose volumes, including the database
```

Set `DISCOVERY_AGENTS_ENABLED=true` and provide `EXA_API_KEY` in `.env` to
enable live discovery-provider calls. The discovery agent remains reachable at
<http://localhost:8080> for local health checks.

## Self-hosting

Production runs the web and backend services from built images on any
machine with Docker, plus a Cloudflare Tunnel container as the only public
entrance. Nothing listens beyond loopback, so no router ports need opening.
PostgreSQL is hosted externally (any PostgreSQL 15+ with pgvector, such as a
Supabase project).

1. Create the database roles and extensions once, as the database's admin
   user, with a strong password for each role:

   ```text
   DATABASE_ADMIN_URL=... LEARNSPACE_MIGRATOR_PASSWORD=... LEARNSPACE_APP_PASSWORD=... \
   LEARNSPACE_AUTH_PASSWORD=... LEARNSPACE_AI_PASSWORD=... LEARNSPACE_WORKER_PASSWORD=... \
   LEARNSPACE_RUNNER_PASSWORD=... LEARNSPACE_READONLY_PASSWORD=... pnpm db:bootstrap:remote
   ```

   On Supabase, connect through the Supavisor pooler (the direct host is
   IPv6-only): user `<role>.<project-ref>`, port 5432 for session mode and
   6543 for transaction mode. Turn off the Data API, since the app reaches
   PostgreSQL directly.
2. In the Cloudflare dashboard (Zero Trust → Networks → Tunnels), create a
   tunnel on a domain you manage there, give it a public hostname that points
   at `http://web:3000`, and copy the tunnel token.
3. Put the settings in the ignored root `.env.production` file:

   ```text
   DATABASE_MIGRATOR_URL=...    # learnspace_migrator, session mode (migrations take a lock)
   DATABASE_URL=...             # learnspace_app, transaction mode
   DATABASE_AUTH_URL=...        # learnspace_auth, transaction mode
   DATABASE_WORKER_URL=...      # learnspace_worker, transaction mode
   DATABASE_AI_URL=...          # learnspace_ai, transaction mode
   APP_URL=https://learnspace.example.com
   AUTH_SECRET=...              # openssl rand -base64 48
   INTERNAL_SERVICE_TOKEN=...   # openssl rand -base64 32
   CLOUDFLARE_TUNNEL_TOKEN=...
   GOOGLE_CLIENT_ID=...         # authorize $APP_URL/api/auth/google/callback
   GOOGLE_CLIENT_SECRET=...
   RESEND_API_KEY=...           # email sign-up returns 503 without these two
   EMAIL_FROM=LearnSpace <noreply@learnspace.example.com>
   ```

4. Start it, and run the same command after each `git pull` to deploy:

   ```text
   docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml up -d --build
   ```

A migration job applies pending migrations before the web server starts.

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

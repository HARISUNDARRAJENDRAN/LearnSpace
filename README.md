# LearnSpace

LearnSpace is a session-centric learning, research, practice, and knowledge-retention platform. The repository contains the Next.js web app, the PostgreSQL + Drizzle persistence layer, and the discovery worker.

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
- `backend` — the discovery worker. It finds videos and papers through Exa,
  keeps YouTube metrics fresh and maintains recommendations.

Discovery needs API keys, so without them the first boot works on the seeded
catalog alone.

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

Provide `EXA_API_KEY` in `.env` to discover new videos and papers: the worker
searches per topic in the background, and the source picker searches
instantly from the web app. Background refreshes stop at
`EXA_DAILY_CALL_CAP` Exa calls per UTC day (default 1000), and the worker runs
`DISCOVERY_WORKER_CONCURRENCY` jobs at once (default 3), so a new learner's
topics are discovered in parallel.

Provide `YOUTUBE_API_KEY` (a Google Cloud key restricted to YouTube Data API
v3) to let the worker fetch video duration, statistics and channel stats, gate
Shorts, live, private and non-embeddable videos, and score quality. It spends
1 quota unit per 50 videos or channels, capped per Pacific day by
`YOUTUBE_DAILY_QUOTA_CAP` (default 9000 of YouTube's 10000). Metrics older than
`YOUTUBE_METRICS_MAX_AGE_DAYS` (default 7) are refreshed; statistics older than
30 days are deleted, as YouTube's API policy requires. To enrich existing videos
at once, run `pnpm --filter @learnspace/worker youtube:backfill`.

## Manual disposable E2E login

Run `pnpm e2e:manual` to start a loopback-only test app at
<http://localhost:3101/login>. It creates a separate local PostgreSQL database,
resets and seeds it, then recreates a verified test account with an empty
onboarding profile. Use `manual-e2e@example.test` and
`local-e2e-only-password`. Resend and Google OAuth are disabled in this local
mode; registration automatically follows the local verification route and
continues to onboarding. Press Ctrl+C to stop the app and remove the test
database. Each start begins with a fresh account and onboarding state;
production data is not used.

## Production

Production is the web app on Vercel and the discovery worker on Supabase,
both against one Supabase PostgreSQL project.

Create the database roles and extensions once, as the database's admin user,
with a strong password for each role:

```text
DATABASE_ADMIN_URL=... LEARNSPACE_MIGRATOR_PASSWORD=... LEARNSPACE_APP_PASSWORD=... \
LEARNSPACE_AUTH_PASSWORD=... LEARNSPACE_AI_PASSWORD=... LEARNSPACE_WORKER_PASSWORD=... \
LEARNSPACE_RUNNER_PASSWORD=... LEARNSPACE_READONLY_PASSWORD=... pnpm db:bootstrap:remote
```

Connect through the Supavisor pooler (the direct host is IPv6-only): user
`<role>.<project-ref>`, port 5432 for session mode and 6543 for transaction
mode, with `?sslmode=require`. Turn off the Data API, since the app reaches
PostgreSQL directly. Apply migrations before each deploy that adds one:
`DATABASE_MIGRATOR_URL=... pnpm db:migrate && pnpm db:verify` (session mode).

### Web app on Vercel

The web app deploys to Vercel from this repository with the project's Root
Directory set to `apps/web` and its function region set to Mumbai (`bom1`),
next to the database; `apps/web/vercel.json` builds the workspace packages
first. Auth rate limits are counted in PostgreSQL, so every function
instance shares them.

1. Set the project's environment variables: `DATABASE_URL` and
   `DATABASE_AUTH_URL` (transaction mode), `DB_PREPARED_STATEMENTS=false`,
   `DB_POOL_MAX=3`, `APP_URL`, `GOOGLE_REDIRECT_URI`
   (`$APP_URL/api/auth/google/callback`), `AUTH_SECRET`,
   `AUTH_SECURE_COOKIES=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `EXA_API_KEY`, and optionally
   `OPENAI_API_KEY` with `LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED=true`.
2. Deploy: `pnpm dlx vercel@65.12.1 deploy --prod` from the repository root.

### Discovery worker on Supabase

In production the worker runs as a Supabase Edge Function (locally it is the
`backend` service). Postgres calls it through pg_net when a discovery
request commits, and pg_cron calls it every five minutes for housekeeping.
Each call works through the queue for up to 100 seconds and leaves the rest
for the next call.

1. Bundle and deploy the function from the repository root:

   ```text
   pnpm --filter @learnspace/shared build
   pnpm --filter @learnspace/worker bundle:edge
   pnpm dlx supabase@3.0.0 functions deploy discovery-worker --remote=<project-ref> --use-api
   ```

2. Set its secrets (`pnpm dlx supabase@3.0.0 secrets set --remote=<project-ref> ...`):
   `DATABASE_WORKER_URL` (learnspace_worker, transaction mode), a random
   `WORKER_TRIGGER_SECRET` (`openssl rand -hex 32`), `EXA_API_KEY`,
   `YOUTUBE_API_KEY`, optionally `FIRECRAWL_API_KEY` (transcript fallback), and
   optionally `OPENAI_API_KEY` with `LEARNSPACE_SEMANTIC_DISCOVERY_ENABLED=true`.
3. In the SQL editor, store the function URL and the same secret in Vault,
   then run `supabase/setup.sql` (its header shows both `vault.create_secret`
   calls).
4. Sync the curated catalog after each curriculum change, since the function
   has no file system: `pnpm --filter @learnspace/worker recommendations:backfill`
   with `DATABASE_WORKER_URL` and `OPENAI_API_KEY` set.

### Transcript signer on a home machine

YouTube refuses caption requests from datacenter IPs, so a machine on a
home connection signs caption URLs. It sends one anonymous request per new
video, with no account or cookies. Learners' browsers then download the
captions on their own connections. A transcript is shared with everyone
only after two learners' downloads match. A video still unsigned after
10 minutes falls back to Firecrawl in the worker's housekeeping, at most
3 per run.

```text
DATABASE_WORKER_URL=<learnspace_worker URL> pnpm --filter @learnspace/worker transcripts:signer
```

The signer waits 10 seconds between requests and stops at 500 a day. At
the first rate limit or bot check, it pauses for 6 hours.

On the home laptop it runs as the systemd user service
`learnspace-transcript-signer`, which starts at login and restarts after
30 seconds if it exits. It reads `.env.production`. Check it with
`journalctl --user -u learnspace-transcript-signer -f`. While the laptop
is off, new videos go to Firecrawl after 10 minutes.

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

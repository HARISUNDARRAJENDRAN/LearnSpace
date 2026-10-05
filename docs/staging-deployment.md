# LearnSpace staging deployment

The staging web app runs on Vercel with `apps/web` as the project root. Neon
PostgreSQL is the persistent database. Local development uses the repository
root `docker-compose.yml`; its PostgreSQL initialization files live in
`infra/postgres`.

## Connection responsibilities

| Variable | Used by | Connection | Vercel runtime |
| --- | --- | --- | --- |
| `DATABASE_URL` | app data access | pooled `learnspace_app` | yes |
| `DATABASE_AUTH_URL` | auth route handlers | pooled `learnspace_auth` | yes |
| `DATABASE_MIGRATOR_URL` | migrate, verify, ledger, seed, DB tests | direct `learnspace_migrator` | no |
| `DATABASE_WORKER_URL` | catalogue ingestion and discovery worker | pooled/direct `learnspace_worker` | no |
| `DATABASE_ADMIN_URL` | one-time remote bootstrap | direct database owner/admin | no |

The Vercel runtime also sets `DB_POOL_MAX=1`,
`DB_PREPARED_STATEMENTS=false`, `DB_MAX_LIFETIME_SECONDS=300`, and the
remaining `DB_*` timeout variables. Database credentials are server-only.

## One-time Neon bootstrap

Set `DATABASE_ADMIN_URL` and one password variable for each role listed in
`packages/db/src/migrations/bootstrap.ts`, then run:

```text
pnpm install --frozen-lockfile
pnpm db:bootstrap:remote
pnpm db:migrate
pnpm db:verify
```

Bootstrap creates the required extensions and least-privilege roles. Drizzle
migrations remain the only source of application tables, policies, and the
migration ledger.

## Controlled deploy

The Vercel project is connected to GitHub, but automatic Git deployments are
disabled in `apps/web/vercel.json`. The `Staging deploy` workflow is the single
deployment authority: it installs, typechecks, lints, builds, checks Drizzle,
migrates with `STAGING_DATABASE_MIGRATOR_URL`, verifies the remote database,
and then deploys the prebuilt Next.js output.

Configure these GitHub Actions secrets:

- `STAGING_DATABASE_MIGRATOR_URL`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_TOKEN`

The main workflow verifies the foundation, database, and Python checks, then
deploys and verifies the AWS discovery agent, deploys Vercel, and finally
deploys the continuous AWS worker. Missing AWS configuration fails the release.
Foundation checks also build and import the packaged production worker so a
successful TypeScript check cannot mask missing runtime files.

To deploy the discovery agent from main as well, also configure:

- `AWS_DISCOVERY_AGENT_ROLE_ARN`
- `AWS_DISCOVERY_AGENT_EXA_API_KEY_SECRET_ARN`
- `AWS_DISCOVERY_AGENT_INTERNAL_TOKEN_SECRET_ARN`

Configure these Vercel Production variables for the staging deployment:

- `APP_URL` — the HTTPS staging URL
- `AUTH_SECRET` — at least 32 random bytes
- `DATABASE_URL`, `DATABASE_AUTH_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_EXPOSE_VERIFICATION_LINK=false`
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` for shared rate limiting and discovery cache
- `DISCOVERY_AGENT_URL` — the throttled discovery-agent API Gateway URL
- `INTERNAL_SERVICE_TOKEN` — the same token stored in the discovery-agent Secrets Manager secret
- `SOURCE_DISCOVERY_INTERACTIVE_TIMEOUT_MS=450`
- the server-safe `DB_*` values described above

The Google callback must be exactly
`https://<staging-domain>/api/auth/google/callback`. The web app reads the
Vercel KV REST variables when present and falls back to the local in-memory
rate limiter only when those variables are absent outside production.

Catalogue imports must use `DATABASE_WORKER_URL`; `DATABASE_MIGRATOR_URL` is
reserved for schema migrations and verification.

The YouTube importer refuses missing or unapproved licences. For a private
dataset owned by the operator, use the explicit `--owner-authorized` flag; this
records owner authorization as provenance and is not a public licence claim:

```text
pnpm --filter @learnspace/web discovery:import:youtube-dataset -- --input ./educational_youtube_content.csv --owner-authorized
```

The discovery agent is the AWS Lambda function
`learnspace-discovery-agent-staging` in `us-east-1`. Main-branch CI deploys and
verifies the tested agent image before releasing the web application. The
manual workflow remains available for recovery. The CloudFormation stack output is
the current API Gateway URL with a bounded stage throttle. The refresh, instant,
and version routes remain protected by
`INTERNAL_SERVICE_TOKEN`. The discovery worker uses the same worker connection
for catalogue writes and durable job state. Run it outside Vercel with
`pnpm discovery:worker` and set `DISCOVERY_AGENT_URL` to the stack output plus
`INTERNAL_SERVICE_TOKEN`. Its recurring scheduler reads these optional policy
overrides (hours):

- `DISCOVERY_REFRESH_FAST_HOURS` (default 12)
- `DISCOVERY_REFRESH_MEDIUM_HOURS` (default 24)
- `DISCOVERY_REFRESH_SLOW_HOURS` (default 72)
- `DISCOVERY_REFRESH_JITTER_PERCENT` (default 0.1)
- `DISCOVERY_REFRESH_DEDUP_HOURS` (default 12)
- `DISCOVERY_WORKER_INTERVAL_MS` (default 30000)
- `DISCOVERY_WORKER_MAX_JOBS` (default 0, continuous)
- `DISCOVERY_AGENT_TIMEOUT_SECONDS` (default 120)

The agent service requires `INTERNAL_SERVICE_TOKEN` and, when
`DISCOVERY_AGENTS_ENABLED=true`, `EXA_API_KEY`. In AWS, both values are kept in
Secrets Manager and loaded by the Lambda container at cold start. `REDIS_URL`
enables the shared candidate cache; without it the service uses a bounded
per-instance cache and still serves stale entries when available.
`DISCOVERY_MAX_TOOL_CALLS` defaults to 4 and is reserved for mandatory
video/current-paper/foundational-paper calls before optional work. Keep
`DISCOVERY_YOUTUBE_ENRICHMENT_ENABLED=false` until a deployed content tool
returns the strict structured enrichment schema; raw validated Exa candidates
remain the safe default.

The optional `Discovery staging smoke` workflow runs manually or every six
hours. It requires `STAGING_DATABASE_WORKER_URL`,
`STAGING_DATABASE_MIGRATOR_URL`, `STAGING_DISCOVERY_AGENT_URL`,
`STAGING_INTERNAL_SERVICE_TOKEN`, `STAGING_DISCOVERY_SMOKE_EMAIL`, and
`STAGING_DISCOVERY_SMOKE_PASSWORD`. It creates a refresh job for the canonical
`ai-machine-learning` concept, executes the real worker-to-agent path, verifies
a persisted candidate, logs in as the completed staging learner, and confirms
the candidate appears in the Home API before cleaning up with the migrator
connection. It is separate from pull-request CI and waits for the continuous
hosted worker to process the job; it does not start a transient worker.

The worker never needs `DATABASE_MIGRATOR_URL`; migrations remain a separate
controlled job.

## Continuous worker release

`infra/aws/worker/template.yaml` defines one Fargate worker in `us-east-1`,
using 0.25 vCPU and 512 MiB. It has no inbound access and uses the existing
hosted PostgreSQL, Redis REST cache, and discovery agent. A heartbeat checks
queue progress; embedding maintenance uses a separate connection and cannot
hold up the discovery queue. The task runs without root and shuts down on
SIGTERM.

CI reads `STAGING_DATABASE_WORKER_URL` and updates only that field in the
existing `learnspace/staging/worker/runtime` Secrets Manager JSON. The secret
must also contain `OPENAI_API_KEY`, `KV_REST_API_URL`, and `KV_REST_API_TOKEN`.
The internal service token remains in the discovery agent's separate secret.
The checked-in GitHub deployment policy includes the scoped worker permissions.

`infra/aws/worker/deploy.sh` publishes an immutable commit-tagged ECR image,
deploys its digest through CloudFormation, waits for a stable service, and
verifies both its build SHA and image digest. The following hosted smoke uses
the persistent worker and authenticated Vercel app before claiming success.

For a manual release, provide `AWS_REGION`, `GITHUB_SHA`,
`WORKER_RUNTIME_SECRET_ARN`, `INTERNAL_SERVICE_TOKEN_SECRET_ARN`,
`DISCOVERY_AGENT_URL`, `WORKER_VPC_ID`, and `WORKER_SUBNET_IDS`, then run
`bash infra/aws/worker/deploy.sh` from the repository root. Updating the database
credential separately requires `DATABASE_WORKER_URL` and
`python3 infra/aws/worker/configure-runtime.py`.

On 5 October 2026, [CI run 37288416604](https://github.com/HARISUNDARRAJENDRAN/LearnSpace/actions/runs/37288416604)
deployed build `8c75cf22a55e7d263c6bbf3ea0a6cd81ddd63bb3` to the discovery
agent, Vercel app, and continuous worker. The worker stack reached
`CREATE_COMPLETE`, with one healthy task and a completed ECS rollout. The
hosted smoke made three live provider calls, persisted ten resource-concept
links, and verified their ranking through the authenticated web app. The
deployment policy passed Access Analyzer with no findings after the required
CloudFormation network and ECS read permissions were applied.

Embedding requests still return provider HTTP 429. Discovery ingestion and
metadata/concept ranking work; live semantic backfill awaits available quota.
Detailed verification is recorded in `docs/semantic-recommendations.md`.

# LearnSpace staging deployment

The staging web app runs on Vercel with `apps/web` as the project root. Neon
PostgreSQL is the persistent database. Local development continues to use the
Docker PostgreSQL instance in `infra/postgres`.

## Connection responsibilities

| Variable | Used by | Connection | Vercel runtime |
| --- | --- | --- | --- |
| `DATABASE_URL` | app data access | pooled `learnspace_app` | yes |
| `DATABASE_AUTH_URL` | auth route handlers | pooled `learnspace_auth` | yes |
| `DATABASE_MIGRATOR_URL` | migrate, verify, ledger, seed, DB tests | direct `learnspace_migrator` | no |
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

Configure these Vercel Production variables for the staging deployment:

- `APP_URL` — the HTTPS staging URL
- `AUTH_SECRET` — at least 32 random bytes
- `DATABASE_URL`, `DATABASE_AUTH_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_EXPOSE_VERIFICATION_LINK=false`
- the server-safe `DB_*` values described above

The Google callback must be exactly
`https://<staging-domain>/api/auth/google/callback`. Redis is not provisioned
for this milestone because the current auth implementation has no Redis
dependency or rate-limit path.

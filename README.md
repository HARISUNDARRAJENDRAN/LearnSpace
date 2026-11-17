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

The root Compose file runs these services:

- `postgres` — PostgreSQL 16 with pgvector, holding all application data.
- `web` — the Next.js UI and API. On start it installs dependencies, applies
  migrations, verifies roles, and seeds development data, then serves the
  mounted source with hot reload.
- `backend` — the discovery worker. It finds videos and papers through Exa,
  keeps YouTube metrics fresh and maintains recommendations.
- `runner` — the code runner for AI Coding practice. It runs learner code in
  throwaway `sandbox` containers through the host's Docker socket and is the
  only reader of hidden tests (see `docs/ai-coding.md`).

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

## Notes with Luny

A video's Notes panel opens on a study guide to that video, written before the
learner arrives, which they and Luny then refine while talking out loud. Chat and mastery dictation still transcribe on the device with
Moonshine (`apps/web/components/study/speech.worker.ts`).

**Voice.** Opening Notes starts a conversation with Luny. Listening and
speaking run on the learner's device (`apps/web/components/study/voice/`), and
audio never leaves it. Silero decides when the learner is speaking. A pause of
a fifth of a second ends a turn, and speech that resumes before Luny is heard
joins the next one. While Luny talks or the video plays, only clearly louder
speech counts, and a third of a second of it interrupts her. Supertonic speaks
her replies on the CPU, a sentence at a time as they stream in, a little
quicker on an exclamation and slower on a question.

Speech recognition depends on the device. A desktop or laptop with a hardware
WebGPU adapter (Chrome runs it on Vulkan, Metal or D3D12, so integrated GPUs
such as Intel Iris Xe count) uses Parakeet Redux, a ternary build of Parakeet
TDT 0.6B v3 (363 MB). Its encoder runs on WebGPU and its decoder on WASM. A
warm-up checks that the GPU transcribes 4 s of speech within 1.3 s. A device
that fails it is remembered (`learnspace:voice-listener`) and uses Moonshine
Base on the CPU (62 MB, the model dictation uses). Phones, devices under 4 GB
of memory, data saver and software-only GPUs use Moonshine from the start. On
an Iris Xe laptop, both take about 0.2 s per second of speech. The models are
prefetched in the background when the learner enters the app.

Each turn is one `POST /voice`, streamed back as NDJSON. It carries what the
learner said, their place in the video and a frame of it. The server reads the
lesson, notebook, recent conversation and how the learner's mastery checks in
the session went (scores and missed concepts), and GPT-6 Luna answers on the fast
tier with no reasoning, as plain speech. The lesson sits in the cached prompt
prefix. Her `[[seek m:ss]]`, `[[pause]]` and `[[play]]` commands are cut out of
the speech and sent as lesson controls. Transcripts that match the lesson's own audio near the playhead
are dropped, so the video playing aloud never starts a turn. The exchange is
saved in `study.session_transcript` (migration 0035; per video since 0036) with its cost (`voice_notes`
runs) once Luny has said anything. A learner turn pauses the video. Closing
Notes hangs up and frees the models.

**Chiming in.** Luny may speak first when the learner pauses the video after a
minute of new watching and says nothing for two seconds: the turn carries
`watchedFromMs`, and she either says one short thing (a check question, a
connection, an offer to note something) or `[[listen]]`. Each unanswered
chime-in doubles the watching needed before the next, up to four minutes;
anything the learner says resets it. She never chimes in while the video plays,
and stops when asked to.

**Study guide.** Opening a lesson calls `POST /notes/guide`. Unless the video
already has a guide, the server answers at once and then writes one in the
background (`after()`, 300 s). GPT-6 Luna reads the whole timestamped
transcript and writes a self-contained guide. It has a section per topic with
its timestamp, explanations, plain-words (ELI5) versions, numbered steps,
worked examples, takeaways, LaTeX, tables, code, diagrams, and asides that mark
what comes from beyond the video. The guide is written once per learner and
video and lands above anything already on the page. The notes row records it
as `writing`, `ready` or `failed`. A run still `writing` after 300 s counts as
failed, and the next open of the lesson or Notes tries again. Notes polls
while the guide is being written or the transcript is still coming.

**Notebook.** The notebook is one tiptap editor (`NotesEditor.tsx`) holding the
blocks in `study.video_notes` (migration 0036), one page per learner per video,
kept across sessions: headings and subheadings, paragraphs, bullets, numbered
steps, tasks, callouts (plain words, example, takeaway, beyond the video),
claims, open questions, conclusions, and diagrams, tables, code, images and
links. In text, `$…$`/`$$…$$` math, `**bold**` and `` `code` `` render in
place and show their source only in the note being edited. Code is highlighted
with highlight.js, and code and tables open their source with Edit. The
learner writes anywhere: `## `, `### `, `- `, `1. `, `[] ` and `? ` start a
heading, subheading, bullet, step, task or question, and edits are saved a
moment after they stop typing. A few seconds after each of Luny's replies, a scribe (GPT-6 Luna,
deeper reasoning) reads the recent conversation and brings the notebook up to
date (`POST /notes/consolidate`). It records the learner's consolidated
understanding rather than a transcript, and makes the changes they ask for to
the guide (simpler, deeper, another example, a diagram) in place. Wrong ideas are corrected in place,
open questions are marked, and `[12:34]` timestamps play the lesson from that
point. Neither the scribe nor Luny overwrites a block the learner changed in
the meantime. The scribe's last edit can be undone (the toolbar, or "undo
that"). Luny reads the notebook as it is on every turn. A returning learner
picks up where they left off.

Diagrams are editable (`NoteDiagram.tsx`, React Flow): the learner drags,
resizes, recolours, reshapes and renames boxes, draws arrows between them,
labels arrows with a double-click, adds and deletes boxes, and stretches the
drawing taller. The result is saved as the same small JSON contract the scribe
writes, and the scribe keeps the learner's positions, sizes and colours.

**Seeing the lesson.** Opening Notes asks the browser to share this tab, so
Luny sees the lesson as it is on screen. At the start of each learner turn she
gets one cropped JPEG of the video. Frames are not
stored. If the learner declines, Luny works from the transcript, and **Share this
tab** asks again. Luny explains what she sees in words and puts diagrams in the
notes; she can seek, pause or play the video, with commands written inline in
her speech that are never spoken.

### Production Docker runtime

`Dockerfile` has a `web-production` target containing the traced Next runtime
and static assets, running as `node`. Dependency installs use a BuildKit cache;
environment files at every depth are excluded from the build context.
Apply/verify migrations before starting it, then run:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

The production override removes the source/dependency mounts and startup
install/migrate/seed work. It sets a 768 MB container ceiling and a 384 MB JS
heap. Plain `docker compose up -d web` restores the development service.
Production on Vercel continues to use the existing project and Mumbai region.

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
both against one Supabase PostgreSQL project. The code runner has an Azure
VM of its own (`infra/runner/README.md`). The web app reaches it with
`RUNNER_URL=https://runner.learn-space.app` and `RUNNER_TOKEN`.

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
next to the database; `apps/web/vercel.json` runs `scripts/vercel-build.sh`,
which installs Rust for the PDF parser's native module and builds the
workspace packages first. Auth rate limits are counted in PostgreSQL, so
every function instance shares them. Opening a paper that has not been parsed
yet parses it in the background of that request (`lib/research/ingestion.ts`).

1. Set the project's environment variables: `DATABASE_URL` and
   `DATABASE_AUTH_URL` (transaction mode), `DB_PREPARED_STATEMENTS=false`,
   `DB_POOL_MAX=3`, `APP_URL`, `GOOGLE_REDIRECT_URI`
   (`$APP_URL/api/auth/google/callback`), `AUTH_SECRET`,
   `AUTH_SECURE_COOKIES=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `EXA_API_KEY`, `DATABASE_WORKER_URL`
   (transaction mode, for paper ingestion), `RUNNER_URL`, `RUNNER_TOKEN`, and optionally
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
captions on their own connections; the server never downloads them itself.
The signer publishes the first valid download within seconds and embeds it,
and keeps that learner's emptied submission row as the record of who
supplied the transcript. If no download arrives 15 seconds after signing
(the learner's network may be one YouTube is refusing), the signer has
Firecrawl fetch it from Firecrawl's own servers, at most 100 a day. A new
video is usually answerable in about 10 seconds, and in under 40 when it
needs Firecrawl. While the signer is off, the worker's housekeeping sends
videos waiting over 2 minutes to Firecrawl, at most 3 per run.

```text
DATABASE_WORKER_URL=<learnspace_worker URL> pnpm --filter @learnspace/worker transcripts:signer
```

The signer waits 10 seconds between YouTube requests and stops at 500 a
day. At the first rate limit or bot check, it pauses signing for 6 hours;
publishing and Firecrawl keep running. It needs `OPENAI_API_KEY` for
embeddings and `FIRECRAWL_API_KEY` for the fallback. Locally, the
`transcript-signer` compose service runs it against the local database.

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

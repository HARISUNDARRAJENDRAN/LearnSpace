# Services

The service directories are deployable boundaries:

- `worker` runs the PostgreSQL-backed discovery queue: it searches Exa for each
  topic lane (the search code lives in `packages/shared/src/exa-discovery.ts`)
  and persists validated candidates. It is the root Dockerfile's `backend`
  target.
- `runner` is the code runner: the only service that executes learner code
  (each run in a fresh, network-less `learnspace-sandbox:1` container) and the
  only reader of coding problems' hidden tests. It verifies newly written
  problems and grades runs and submissions. It is the root Dockerfile's
  `runner` target; see `docs/ai-coding.md`.

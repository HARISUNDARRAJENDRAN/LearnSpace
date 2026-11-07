# Services

The service directories are deployable boundaries:

- `worker` runs the PostgreSQL-backed discovery queue: it searches Exa for each
  topic lane (the search code lives in `packages/shared/src/exa-discovery.ts`)
  and persists validated candidates. It is the root Dockerfile's `backend`
  target.
- `runner` currently contains only the execution boundary marker and has no
  runtime process to containerize yet.

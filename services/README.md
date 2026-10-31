# Services

The service directories are deployable boundaries:

- `worker` runs the PostgreSQL-backed discovery queue and persists validated
  candidates.
- `ai-backend` exposes the bounded FastAPI discovery agent. It runs beside the
  worker in the root Dockerfile's `backend` target.
- `runner` currently contains only the execution boundary marker and has no
  runtime process to containerize yet.

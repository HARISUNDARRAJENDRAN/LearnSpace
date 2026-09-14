# Services

The service directories are deployable boundaries:

- `worker` runs the PostgreSQL-backed discovery queue and persists validated
  candidates.
- `ai-backend` exposes the bounded FastAPI discovery agent. Its local image is
  built by the root Compose stack, and its AWS Lambda deployment is defined in
  `infra/aws/discovery-agent`.
- `runner` currently contains only the execution boundary marker and has no
  runtime process to containerize yet.

The first cloud service is intentionally the discovery agent. The worker stays
outside Vercel because it owns durable PostgreSQL queue leases and catalogue
writes; its `DISCOVERY_AGENT_URL` points at the deployed Lambda Function URL.

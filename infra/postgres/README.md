# Local PostgreSQL

The local database uses the pinned `pgvector/pgvector:0.8.6-pg16-bookworm` image. The first-start init script creates the least-privilege runtime roles; application migrations connect as `learnspace_migrator`.

```text
docker compose up -d postgres
```

The volume is intentionally named and is not committed to the repository. Use `pnpm db:reset:local` for a guarded schema reset, or `docker compose ... down -v` when recreating the entire disposable local volume.

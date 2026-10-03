# Local Docker memory

Measured on 2026-10-03 with `docker stats --no-stream`. The running AI
service fell from 520.2 MiB to 57.68 MiB after rebuilding, approximately an
89% reduction. It still passes `/readyz` and the existing discovery tests.

The five application containers used approximately 1.19 GiB after compiling
all five authentication pages and verifying them at three viewport widths.
The previous observed stack used approximately 1.40 GiB, but the two samples
have different page warm-up conditions; they are not a controlled whole-stack
benchmark. The reported 4–6 GB peak was not reproduced or measured.

Raw measurements: [docker-memory.json](benchmarks/docker-memory.json).

## Changes

- Discovery's existing async flow no longer inherits an unused CrewAI `Flow`.
  Optional enrichment tools remain lazy imports. A subprocess regression test
  ensures API startup does not load CrewAI, Chroma, Torch, or Transformers.
- Next.js keeps its compilation cache on restart, disables entry preloading,
  expires inactive development entries after 30 seconds, and enables its
  supported Webpack memory optimizations and build worker.
- The migration job installs shared workspace dependencies once before web
  and worker start. Concurrent installs no longer duplicate download and
  package-manager memory. A real installer/migrate/verify/seed run passed.
- Redis has a 64 MiB cache budget with eviction. PostgreSQL uses 64 MiB shared
  buffers, 4 MiB work memory, and 40 connections; the web pool has five.
- Python image builds cache downloaded dependencies and limit simultaneous
  downloads to four. The rebuilt image was started and health-checked.

## Defaults

| Service | Container limit | Node heap limit |
| --- | ---: | ---: |
| Web development | 1536 MiB | 1024 MiB |
| Worker | 512 MiB | 384 MiB |
| AI API | 768 MiB | — |
| PostgreSQL | 256 MiB | — |
| Redis | 128 MiB | — |
| Installer/migrations, exits before app startup | 768 MiB | 384 MiB |

These are ceilings, not reservations. The running application ceilings total
3.125 GiB. Override them through `WEB_MEMORY_LIMIT`, `WORKER_MEMORY_LIMIT`,
`AI_MEMORY_LIMIT`, `POSTGRES_MEMORY_LIMIT`, `REDIS_MEMORY_LIMIT`, or
`MIGRATE_MEMORY_LIMIT` when workloads require it.

The warm-page check reported no OOM kills or container restarts. This does
not establish a maximum for every development route or optional enrichment
tool. Docker Desktop's VM, filesystem cache, and image builds consume memory
outside these application-container figures. Container limits do not cap
BuildKit image builds.

No database volumes were deleted. Application data remains in PostgreSQL;
Redis contains disposable cached recommendation state.

# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

WORKDIR /workspace

RUN npm install --global pnpm@11.24.0

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json .npmrc ./
COPY patches ./patches
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/runner/package.json services/runner/package.json
COPY services/worker/package.json services/worker/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS source

COPY . .

# This target is used by the local migration job. It intentionally includes the
# workspace source and development tooling because Drizzle migrations run from
# TypeScript source through the checked-in package scripts.
FROM source AS tools

ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    DATABASE_AUTH_URL=postgres://build:build@localhost:5432/build

# Build the application and its workspace dependencies as one unit. The
# package export maps point runtime imports at the generated dist files.
FROM source AS web-build

ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    DATABASE_AUTH_URL=postgres://build:build@localhost:5432/build \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter "@learnspace/web..." run build

FROM base AS worker-build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .npmrc ./
COPY patches ./patches
COPY packages/shared/package.json packages/shared/package.json
COPY services/worker/package.json services/worker/package.json
RUN pnpm install --frozen-lockfile --filter @learnspace/worker... --filter learnspace
COPY packages/shared ./packages/shared
COPY services/worker ./services/worker
COPY apps/web/public/data/learnspace_youtube_curriculum_master.csv ./apps/web/public/data/learnspace_youtube_curriculum_master.csv

RUN pnpm --filter "@learnspace/worker..." run build \
    && pnpm --filter @learnspace/worker deploy --prod --legacy --config.allowUnusedPatches=true /worker-runtime

FROM node:${NODE_VERSION}-bookworm-slim AS web

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home nextjs

COPY --from=web-build --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=nextjs:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=nextjs:nodejs /workspace/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]

# The discovery agent and the discovery worker run together in one container.
FROM python:3.13-slim-bookworm AS backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_HTTP_TIMEOUT=180 \
    UV_CONCURRENT_DOWNLOADS=4 \
    PATH=/service/.venv/bin:$PATH \
    NODE_ENV=production \
    CURRICULUM_PATH=/service/worker/data/curriculum.csv

WORKDIR /service

COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY services/ai-backend/pyproject.toml services/ai-backend/uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    pip install --timeout 120 uv==0.11.28 \
    && uv sync --frozen --no-dev \
    && groupadd --system --gid 10001 learnspace \
    && useradd --system --uid 10001 --gid learnspace --home-dir /service --shell /usr/sbin/nologin learnspace

COPY --chown=learnspace:learnspace services/ai-backend/app ./app
COPY --from=worker-build --chown=learnspace:learnspace /worker-runtime ./worker
COPY --from=worker-build /workspace/apps/web/public/data/learnspace_youtube_curriculum_master.csv ./worker/data/curriculum.csv
COPY infra/docker/backend.sh /usr/local/bin/learnspace-backend

USER learnspace

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=15s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/readyz')"

CMD ["learnspace-backend"]

# Compose uses this target for the local web container. It keeps the source
# tree and migration tooling available for Next.js while the production
# targets above remain suitable for standalone images.
FROM source AS development

EXPOSE 3000

CMD ["pnpm", "--filter", "@learnspace/web", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# `docker build .` produces the deployable web image; local Compose selects the
# development target explicitly.
FROM web AS default

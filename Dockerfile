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

FROM source AS worker-build

RUN pnpm --filter "@learnspace/worker..." run build

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

FROM node:${NODE_VERSION}-bookworm-slim AS worker

ENV NODE_ENV=production

WORKDIR /app

RUN groupadd --system --gid 1001 learnspace \
    && useradd --system --uid 1001 --gid learnspace --create-home learnspace

# pnpm's workspace links are retained; the linked shared package is copied to
# the matching location below and its runtime export points at dist/.
COPY --from=worker-build /workspace/node_modules ./node_modules
COPY --from=worker-build /workspace/package.json ./package.json
COPY --from=worker-build /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=worker-build /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=worker-build /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=worker-build /workspace/services/worker/package.json ./services/worker/package.json
COPY --from=worker-build /workspace/services/worker/node_modules ./services/worker/node_modules
COPY --from=worker-build /workspace/services/worker/dist ./services/worker/dist

USER learnspace

CMD ["node", "services/worker/dist/index.js", "--loop"]

# Compose uses this target for the local development containers. It keeps the
# source tree available for Next.js and the worker while the production targets
# above remain suitable for standalone images.
FROM source AS development

EXPOSE 3000

CMD ["pnpm", "--filter", "@learnspace/web", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# `docker build .` produces the deployable web image; local Compose selects the
# development target explicitly.
FROM web AS default
